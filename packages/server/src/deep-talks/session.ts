import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { type LanguageModel } from "ai";
import { type Database, messages, users } from "@sidekick/db";
import {
  DEEP_TALK_MARKER_ROLE,
  activeDeepTalk,
  deepTalkBySlug,
  encodeDeepTalkMarker,
  isDeepTalkUnlocked,
  parseDeepTalkMarker,
} from "@sidekick/shared";
import { grantReward } from "../rewards/service";
import { ensureMainConversation } from "../chat/turn";
import { runExtraction } from "../jobs/extraction";
import { recomputeContextScore } from "./score";

/** Coins granted for finishing a deep talk (14 §runner — the visible payoff). */
export const DEEP_TALK_REWARD_COINS = 6;

/**
 * The `complete_deep_talk` slugs invoked on one assistant message. Read from the
 * persisted `toolCalls` jsonb the turn writer stored (`{toolName, input}` shape).
 */
export function completedDeepTalkSlugs(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  const slugs: string[] = [];
  for (const call of toolCalls) {
    if (typeof call !== "object" || call === null) {
      continue;
    }
    const record = call as Record<string, unknown>;
    if (record.toolName !== "complete_deep_talk") {
      continue;
    }
    const input = record.input;
    if (typeof input === "object" && input !== null) {
      const slug = (input as Record<string, unknown>).slug;
      if (typeof slug === "string" && slug.length > 0) {
        slugs.push(slug);
      }
    }
  }
  return slugs;
}

/** Grant the one-time completion reward for a deep talk (idempotent per slug). */
async function grantDeepTalkCompletion(db: Database, userId: string, slug: string): Promise<void> {
  await grantReward(db, {
    userId,
    source: "event",
    dedupeKey: `deep-talk:${slug}`,
    outcome: { kind: "coins", amount: DEEP_TALK_REWARD_COINS },
  });
}

export type FinishDeepTalkResult = {
  slug: string;
  applied: number;
  score: number;
  previousScore: number;
};

/**
 * Settle one just-completed deep talk (14 §runner): the immediate extraction pass
 * (don't wait for idle — the payoff must show right away), a score recompute, and
 * the completion reward. Every step is idempotent, so the immediate call from the
 * chat turn and the idle-sweep backstop never double-count.
 */
export async function finishDeepTalk(
  db: Database,
  model: LanguageModel,
  input: { userId: string; conversationId: string; slug: string },
): Promise<FinishDeepTalkResult> {
  const extraction = await runExtraction(db, model, input.conversationId);
  const { score, previous } = await recomputeContextScore(db, input.userId);
  await grantDeepTalkCompletion(db, input.userId, input.slug);
  return { slug: input.slug, applied: extraction.applied, score, previousScore: previous };
}

/**
 * Settle every completed deep talk in a conversation from scratch: the immediate
 * extraction pass, a score recompute, and the completion grants. Used by the chat
 * turn hook and the `deepTalks.finish` endpoint (streaming path). Idempotent.
 */
export async function settleDeepTalks(
  db: Database,
  model: LanguageModel,
  conversationId: string,
  userId: string,
): Promise<{ applied: number; score: number; previousScore: number }> {
  const extraction = await runExtraction(db, model, conversationId);
  const { score, previous } = await recomputeContextScore(db, userId);
  await settleDeepTalkGrants(db, conversationId, userId);
  return { applied: extraction.applied, score, previousScore: previous };
}

/**
 * Backstop for the streaming path (which has no post-turn router hook): grant the
 * completion reward for every `complete` marker in a conversation. The idle job
 * has already run extraction + rescore, so this only settles the grants.
 */
export async function settleDeepTalkGrants(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<void> {
  const markers = await db
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, DEEP_TALK_MARKER_ROLE),
      ),
    );
  const completed = new Set<string>();
  for (const row of markers) {
    const marker = parseDeepTalkMarker(row.content);
    if (marker?.phase === "complete") {
      completed.add(marker.slug);
    }
  }
  for (const slug of completed) {
    await grantDeepTalkCompletion(db, userId, slug);
  }
}

/**
 * Start a deep talk in the user's main conversation (14 §runner). Writes a `start`
 * marker that `buildContextView` reads to inject the session's beats. Rejects a
 * locked topic (its `unlockAtScore` gates flavor, never utility). Returns the main
 * conversation id so the client can open straight into the thread.
 */
export async function startDeepTalk(
  db: Database,
  userId: string,
  slug: string,
): Promise<{ conversationId: string; slug: string }> {
  const talk = deepTalkBySlug(slug);
  if (!talk) {
    throw new TRPCError({ code: "NOT_FOUND", message: "unknown deep talk" });
  }
  const userRows = await db
    .select({ contextScore: users.contextScore })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const score = userRows[0]?.contextScore ?? 0;
  if (!isDeepTalkUnlocked(talk, score)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "deep talk still locked" });
  }

  const conversation = await ensureMainConversation(db, userId);
  await db.insert(messages).values({
    conversationId: conversation.id,
    role: DEEP_TALK_MARKER_ROLE,
    content: encodeDeepTalkMarker({ phase: "start", slug }),
    tokenEstimate: 0,
  });
  return { conversationId: conversation.id, slug };
}

/** The active deep talk in the user's main conversation, or null (shelf banner). */
export async function activeDeepTalkForUser(db: Database, userId: string) {
  const conversation = await ensureMainConversation(db, userId);
  const talk = await activeDeepTalk(db, conversation.id);
  return talk ? { slug: talk.slug, title: talk.title, conversationId: conversation.id } : null;
}
