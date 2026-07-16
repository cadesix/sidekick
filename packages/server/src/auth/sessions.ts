import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type Database, authSessions } from "@sidekick/db";

const GENERAL_TOKEN_PREFIX = "sk";
const AUTH_TOKEN_PREFIX = "au";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
/**
 * Only slide a session forward once it has aged past this, so an active session
 * isn't re-written on every request — one bump per day keeps the 30-day window
 * fresh without adding a write to the hot path.
 */
const SESSION_TOUCH_INTERVAL_MS = 1000 * 60 * 60 * 24;

export function hashSha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export type ResolvedSession = { userId: string; sessionId: string };

/**
 * Resolve a raw `Authorization` header value to its session, or null. Sliding
 * 30-day expiry: every authed request touches `expiresAt` unless `touch` is off.
 */
export async function getSessionFromAuthHeader(
  db: Database,
  authorization: string | null,
  { touch = true }: { touch?: boolean } = {},
): Promise<ResolvedSession | null> {
  if (!authorization) {
    return null;
  }
  const [, token] = authorization.split(" ");
  if (!token) {
    return null;
  }

  const hashedToken = hashSha256(token);
  const session = await db.query.authSessions.findFirst({
    where: and(eq(authSessions.hashedToken, hashedToken), isNull(authSessions.deletedAt)),
  });
  if (!session) {
    return null;
  }

  const now = Date.now();
  if (session.expiresAt.getTime() < now) {
    return null;
  }

  if (touch && session.expiresAt.getTime() - now < SESSION_TTL_MS - SESSION_TOUCH_INTERVAL_MS) {
    await db
      .update(authSessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(authSessions.id, session.id));
  }

  return { userId: session.userId, sessionId: session.id };
}

export async function createSession(
  db: Database,
  userId: string,
  expiresAt?: Date,
): Promise<{ token: string; sessionId: string }> {
  const { token, hash } = createAuthToken();
  const inserted = await db
    .insert(authSessions)
    .values({
      userId,
      hashedToken: hash,
      expiresAt: expiresAt ?? new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning({ id: authSessions.id });
  const session = inserted[0];
  if (!session) {
    throw new Error("failed to create session");
  }
  return { token, sessionId: session.id };
}

/** Soft-delete a session (logout) — resolves to null on any future request. */
export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ deletedAt: new Date() })
    .where(eq(authSessions.id, sessionId));
}

export function createAuthToken(): { token: string; hash: string } {
  const token = `${GENERAL_TOKEN_PREFIX}_${AUTH_TOKEN_PREFIX}_${createTokenData()}`;
  const hash = hashSha256(token);
  return { token, hash };
}

function createTokenData(): string {
  return crypto
    .randomBytes(128)
    .toString("base64url")
    .replaceAll("_", "c")
    .replaceAll("-", "Q")
    .replaceAll("0", "S")
    .replaceAll("O", "2")
    .replaceAll("1", "p")
    .replaceAll("I", "8")
    .replaceAll("L", "d")
    .replaceAll("l", "b");
}
