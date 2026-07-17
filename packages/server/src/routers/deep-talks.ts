import { and, eq, like } from "drizzle-orm";
import { type Database, ledger, users } from "@sidekick/db";
import {
  DEEP_TALKS,
  chatgptImportCommitInput,
  chatgptImportStageInput,
  contextBand,
  deepTalkFinishInput,
  deepTalkStartInput,
  isDeepTalkUnlocked,
} from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { assertConversationOwned } from "../chat/turn";
import { activeDeepTalkForUser, settleDeepTalks, startDeepTalk } from "../deep-talks/session";
import { commitChatGptImport, stageChatGptImport } from "../deep-talks/import";

async function contextScore(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ contextScore: users.contextScore })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.contextScore ?? 0;
}

/**
 * Deep talks, the context score, and ChatGPT import (14). `shelf` is the "how well
 * your sidekick knows you" surface: the score card + the deep-talk shelf, with each
 * topic's locked/completed state. Starting a talk sets the active session the chat
 * context injects; finishing settles the immediate extraction + reward.
 */
export const deepTalksRouter = router({
  shelf: protectedProcedure.query(async ({ ctx }) => {
    const score = await contextScore(ctx.db, ctx.userId);
    const completedRows = await ctx.db
      .select({ dedupeKey: ledger.dedupeKey })
      .from(ledger)
      .where(and(eq(ledger.userId, ctx.userId), like(ledger.dedupeKey, "deep-talk:%")));
    const completed = new Set(completedRows.map((r) => r.dedupeKey.slice("deep-talk:".length)));
    const active = await activeDeepTalkForUser(ctx.db, ctx.userId);

    return {
      score,
      band: contextBand(score),
      active,
      talks: DEEP_TALKS.map((talk) => ({
        slug: talk.slug,
        title: talk.title,
        teaser: talk.teaser,
        emoji: talk.emoji,
        unlockAtScore: talk.unlockAtScore,
        unlocked: isDeepTalkUnlocked(talk, score),
        completed: completed.has(talk.slug),
      })),
    };
  }),

  start: protectedProcedure
    .input(deepTalkStartInput)
    .mutation(({ ctx, input }) => startDeepTalk(ctx.db, ctx.userId, input.slug)),

  finish: protectedProcedure
    .input(deepTalkFinishInput)
    .mutation(async ({ ctx, input }) => {
      await assertConversationOwned(ctx.db, input.conversationId, ctx.userId);
      return settleDeepTalks(ctx.db, ctx.model, input.conversationId, ctx.userId);
    }),

  importStage: protectedProcedure
    .input(chatgptImportStageInput)
    .mutation(async ({ ctx, input }) => {
      const candidates = await stageChatGptImport(ctx.db, ctx.model, ctx.userId, input.text);
      return { candidates };
    }),

  importCommit: protectedProcedure
    .input(chatgptImportCommitInput)
    .mutation(({ ctx, input }) =>
      commitChatGptImport(ctx.db, ctx.model, ctx.userId, input.candidates),
    ),
});
