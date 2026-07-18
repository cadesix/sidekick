import { gameCreateInput, gameMatchRefInput, gameTurnInput } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import {
  createMatch,
  gameRecord,
  getMatch,
  playTurn,
  resignMatch,
} from "../games/service";

/**
 * Chat mini-games (plan 21 §Server): the generic match backbone both 8 Ball and
 * Cup Pong ride on. Follows the plan-20 domain recipe — idempotent mutations,
 * coin movement through the ledger, days via `localDate(users.timezone)`. The
 * client is authoritative for the user's turns; the server runs the sidekick's
 * with the same deterministic engine and stores its shots for replay.
 */
export const gamesRouter = router({
  /** Start (or resume the active) match of a type; the sidekick breaks first. */
  create: protectedProcedure.input(gameCreateInput).mutation(({ ctx, input }) => {
    return createMatch(ctx.db, ctx.userId, input.gameType);
  }),

  /** The full match state (incl. `lastTurn`) for opening the overlay. */
  get: protectedProcedure.input(gameMatchRefInput).query(({ ctx, input }) => {
    return getMatch(ctx.db, ctx.userId, input.matchId);
  }),

  /** Submit one completed user turn; returns the sidekick's reply already applied. */
  turn: protectedProcedure.input(gameTurnInput).mutation(({ ctx, input }) => {
    return playTurn(ctx.db, ctx.userId, input, ctx.model);
  }),

  /** Concede an active match to the sidekick (no coins, no reaction). */
  resign: protectedProcedure.input(gameMatchRefInput).mutation(({ ctx, input }) => {
    return resignMatch(ctx.db, ctx.userId, input.matchId);
  }),

  /** Lifetime win/loss record per game type, for the picker sheet. */
  record: protectedProcedure.query(({ ctx }) => gameRecord(ctx.db, ctx.userId)),
});
