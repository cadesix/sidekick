import type { LanguageModel } from "ai";
import { eq, sql } from "drizzle-orm";
import { type Database, conversations, messages, users } from "@sidekick/db";
import { type SummaryRow, localDate } from "@sidekick/shared";
import { runCompaction } from "../chat/compaction";
import { recomputeContextScore } from "../deep-talks/score";
import { settleDeepTalkGrants } from "../deep-talks/session";
import { type ExtractionResult, runExtraction } from "./extraction";

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_SWEEP_INTERVAL_MINUTES = 15;

export type IdleJobResult = {
  extraction: ExtractionResult;
  compaction: SummaryRow | null;
};

/**
 * The session-idle job (user-memory.md §2 / 08 §triggers): extraction THEN
 * compaction, always in that order for one conversation. Running extraction
 * first advances `lastExtractedMessageId`, which compaction is then clamped
 * against — so no durable fact can be squeezed out of the verbatim tail before
 * the extractor has seen it. `applyCompaction` re-asserts the invariant as a
 * backstop.
 */
export async function runIdleJob(
  db: Database,
  model: LanguageModel,
  conversationId: string,
  options: { now?: Date } = {},
): Promise<IdleJobResult> {
  const extraction = await runExtraction(db, model, conversationId, options);
  await settleConversationScore(db, conversationId);
  const compaction = await runCompaction(db, model, conversationId, options);
  return { extraction, compaction };
}

/**
 * The context-score hook (14 §context score): after extraction lands new memories,
 * recompute the score for the conversation's owner and settle any deep-talk
 * completion grants. Both are idempotent, so this is safe to run on every idle job.
 */
async function settleConversationScore(db: Database, conversationId: string): Promise<void> {
  const rows = await db
    .select({ userId: conversations.userId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const userId = rows[0]?.userId;
  if (!userId) {
    return;
  }
  await recomputeContextScore(db, userId);
  await settleDeepTalkGrants(db, conversationId, userId);
}

export type SweepOptions = {
  idleMinutes?: number;
  /** How often the sweep runs — the midnight-crossing window (15-min cron). */
  sweepIntervalMinutes?: number;
};

/**
 * Conversations due for the idle job (user-memory.md §2: "no message for 30 min,
 * or the user's local end-of-day, whichever first") that still have messages the
 * extractor has not seen. Two triggers, one query:
 *
 * - **Idle:** last message older than `idleMinutes`.
 * - **End-of-day:** the user's local calendar date changed between the previous
 *   sweep tick (`now - sweepIntervalMinutes`) and `now`. Exactly one 15-minute
 *   window contains each local midnight, so consecutive sweeps never double-fire.
 *
 * `now` is injectable so cron shards and tests can freeze time.
 */
export async function findIdleConversations(
  db: Database,
  now: Date,
  options: SweepOptions = {},
): Promise<string[]> {
  const idleMinutes = options.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  const sweepIntervalMinutes = options.sweepIntervalMinutes ?? DEFAULT_SWEEP_INTERVAL_MINUTES;
  const idleThreshold = new Date(now.getTime() - idleMinutes * 60_000);
  const previousSweep = new Date(now.getTime() - sweepIntervalMinutes * 60_000);

  const rows = await db
    .select({
      id: conversations.id,
      timezone: users.timezone,
      idle: sql<boolean>`max(${messages.createdAt}) < ${idleThreshold}`,
    })
    .from(conversations)
    .innerJoin(messages, eq(messages.conversationId, conversations.id))
    .innerJoin(users, eq(users.id, conversations.userId))
    .groupBy(conversations.id, conversations.lastExtractedMessageId, users.timezone)
    .having(
      sql`${conversations.lastExtractedMessageId} is null or max(${messages.id}) > ${conversations.lastExtractedMessageId}`,
    );

  return rows
    .filter((row) => row.idle || localDate(row.timezone, now) !== localDate(row.timezone, previousSweep))
    .map((row) => row.id);
}

/**
 * Run the idle job for every due conversation. Failures are isolated per
 * conversation so one bad session never blocks the rest (08 §failure modes: a
 * compaction failure is correct-but-costlier, never fatal). Returns per-run
 * results and errors for the cron endpoint to report.
 */
export async function runIdleSweep(
  db: Database,
  model: LanguageModel,
  now: Date,
  options: SweepOptions = {},
): Promise<{ ran: number; errors: number }> {
  const ids = await findIdleConversations(db, now, options);
  let ran = 0;
  let errors = 0;
  for (const id of ids) {
    try {
      await runIdleJob(db, model, id, { now });
      ran += 1;
    } catch {
      errors += 1;
    }
  }
  return { ran, errors };
}
