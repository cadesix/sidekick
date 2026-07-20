import { type Database, rateLimits } from "@sidekick/db";
import { lt, sql } from "drizzle-orm";

/** How many attempts are allowed per key per window. */
export type RateLimit = { points: number; windowMs: number };

/**
 * Email OTP requests: 3 per address per 15 minutes (19-auth.md). Keyed on the
 * identifier rather than the IP — tRPC has no per-request IP in ctx today.
 */
export const EMAIL_CODE_LIMIT: RateLimit = { points: 3, windowMs: 15 * 60 * 1000 };

/** Phone OTP requests: 3 per number per hour (scaleshot's per-phone limit). */
export const PHONE_CODE_LIMIT: RateLimit = { points: 3, windowMs: 60 * 60 * 1000 };

/**
 * Chat turns: 30 per user per minute — well above human pace, but it caps what a
 * stolen token can spend on model inference before anyone notices.
 */
export const CHAT_TURN_LIMIT: RateLimit = { points: 30, windowMs: 60 * 1000 };

/**
 * Record an attempt for `key`; false once the window is already full.
 *
 * Durable rather than in-process: on Vercel an in-memory counter is per-lambda, so
 * the effective allowance multiplied by however many instances happened to be
 * warm. Fixed windows (not sliding) keep the whole check to one atomic upsert that
 * every instance shares — the row carries the current window's start, and a hit
 * whose window has rolled over resets the counter to 1 in the same statement. The
 * tradeoff is that a burst straddling a boundary can spend two windows' worth of
 * points, which for OTP sends and chat turns is immaterial.
 */
export async function consumeRateLimit(
  db: Database,
  key: string,
  limit: RateLimit,
  now: Date = new Date(),
): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / limit.windowMs) * limit.windowMs);
  const rows = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        windowStart: sql`excluded.window_start`,
        count: sql`case when ${rateLimits.windowStart} = excluded.window_start then ${rateLimits.count} + 1 else 1 end`,
      },
    })
    .returning({ count: rateLimits.count });
  return (rows[0]?.count ?? 1) <= limit.points;
}

/**
 * Drop counters whose window closed long ago, so the table stays proportional to
 * recently-active keys instead of every address that ever requested a code. Runs
 * on the idle cron; a row whose window is still live is never touched.
 */
export async function pruneRateLimits(
  db: Database,
  now: Date = new Date(),
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - maxAgeMs)));
}
