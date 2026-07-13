import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { type Database, devices, users } from "@sidekick/db";
import type { RegisterInput } from "@sidekick/shared";

export type RegisterResult = { userId: string; token: string };

/**
 * Register (or re-attach) an anonymous device account. Idempotent on `deviceId`:
 * a device that already has an identity gets its existing user + token back, so
 * a relaunch never orphans an account.
 */
export async function registerDevice(db: Database, input: RegisterInput): Promise<RegisterResult> {
  const existing = await db
    .select({ userId: devices.userId, token: devices.token })
    .from(devices)
    .where(eq(devices.deviceId, input.deviceId))
    .limit(1);
  const found = existing[0];
  if (found) {
    return { userId: found.userId, token: found.token };
  }

  const token = randomBytes(32).toString("base64url");
  const inserted = await db.insert(users).values({}).returning({ id: users.id });
  const user = inserted[0];
  if (!user) {
    throw new Error("failed to create user");
  }
  await db.insert(devices).values({
    userId: user.id,
    deviceId: input.deviceId,
    publicKey: input.publicKey,
    token,
  });
  return { userId: user.id, token };
}

/** Resolve a bearer token to a userId, or null if unknown. */
export async function resolveUserId(db: Database, token: string | null): Promise<string | null> {
  if (!token) {
    return null;
  }
  const rows = await db
    .select({ userId: devices.userId })
    .from(devices)
    .where(eq(devices.token, token))
    .limit(1);
  return rows[0]?.userId ?? null;
}
