import { type LanguageModel, generateText } from "ai";
import { eq, sql } from "drizzle-orm";
import { type Database, conversationSummaries, conversations } from "@sidekick/db";
import { modelName } from "../model";
import {
  COMPACTION_PROMPT,
  type SummaryRow,
  type TailMessage,
  TAIL_TARGET_TOKENS,
  estimateTokens,
  latestSummary,
  renderMemoryBlock,
  sumTokens,
  tailMessages,
} from "@sidekick/shared";

const OPENER_PREFERENCE_TOKENS = 2_000;

export type Boundary = {
  /** New summary watermark: every message with id <= this is summarized. */
  coversToMessageId: number;
  /** Count of tail messages that fall into the summary (the older prefix). */
  keepStart: number;
};

function isBoundary(message: TailMessage): boolean {
  return message.role === "user" || message.isCheckinOpener;
}

/**
 * Choose the watermark for the next summary (08 §boundary selection). Keeps the
 * newest ~`targetTokens` verbatim, then walks *older* from that ideal cut to the
 * nearest clean seam — a point where the next kept message is a `user` message or
 * a cron check-in opener — so we never split a user turn from its reply or a
 * tool-call from its result. A check-in opener within ~2k tokens of the ideal cut
 * wins as a natural day boundary. The cut is clamped so it can never pass the
 * extraction watermark (`maxSummarizableId`), the ordering invariant of both
 * plans. Returns null when there is nothing to cleanly compact.
 */
export function selectBoundary(
  tail: TailMessage[],
  params: { targetTokens: number; maxSummarizableId: number },
): Boundary | null {
  if (tail.length < 2) {
    return null;
  }

  let acc = 0;
  let idealKeepStart = tail.length;
  for (let i = tail.length - 1; i >= 0; i--) {
    const row = tail[i];
    if (!row || acc + row.tokenEstimate > params.targetTokens) {
      break;
    }
    acc += row.tokenEstimate;
    idealKeepStart = i;
  }

  let maxIndex = -1;
  for (let i = 0; i < tail.length; i++) {
    const row = tail[i];
    if (!row || row.id > params.maxSummarizableId) {
      break;
    }
    maxIndex = i;
  }
  if (maxIndex < 0) {
    return null;
  }

  const clampedIdeal = Math.min(idealKeepStart, maxIndex + 1, tail.length - 1);
  if (clampedIdeal < 1) {
    return null;
  }

  let nearest = -1;
  let opener = -1;
  let dist = 0;
  for (let j = clampedIdeal; j >= 1; j--) {
    if (j < clampedIdeal) {
      dist += tail[j]?.tokenEstimate ?? 0;
    }
    const row = tail[j];
    if (!row || !isBoundary(row)) {
      continue;
    }
    if (nearest === -1) {
      nearest = j;
    }
    if (row.isCheckinOpener && dist <= OPENER_PREFERENCE_TOKENS && opener === -1) {
      opener = j;
    }
  }

  const keepStart = opener !== -1 ? opener : nearest;
  if (keepStart < 1) {
    return null;
  }
  const cutMessage = tail[keepStart - 1];
  if (!cutMessage) {
    return null;
  }
  return { coversToMessageId: cutMessage.id, keepStart };
}

export type ApplyCompactionInput = {
  conversationId: string;
  supersedesId: number | null;
  coversToMessageId: number;
  extractionWatermark: number;
  content: string;
  model: string;
  promptVersion: string;
};

/**
 * Persist a rebuilt summary with optimistic concurrency (08 §concurrency). One
 * compaction per conversation at a time via `pg_advisory_xact_lock`; inside the
 * lock we re-read the latest summary and only insert if it is still the row we
 * built against (`supersedesId`) — otherwise a racing idle tick already applied
 * one and we discard. The ordering invariant is asserted here as a backstop:
 * the watermark may never pass the extraction watermark.
 */
export async function applyCompaction(
  db: Database,
  input: ApplyCompactionInput,
): Promise<SummaryRow | null> {
  if (input.coversToMessageId > input.extractionWatermark) {
    throw new Error(
      `compaction watermark ${input.coversToMessageId} passed extraction watermark ${input.extractionWatermark}`,
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.conversationId}, 0))`,
    );

    const current = await latestSummary(tx, input.conversationId);
    const currentId = current?.id ?? null;
    if (currentId !== input.supersedesId) {
      return null;
    }

    const inserted = await tx
      .insert(conversationSummaries)
      .values({
        conversationId: input.conversationId,
        coversToMessageId: input.coversToMessageId,
        content: input.content,
        tokenEstimate: estimateTokens(input.content),
        supersedesId: input.supersedesId,
        model: input.model,
        promptVersion: input.promptVersion,
      })
      .returning({
        id: conversationSummaries.id,
        coversToMessageId: conversationSummaries.coversToMessageId,
        content: conversationSummaries.content,
        tokenEstimate: conversationSummaries.tokenEstimate,
      });
    return inserted[0] ?? null;
  });
}

function renderNewMessages(summarized: TailMessage[]): string {
  return summarized
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "user" : "you"}: ${m.content}`)
    .join("\n");
}

/**
 * Compact one conversation if its tail exceeds `minTailTokens` (08 §triggers:
 * `TAIL_TARGET` at idle, `TAIL_MAX` for the safety valve). Reads immutable rows,
 * makes one cheap-model call for the replacement summary, and applies it. Returns
 * the new summary, or null if nothing needed compacting or a race lost. Never
 * runs in the request path — callers schedule it.
 */
export async function runCompaction(
  db: Database,
  model: LanguageModel,
  conversationId: string,
  options: { minTailTokens?: number; now?: Date } = {},
): Promise<SummaryRow | null> {
  const minTailTokens = options.minTailTokens ?? TAIL_TARGET_TOKENS;

  const conversationRows = await db
    .select({
      userId: conversations.userId,
      lastExtractedMessageId: conversations.lastExtractedMessageId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const conversation = conversationRows[0];
  if (!conversation) {
    return null;
  }
  const extractionWatermark = conversation.lastExtractedMessageId;
  if (extractionWatermark === null) {
    return null;
  }

  const summary = await latestSummary(db, conversationId);
  const oldWatermark = summary?.coversToMessageId ?? 0;
  const tail = await tailMessages(db, conversationId, oldWatermark);
  if (sumTokens(tail) <= minTailTokens) {
    return null;
  }

  const boundary = selectBoundary(tail, {
    targetTokens: TAIL_TARGET_TOKENS,
    maxSummarizableId: extractionWatermark,
  });
  if (!boundary) {
    return null;
  }

  const summarized = tail.slice(0, boundary.keepStart);
  const memoryBlock = await renderMemoryBlock(db, conversation.userId, options.now ?? new Date());
  const prompt = COMPACTION_PROMPT.build({
    memoryBlock,
    currentSummary: summary?.content ?? null,
    newMessages: renderNewMessages(summarized),
  });

  const { text } = await generateText({ model, prompt });

  return applyCompaction(db, {
    conversationId,
    supersedesId: summary?.id ?? null,
    coversToMessageId: boundary.coversToMessageId,
    extractionWatermark,
    content: text.trim(),
    model: modelName(model),
    promptVersion: COMPACTION_PROMPT.version,
  });
}
