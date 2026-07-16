import { eq, sql } from "drizzle-orm";
import { type Database, users } from "@sidekick/db";

/** Matches the `users.timezone` column default; every scheduling decision is made in this zone. */
export const DEFAULT_TIMEZONE = "America/New_York";

export async function userTimezone(db: Database, userId: string): Promise<string> {
  const rows = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.timezone ?? DEFAULT_TIMEZONE;
}

/** Bump the sync/cache primitive after any change to a user's memory set. */
export async function bumpMemoryVersion(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ memoryVersion: sql`${users.memoryVersion} + 1` })
    .where(eq(users.id, userId));
}
