import { TRPCError } from "@trpc/server";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { type Database, users } from "@sidekick/db";
import { addDays, localDate, userTimezone } from "@sidekick/shared";

export type StreakTouch = {
  /** `users.stateVersion` after the touch (unchanged on a same-day no-op). */
  stateVersion: number;
  count: number;
  /** True only when the count changed — a same-day re-touch is a pure read. */
  extended: boolean;
};

/**
 * The app-open streak (plan 20 decision 7) — a faithful port of core's
 * `computeStreak`: same local day → no-op, consecutive day → +1, gap → reset
 * to 1. "Today" comes from the server clock + `users.timezone`, never the
 * client. The day math lives in one conditional UPDATE so a concurrent
 * double-fire (two foregrounds at the same instant) increments exactly once:
 * the second writer re-evaluates the WHERE against the committed row, sees
 * `streakLastDay = today`, and falls through to the no-op read.
 */
export async function touchStreak(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<StreakTouch> {
  const timezone = await userTimezone(db, userId);
  const today = localDate(timezone, now);
  const yesterday = addDays(today, -1);

  const updated = await db
    .update(users)
    .set({
      streakCount: sql`case when ${users.streakLastDay} = ${yesterday} then ${users.streakCount} + 1 else 1 end`,
      streakLastDay: today,
      stateVersion: sql`${users.stateVersion} + 1`,
    })
    .where(
      and(eq(users.id, userId), or(isNull(users.streakLastDay), ne(users.streakLastDay, today))),
    )
    .returning({ count: users.streakCount, stateVersion: users.stateVersion });
  const touched = updated[0];
  if (touched) {
    return { ...touched, extended: true };
  }

  const rows = await db
    .select({ count: users.streakCount, stateVersion: users.stateVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const current = rows[0];
  if (!current) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return { ...current, extended: false };
}
