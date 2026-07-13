import { eq } from "drizzle-orm";
import { adProfiles } from "@sidekick/db";
import { memoryEditInput, memoryForgetInput } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { editMemory, forgetMemory, listMemories } from "../memory/store";

/**
 * "What my sidekick knows" surface (user-memory.md §7). Read-only list plus
 * user-sourced forget (tombstone + suppression) and edit (user_edit
 * supersession). The ad profile is shown on the same screen.
 */
export const memoryRouter = router({
  list: protectedProcedure.query(({ ctx }) => listMemories(ctx.db, ctx.userId)),

  forget: protectedProcedure
    .input(memoryForgetInput)
    .mutation(({ ctx, input }) => forgetMemory(ctx.db, ctx.userId, input.memoryId)),

  edit: protectedProcedure
    .input(memoryEditInput)
    .mutation(({ ctx, input }) => editMemory(ctx.db, ctx.userId, input.memoryId, input.content)),

  adProfile: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(adProfiles)
      .where(eq(adProfiles.userId, ctx.userId))
      .limit(1);
    return rows[0] ?? null;
  }),
});
