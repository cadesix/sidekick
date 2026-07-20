import * as Sentry from "@sentry/node";
import { initTRPC, TRPCError } from "@trpc/server";
import type { AppContext } from "./context";
import { logger } from "./logger";

const t = initTRPC.context<AppContext>().create({
  /**
   * Deliberate `TRPCError`s (BAD_REQUEST/UNAUTHORIZED/…) carry curated, user-safe
   * messages and pass through unchanged. An `INTERNAL_SERVER_ERROR` is an
   * unexpected throw — a DB failure, a bug — whose raw message can leak schema,
   * constraint names, or internal detail; collapse it to a generic string so the
   * client never sees it. (Stacks are already withheld outside development.)
   */
  errorFormatter({ shape, error }) {
    /**
     * Report the unexpected throws plus `BAD_REQUEST` — the latter catches schema
     * drift from an older shipped client sending payloads the new server rejects.
     * Auth failures and not-founds are normal traffic and would only be noise.
     */
    if (error.code === "INTERNAL_SERVER_ERROR" || error.code === "BAD_REQUEST") {
      logger.error({ err: error, code: error.code }, "trpc procedure failed");
      Sentry.captureException(error);
    }
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
