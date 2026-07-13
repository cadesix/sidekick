import { afterAll, beforeAll, expect, test } from "vitest";
import type { Database } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { registerDevice, resolveUserId } from "@sidekick/server";
import { makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("register creates a user + token and is idempotent per device", async () => {
  const caller = makeCaller(db, textModel("hi"), null);
  const first = await caller.auth.register({ deviceId: "device-abc-123" });
  expect(first.userId).toBeTruthy();
  expect(first.token).toBeTruthy();

  const again = await caller.auth.register({ deviceId: "device-abc-123" });
  expect(again.userId).toBe(first.userId);
  expect(again.token).toBe(first.token);
});

test("a token resolves to its userId; an unknown token resolves to null", async () => {
  const { userId, token } = await registerDevice(db, { deviceId: "device-resolve-1" });
  expect(await resolveUserId(db, token)).toBe(userId);
  expect(await resolveUserId(db, "not-a-real-token")).toBeNull();
  expect(await resolveUserId(db, null)).toBeNull();
});

test("email credentials claim the current user and sign in another device", async () => {
  const registered = await registerDevice(db, { deviceId: "device-email-owner" });
  const owner = makeCaller(db, textModel("hi"), registered.userId);

  await expect(
    owner.auth.createEmailAccount({ email: " Person@Example.COM ", password: "secure-password" }),
  ).resolves.toEqual({ email: "person@example.com" });
  await expect(owner.auth.status()).resolves.toEqual({ email: "person@example.com" });

  const publicCaller = makeCaller(db, textModel("hi"), null);
  const signedIn = await publicCaller.auth.signIn({
    deviceId: "device-email-second",
    email: "person@example.com",
    password: "secure-password",
  });
  expect(signedIn.userId).toBe(registered.userId);
  expect(await resolveUserId(db, signedIn.token)).toBe(registered.userId);
});

test("email sign-in rejects an incorrect password", async () => {
  const caller = makeCaller(db, textModel("hi"), null);
  await expect(
    caller.auth.signIn({
      deviceId: "device-email-wrong",
      email: "person@example.com",
      password: "wrong-password",
    }),
  ).rejects.toThrow("Incorrect email or password");
});
