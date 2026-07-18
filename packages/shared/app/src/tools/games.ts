import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { gameMatches, messages, users } from "@sidekick/db";
import { cupPong, eightBall, gameTypeSchema } from "@sidekick/core";
import { localDate } from "../goals/dates";
import { defineTool, type SidekickTool, type ToolContext } from "./types";

/**
 * How long a sidekick invite the user never opened stays "active" before it's
 * considered expired/unplayed (matches the match backbone's 48h lazy expiry).
 */
const EXPIRY_MS = 48 * 60 * 60 * 1000;

/**
 * Chat-side guidance for the games capability (plan 21 §"How the agent behaves"
 * + §invite tool). Static and per-day-stable so it lives in the cacheable prompt
 * region. The persona already owns the lowercase-texty voice; this only adds the
 * restraint rules and what the tool is for. Shared with the completion reaction
 * prompt so the one-message tone is identical in and out of a turn.
 */
export const GAMES_CHAT_GUIDANCE = `GAMES: you can play 8 ball and cup pong with the user, right in the chat.
react to a finished game like a friend who was just playing: one short message max,
then drop it unless they bring it up. be specific only when something was actually
notable (the highlights you're shown are what's notable — if there are none, a plain
"gg" beats invented enthusiasm). you're allowed to be smug when you win and a good
sport when you lose. never fake-sympathize ("so close!!") and never recite scores or
stats unasked. offer a rematch occasionally, not every time. don't bring up the
record unless they do. mid-match, don't commentate — the game speaks for itself.
you can start a game with invite_game, but rarely: when they ask to play, when they
seem bored or want a break, or to settle something playfully. never as a reflex,
never twice in a row after they ignored one, and most conversations should have zero
invites. set prompted true only when they actually asked to play this turn.
a GAMES block may appear with the active match, the last one, and the record — that's
your context to react from, never a script to read back.`;

const inviteGameInput = z.object({
  gameType: gameTypeSchema,
  /** True only when the user asked to play this turn; false rate-limits the sidekick. */
  prompted: z.boolean(),
});

/** The user's IANA timezone, for local-day math. */
async function userTimezone(ctx: ToolContext): Promise<string> {
  const rows = await ctx.db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  return rows[0]?.timezone ?? "UTC";
}

/**
 * Sidekick-initiated games (plan 21 §"Agent-initiated games"). A server tool so
 * the identical path works from proactive turns later. Guards are enforced here,
 * never trusted to the model: no active match of the type; and for unprompted
 * invites, at most one sidekick-initiated match per local day, skipped entirely
 * if the last sidekick invite went unanswered (expired unplayed at turn 0) — one
 * ignored ask means don't ask again until they bring it up.
 *
 * On success it creates the match (initiator 'sidekick', the user breaks — no
 * sidekick first turn, state.toMove 'user') and inserts the assistant-role card
 * message; the model's own streamed text ("loser buys coffee") is the adjacent
 * bubble. Creation is inlined off `ctx.db` + core rather than the server-only
 * `games/service.ts` (shared/app cannot import `@sidekick/server`): the invited
 * flow shares no code with `createMatch`, which breaks for the sidekick instead.
 */
export const gamesTools: SidekickTool[] = [
  defineTool({
    name: "invite_game",
    description:
      "Start a game of 8 ball or cup pong with the user (they break first). Use rarely: when they ask to play, seem bored, or to settle something playfully — never as a reflex, and most chats have zero invites. Set prompted true only if they asked to play this turn.",
    execution: "server",
    parameters: inviteGameInput,
    execute: async ({ gameType, prompted }, ctx) => {
      const { db, userId, conversationId } = ctx;
      const now = new Date();

      const active = await db
        .select({ id: gameMatches.id })
        .from(gameMatches)
        .where(
          and(
            eq(gameMatches.userId, userId),
            eq(gameMatches.gameType, gameType),
            eq(gameMatches.status, "active"),
          ),
        )
        .limit(1);
      if (active[0]) {
        return { ok: false, reason: "a match of that game is already going" };
      }

      if (!prompted) {
        const timezone = await userTimezone(ctx);
        const today = localDate(timezone, now);
        const invited = await db
          .select({ createdAt: gameMatches.createdAt, status: gameMatches.status })
          .from(gameMatches)
          .where(and(eq(gameMatches.userId, userId), eq(gameMatches.initiator, "sidekick")));
        const todayCount = invited.filter((row) => localDate(timezone, row.createdAt) === today).length;
        if (todayCount >= 1) {
          return { ok: false, reason: "already offered a game today" };
        }

        const recent = await db
          .select({
            status: gameMatches.status,
            turnNo: gameMatches.turnNo,
            updatedAt: gameMatches.updatedAt,
          })
          .from(gameMatches)
          .where(and(eq(gameMatches.userId, userId), eq(gameMatches.initiator, "sidekick")))
          .orderBy(desc(gameMatches.createdAt))
          .limit(1);
        const last = recent[0];
        if (last && last.turnNo === 0) {
          const stale = now.getTime() - last.updatedAt.getTime() > EXPIRY_MS;
          if (last.status === "expired" || (last.status === "active" && stale)) {
            return { ok: false, reason: "last invite went unanswered" };
          }
        }
      }

      const seed = Math.floor(Math.random() * 2 ** 31);
      const state =
        gameType === "eight_ball"
          ? eightBall.initialRack(seed, "user")
          : cupPong.initialState("user");
      const inserted = await db
        .insert(gameMatches)
        .values({
          userId,
          conversationId,
          gameType,
          initiator: "sidekick",
          status: "active",
          state,
          turnNo: 0,
          seed,
        })
        .returning({ id: gameMatches.id });
      const matchId = inserted[0]?.id;
      if (!matchId) {
        return { ok: false, reason: "could not start the match" };
      }
      await db.insert(messages).values({
        conversationId,
        role: "assistant",
        content: "",
        tokenEstimate: 0,
        gameMatchId: matchId,
      });
      return { ok: true, matchId, gameType };
    },
  }),
];
