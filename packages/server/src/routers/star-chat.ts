import { starChatControllerInput, starChatStateInput } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { starChatArtifact, starChatCard, starChatController } from "../star-chat/service";

/**
 * The Star Chat's LLM turns (docs/STAR-CHAT.md), server-side: the client keeps
 * the conversation state and the UI, and posts that state here so the server
 * builds every prompt from core's builders with the model key it holds. `text:
 * null` on model failure — the runner falls back to its scripted lines.
 */
export const starChatRouter = router({
  /** Deepen the astral card at a chapter boundary (prior card read server-side). */
  card: protectedProcedure.input(starChatStateInput).mutation(async ({ ctx, input }) => {
    const text = await starChatCard(ctx.db, ctx.sessionModel, ctx.userId, input);
    return { text };
  }),

  /** The end-of-chat artifact: the reading plus its evidence-cited insights. */
  artifact: protectedProcedure.input(starChatStateInput).mutation(async ({ ctx, input }) => {
    const text = await starChatArtifact(ctx.sessionModel, input);
    return { text };
  }),

  /** One controller turn over the recent transcript: react + extract + steer. */
  controller: protectedProcedure.input(starChatControllerInput).mutation(async ({ ctx, input }) => {
    const text = await starChatController(ctx.sessionModel, input);
    return { text };
  }),
});
