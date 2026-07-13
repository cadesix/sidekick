import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type Database, devices, users } from "@sidekick/db";
import type { RegisterInput } from "@sidekick/shared";

export type RegisterResult = { userId: string; token: string };

function scrypt(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

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

export async function accountStatus(
  db: Database,
  userId: string,
): Promise<{ email: string | null }> {
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return { email: rows[0]?.email ?? null };
}

export async function createEmailAccount(
  db: Database,
  input: { userId: string; email: string; password: string },
): Promise<{ email: string }> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const updated = await db
    .update(users)
    .set({ email, passwordHash, updatedAt: new Date() })
    .where(and(eq(users.id, input.userId), isNull(users.email)))
    .returning({ id: users.id });
  if (!updated[0]) {
    throw new Error("account already has credentials");
  }
  return { email };
}

export async function signInWithEmail(
  db: Database,
  input: { deviceId: string; email: string; password: string },
): Promise<RegisterResult | null> {
  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normalizeEmail(input.email)))
    .limit(1);
  const account = rows[0];
  if (!account?.passwordHash || !(await passwordMatches(input.password, account.passwordHash))) {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const existing = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.deviceId, input.deviceId))
    .limit(1);
  if (existing[0]) {
    await db
      .update(devices)
      .set({ userId: account.id, token, lastSeenAt: new Date() })
      .where(eq(devices.id, existing[0].id));
  } else {
    await db.insert(devices).values({ userId: account.id, deviceId: input.deviceId, token });
  }
  return { userId: account.id, token };
}
