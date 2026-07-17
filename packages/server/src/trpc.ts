import { initTRPC, TRPCError } from "@trpc/server";
import type { AppContext } from "./context";

const t = initTRPC.context<AppContext>().create({
  /**
   * Deliberate `TRPCError`s (BAD_REQUEST/UNAUTHORIZED/…) carry curated, user-safe
   * messages and pass through unchanged. An `INTERNAL_SERVER_ERROR` is an
   * unexpected throw — a DB failure, a bug — whose raw message can leak schema,
   * constraint names, or internal detail; collapse it to a generic string so the
   * client never sees it. (Stacks are already withheld outside development.)
   */
  errorFormatter({ shape, error }) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      return { ...shape, message: "Internal server error" };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Requires an authenticated device account; narrows `ctx.userId` to string. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
