import {
  attachmentStatusInput,
  attachmentUploadedInput,
  chatHistoryAroundInput,
  chatHistoryInput,
  chatSearchInput,
  chatSendInput,
  createUploadUrlInput,
  deviceToolResultInput,
  retryAttachmentInput,
} from "@sidekick/shared";
import { TRPCError } from "@trpc/server";
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
import type { Database } from "@sidekick/db";
import { runIdleJob } from "../jobs/idle";
import { completedDeepTalkSlugs, settleDeepTalks } from "../deep-talks/session";
import { adsForMessages, runAdDecision } from "../ads";

/**
 * Attach each message's attachments and, for ad rows, the `SponsoredCard` render
 * payload (05 / 09) — both keyed by message id for thread rendering.
 */
async function withAttachments<T extends { id: number }>(
  db: Database,
  storage: Storage,
  rows: T[],
) {
  const ids = rows.map((r) => r.id);
  const [byMessage, adByMessage] = await Promise.all([
    attachmentsForMessages(db, storage, ids),
    adsForMessages(db, ids),
  ]);
  return rows.map((row) => ({
    ...row,
    attachments: byMessage.get(row.id) ?? [],
    ad: adByMessage.get(row.id) ?? null,
  }));
}

export const chatRouter = router({
  mainConversation: protectedProcedure.query(({ ctx }) =>
    ensureMainConversation(ctx.db, ctx.userId),
  ),

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
      const ok = await markUploaded(ctx.db, ctx.userId, input.attachmentId);
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
      withAttachments(ctx.db, ctx.storage, await chatHistory(ctx.db, input)),
    ),

  historyAround: protectedProcedure
    .input(chatHistoryAroundInput)
    .query(async ({ ctx, input }) =>
      withAttachments(ctx.db, ctx.storage, await chatHistoryAround(ctx.db, input)),
    ),

  search: protectedProcedure
    .input(chatSearchInput)
    .query(({ ctx, input }) => chatSearch(ctx.db, input)),

  deviceToolResult: protectedProcedure
    .input(deviceToolResultInput)
    .mutation(({ ctx, input }) => recordDeviceToolResult(ctx.db, ctx.userId, input)),
});
