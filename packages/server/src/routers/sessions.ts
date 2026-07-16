import {
  sessionAckInput,
  sessionCompleteInput,
  sessionExtractInput,
  sessionProgressInput,
} from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import {
  ackSessionAnswer,
  completeGuidedSession,
  extractSession,
  saveSessionProgress,
  sessionProfile,
} from "../sessions/service";

/**
 * Guided (star) sessions, server-side (plan 20 decision 9): the client keeps the
 * scripted beats and UI phases; every answer lands here, so the server holds the
 * authoritative transcript, runs the LLM calls the client used to make with a
 * bundled OpenAI key, and pays rewards from core's catalog — never from payloads.
 */
export const sessionsRouter = router({
  /** Upsert the transcript after every answer; rejected once the session is done. */
  progress: protectedProcedure.input(sessionProgressInput).mutation(({ ctx, input }) => {
    return saveSessionProgress(ctx.db, ctx.userId, input);
  }),

  /** One in-voice reaction to the just-stored answer; `text: null` on LLM failure
   * (the client falls back to its scripted lines). */
  ack: protectedProcedure.input(sessionAckInput).mutation(async ({ ctx, input }) => {
    const text = await ackSessionAnswer(ctx.db, ctx.sessionModel, ctx.userId, input);
    return { text };
  }),

  /** The extraction pass over server-stored answers (re-runnable with recap
   * corrections); null when the model failed — nothing is persisted either way. */
  extract: protectedProcedure.input(sessionExtractInput).mutation(({ ctx, input }) => {
    return extractSession(ctx.db, ctx.sessionModel, ctx.userId, input);
  }),

  /** The guarded completion: persist the confirmed extraction, pay catalog rewards. */
  complete: protectedProcedure.input(sessionCompleteInput).mutation(({ ctx, input }) => {
    return completeGuidedSession(ctx.db, ctx.userId, input);
  }),

  /** Extracted fields/notes/astral for the star chat (kept out of the snapshot). */
  profile: protectedProcedure.query(({ ctx }) => {
    return sessionProfile(ctx.db, ctx.userId);
  }),
});
