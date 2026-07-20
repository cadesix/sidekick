import {
  attachmentStatusInput,
  attachmentUploadedInput,
  chatDeleteMessageInput,
  chatHistoryAroundInput,
  chatHistoryInput,
  chatReactInput,
  chatSearchInput,
  chatSendInput,
  createUploadUrlInput,
  deviceToolResultInput,
  retryAttachmentInput,
} from "@sidekick/shared";
import type { Reaction } from "@sidekick/shared";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
  chatHistory,
  chatHistoryAround,
  chatSearch,
  ensureMainConversation,
  recordDeviceToolResult,
  sendChatTurn,
} from "../chat/turn";
import { ingestAttachment } from "../attachments/ingest";
import {
  attachmentStatuses,
  attachmentsForMessages,
  createUpload,
  markRetrying,
  markUploaded,
} from "../attachments/upload";
import type { Storage } from "../storage";
import { type Database, conversations, messages } from "@sidekick/db";
import { runIdleJob } from "../jobs/idle";
import { completedDeepTalkSlugs, settleDeepTalks } from "../deep-talks/session";
import { adsForMessages, runAdDecision } from "../ads";
import { gamesForMessages } from "../games/service";

/**
 * Attach each message's attachments and, for ad / game-turn rows, the render
 * payload — all keyed by message id for thread rendering. The game payload
 * carries live match state and marks the match's `latest` card (plan 21).
 */
async function withAttachments<T extends { id: number; gameMatchId: string | null }>(
  db: Database,
  storage: Storage,
  rows: T[],
) {
  const ids = rows.map((r) => r.id);
  const [byMessage, adByMessage, gameByMessage] = await Promise.all([
    attachmentsForMessages(db, storage, ids),
    adsForMessages(db, ids),
    gamesForMessages(db, rows),
  ]);
  return rows.map((row) => ({
    ...row,
    attachments: byMessage.get(row.id) ?? [],
    ad: adByMessage.get(row.id) ?? null,
    game: gameByMessage.get(row.id) ?? null,
  }));
}

const chatCapoffInput = z.object({ conversationId: z.string() });

// The parting one-liner the sidekick says over its head when the user closes the
// chat and walks back to the 3D home. Snarky, affectionate, references the convo.
const CAPOFF_SYSTEM = `You are the user's sidekick — a little character on their home screen. They just closed the chat and walked back to you. Say ONE short parting line that caps off the conversation you two just had, riffing on the last few messages or the whole vibe.

Rules:
- one line, at most ~12 words. lowercase, texty.
- funny and a little cheeky, like a friend getting the last word. never mean, never corporate.
- reference something specific from the conversation when you can, so it feels like you were there.
- no em dashes (use a comma or a period), no emojis, no hashtags, no surrounding quotes, no "haha". just the line itself.`;

