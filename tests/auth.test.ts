import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { authSessions, devices, type Database } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  createSession,
  getSessionFromAuthHeader,
  registerDevice,
  revokeSession,
} from "@sidekick/server";
import { createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const bearer = (token: string) => `Bearer ${token}`;

test("a fresh token starts with sk_au_ and resolves to its user", async () => {
  const userId = await createUser(db);
  const { token, sessionId } = await createSession(db, userId);

  expect(token.startsWith("sk_au_")).toBe(true);

  const resolved = await getSessionFromAuthHeader(db, bearer(token));
  expect(resolved).toEqual({ userId, sessionId });
});

test("resolving with touch slides expiresAt forward", async () => {
  const userId = await createUser(db);
  const past = new Date(Date.now() + 1000 * 60 * 60); // 1h out, so still valid
  const { token, sessionId } = await createSession(db, userId, past);

  await getSessionFromAuthHeader(db, bearer(token));

  const row = await db.query.authSessions.findFirst({
    where: eq(authSessions.id, sessionId),
  });
  expect(row?.expiresAt.getTime()).toBeGreaterThan(past.getTime());
});

test("resolving with touch off leaves expiresAt untouched", async () => {
  const userId = await createUser(db);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
  const { token, sessionId } = await createSession(db, userId, expiresAt);

  const resolved = await getSessionFromAuthHeader(db, bearer(token), { touch: false });
  expect(resolved?.userId).toBe(userId);

  const row = await db.query.authSessions.findFirst({
    where: eq(authSessions.id, sessionId),
  });
  expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime());
});

test("an expired session resolves to null", async () => {
  const userId = await createUser(db);
  const { token } = await createSession(db, userId, new Date(Date.now() - 1000));
  expect(await getSessionFromAuthHeader(db, bearer(token))).toBeNull();
});

test("logout revokes the session; it then resolves to null", async () => {
  const userId = await createUser(db);
  const { token, sessionId } = await createSession(db, userId);
  expect(await getSessionFromAuthHeader(db, bearer(token))).not.toBeNull();

  await revokeSession(db, sessionId);
  expect(await getSessionFromAuthHeader(db, bearer(token))).toBeNull();
});

test("garbage and absent Authorization headers resolve to null", async () => {
  expect(await getSessionFromAuthHeader(db, null)).toBeNull();
  expect(await getSessionFromAuthHeader(db, "")).toBeNull();
  expect(await getSessionFromAuthHeader(db, "Bearer")).toBeNull();
  expect(await getSessionFromAuthHeader(db, bearer("sk_au_not-a-real-token"))).toBeNull();
});

test("registerDevice upserts on deviceId, repointing userId while keeping publicKey", async () => {
  const first = await createUser(db);
  const second = await createUser(db);

  await registerDevice(db, first, { deviceId: "device-shared", publicKey: "key-1" });
  const afterFirst = await db.query.devices.findFirst({
    where: eq(devices.deviceId, "device-shared"),
  });
  expect(afterFirst?.userId).toBe(first);
  expect(afterFirst?.publicKey).toBe("key-1");

  await registerDevice(db, second, { deviceId: "device-shared" });
  const afterSecond = await db.query.devices.findFirst({
    where: eq(devices.deviceId, "device-shared"),
  });
  expect(afterSecond?.id).toBe(afterFirst?.id);
  expect(afterSecond?.userId).toBe(second);
  expect(afterSecond?.publicKey).toBe("key-1");
});
