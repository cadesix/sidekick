import { focusMirrorInput } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { getFocusSettings, updateFocusSettings } from "../focus/mirror";

/**
 * Focus mode mirror surface (13-focus-mode.md). `get` feeds the home shield chip,
 * the setup screen's current state, and the `focus_status` device tool; `update`
 * is what the app posts after each native focus op so the mirror reflects on/off,
 * budget, and app count. No app identity ever crosses this router.
 */
export const focusRouter = router({
  get: protectedProcedure.query(({ ctx }) => getFocusSettings(ctx.db, ctx.userId)),

  update: protectedProcedure
    .input(focusMirrorInput)
    .mutation(({ ctx, input }) => updateFocusSettings(ctx.db, ctx.userId, input)),
});