export const chatRouter = router({
  mainConversation: protectedProcedure.query(({ ctx }) =>
    ensureMainConversation(ctx.db, ctx.userId),
  ),

  /**
   * A snarky sign-off for the 3D home speech bubble (client fires this on chat
   * close). Reads the tail of the transcript and has the cheap model riff on it.
   * Returns `{ quip: null }` when there's nothing to riff on — the client just
   * skips the bubble.
   */
  capoff: protectedProcedure.input(chatCapoffInput).query(async ({ ctx, input }) => {
    const rows = await chatHistory(ctx.db, ctx.userId, {
      conversationId: input.conversationId,
      limit: 10,
    });
    const transcript = rows
      .filter((row) => row.role === "user" || row.role === "assistant")
      .reverse()
      .map((row) => `${row.role === "user" ? "them" : "you"}: ${row.content}`)
      .join("\n");
    if (transcript.trim().length === 0) {
      return { quip: null as string | null };
    }
    const { text } = await generateText({
      model: ctx.captionModel,
      system: CAPOFF_SYSTEM,
      prompt: `the conversation:\n${transcript}\n\nwrite the one-liner now.`,
    });
    const quip = text.trim();
    return { quip: (quip.length > 0 ? quip : null) as string | null };
  }),

  send: protectedProcedure.input(chatSendInput).mutation(async ({ ctx, input }) => {
    const outcome = await sendChatTurn(
      {
        db: ctx.db,
        model: ctx.model,
        flags: ctx.flags,
        userId: ctx.userId,
        storage: ctx.storage,
        replyModel: ctx.captionModel,
      },
      input,
    );
    /**
     * A deep talk the model just wrapped (14 §runner): settle it out of band —
     * immediate extraction, score recompute, reward grant — so the payoff is
     * visible without waiting for the 30-min idle sweep.
     */
    if (completedDeepTalkSlugs(outcome.message.toolCalls).length > 0) {
      const { db, model, userId } = ctx;
      ctx.scheduleBackground(() => settleDeepTalks(db, model, input.conversationId, userId));
    }
    if (outcome.needsCompaction) {
      ctx.scheduleBackground(() => runIdleJob(ctx.db, ctx.model, input.conversationId));
    }
    /**
     * The post-response ad-slotting decision (05). Runs out of band so it never
     * touches reply latency; the module owns every gate (eligibility, sensitive
     * suppression, frequency). Only scheduled when an ad network is configured —
     * with ads off (the default), the turn does zero extra work. `ctx.device`
     * carries the REAL client signals captured from the request headers.
     */
    const { db, flags, userId, adNetwork, device } = ctx;
    if (adNetwork) {
      ctx.scheduleBackground(() =>
        runAdDecision(
          { db, network: adNetwork, flags },
          { userId, conversationId: input.conversationId, turnMessageId: outcome.message.id, device },
        ),
      );
    }
    return outcome;
  }),

  /** Reserve an attachment + presigned upload target (09 §storage). */
  createUploadUrl: protectedProcedure
    .input(createUploadUrlInput)
    .mutation(({ ctx, input }) => createUpload(ctx.db, ctx.storage, ctx.userId, input)),

  /** The client's PUT finished — start ingest in the background (09). */
  attachmentUploaded: protectedProcedure
    .input(attachmentUploadedInput)
    .mutation(async ({ ctx, input }) => {
      const ok = await markUploaded(ctx.db, ctx.userId, input.attachmentId, input.waveform);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "attachment not found" });
      }
      ctx.scheduleBackground(() =>
        ingestAttachment(
          {
            db: ctx.db,
            storage: ctx.storage,
            captionModel: ctx.captionModel,
            transcriptionModel: ctx.transcriptionModel,
          },
          input.attachmentId,
        ),
      );
      return { ok: true };
    }),

  /** Re-run ingest for a `failed` attachment (09 §retry). */
  retryAttachment: protectedProcedure
    .input(retryAttachmentInput)
    .mutation(async ({ ctx, input }) => {
      const ok = await markRetrying(ctx.db, ctx.userId, input.attachmentId);
      if (!ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "attachment not found" });
      }
      ctx.scheduleBackground(() =>
        ingestAttachment(
          {
            db: ctx.db,
            storage: ctx.storage,
            captionModel: ctx.captionModel,
            transcriptionModel: ctx.transcriptionModel,
          },
          input.attachmentId,
        ),
      );
      return { ok: true };
    }),

  /** Poll ingest status + bubble render data for pending attachments (09). */
  attachmentStatus: protectedProcedure
    .input(attachmentStatusInput)
    .query(({ ctx, input }) =>
      attachmentStatuses(ctx.db, ctx.storage, ctx.userId, input.attachmentIds),
    ),

  history: protectedProcedure
    .input(chatHistoryInput)
    .query(async ({ ctx, input }) =>
      withAttachments(ctx.db, ctx.storage, await chatHistory(ctx.db, ctx.userId, input)),
    ),

  historyAround: protectedProcedure
    .input(chatHistoryAroundInput)
    .query(async ({ ctx, input }) =>
      withAttachments(ctx.db, ctx.storage, await chatHistoryAround(ctx.db, ctx.userId, input)),
    ),

  search: protectedProcedure
    .input(chatSearchInput)
    .query(({ ctx, input }) => chatSearch(ctx.db, ctx.userId, input)),

  react: protectedProcedure.input(chatReactInput).mutation(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ reactions: messages.reactions })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(messages.id, input.messageId), eq(conversations.userId, ctx.userId)))
      .limit(1);
    const message = rows[0];
    if (!message) {
      throw new TRPCError({ code: "NOT_FOUND", message: "message not found" });
    }

    const otherReactions = message.reactions.filter((reaction) => reaction.from !== "me");
    const current = message.reactions.find((reaction) => reaction.from === "me");
    let reactions: Reaction[] = otherReactions;
    if (input.type !== null && current?.type !== input.type) {
      reactions = [...otherReactions, { type: input.type, from: "me" }];
    }

    await ctx.db
      .update(messages)
      .set({ reactions })
      .where(eq(messages.id, input.messageId));
    return reactions;
  }),

  deleteMessage: protectedProcedure
    .input(chatDeleteMessageInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const owned = await tx
          .select({ id: messages.id })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .where(and(eq(messages.id, input.messageId), eq(conversations.userId, ctx.userId)))
          .limit(1);
        if (!owned[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "message not found" });
        }
        await tx
          .update(messages)
          .set({ replyToId: null })
          .where(eq(messages.replyToId, input.messageId));
        await tx.delete(messages).where(eq(messages.id, input.messageId));
      });
      return { ok: true };
    }),

  deviceToolResult: protectedProcedure
    .input(deviceToolResultInput)
    .mutation(({ ctx, input }) => recordDeviceToolResult(ctx.db, ctx.userId, input)),
});
