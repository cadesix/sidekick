import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  accounts,
  type Database,
  emailVerificationCodes,
  notificationPreferences,
  users,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  findOrCreateUserForProvider,
  getSessionFromAuthHeader,
  type SmsSender,
} from "@sidekick/server";
import { makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

/** An email seam fake that records every code it "sends", for the OTP tests. */
function capturingEmail() {
  const codes: string[] = [];
  return {
    sender: { sendOtp: async (_email: string, code: string) => void codes.push(code) },
    last: () => {
      const code = codes.at(-1);
      if (!code) {
        throw new Error("no code captured");
      }
      return code;
    },
  };
}

const emailCaller = (sender: { sendOtp: (email: string, code: string) => Promise<void> }) =>
  makeCaller(db, textModel("ok"), null, { authEmail: sender });

test("email OTP happy path: request → verify → session token works", async () => {
  const email = "happy@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const result = await caller.auth.verifyEmailCode({ email, code: last() });

  expect(result.isNewUser).toBe(true);
  const resolved = await getSessionFromAuthHeader(db, `Bearer ${result.token}`);
  expect(resolved?.userId).toBe(result.userId);
});

test("an expired code fails to verify", async () => {
  const email = "expiry@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const code = last();
  await db
    .update(emailVerificationCodes)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(emailVerificationCodes.email, email));

  await expect(caller.auth.verifyEmailCode({ email, code })).rejects.toThrow(/invalid or expired/i);
});

test("requesting a new code invalidates the prior one", async () => {
  const email = "invalidation@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const first = last();
  await caller.auth.requestEmailCode({ email });
  const second = last();

  await expect(caller.auth.verifyEmailCode({ email, code: first })).rejects.toThrow(
    /invalid or expired/i,
  );
  const ok = await caller.auth.verifyEmailCode({ email, code: second });
  expect(ok.userId).toBeTruthy();
});

test("the attempt cap blocks the correct code after 5 wrong tries", async () => {
  const email = "attempts@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const code = last();

  for (let i = 0; i < 5; i++) {
    await expect(caller.auth.verifyEmailCode({ email, code: "000000" })).rejects.toThrow();
  }
  await expect(caller.auth.verifyEmailCode({ email, code })).rejects.toThrow(/invalid or expired/i);
});

test("a consumed code cannot be reused", async () => {
  const email = "reuse@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const code = last();
  await caller.auth.verifyEmailCode({ email, code });

  await expect(caller.auth.verifyEmailCode({ email, code })).rejects.toThrow(/invalid or expired/i);
});

test("first verify creates the user + account + notification prefs; second signs in", async () => {
  const email = "findorcreate@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const created = await caller.auth.verifyEmailCode({ email, code: last() });
  expect(created.isNewUser).toBe(true);

  const userRows = await db.select().from(users).where(eq(users.id, created.userId));
  expect(userRows[0]?.email).toBe(email);
  expect(userRows[0]?.emailVerified).not.toBeNull();

  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, "email"), eq(accounts.providerAccountId, email)));
  expect(accountRows).toHaveLength(1);

  const prefs = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, created.userId));
  expect(prefs).toHaveLength(1);

  await caller.auth.requestEmailCode({ email });
  const returning = await caller.auth.verifyEmailCode({ email, code: last() });
  expect(returning.isNewUser).toBe(false);
  expect(returning.userId).toBe(created.userId);
});

test("a trusted provider with the same verified email links to the existing user", async () => {
  const email = "shared@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const viaEmail = await caller.auth.verifyEmailCode({ email, code: last() });

  // Same verified address via Google — links onto the existing user rather than
  // minting a duplicate: one user, two account rows.
  const viaGoogle = await findOrCreateUserForProvider(db, {
    provider: "google",
    providerAccountId: "google-sub-123",
    email,
    emailVerified: true,
  });

  expect(viaGoogle.isNewUser).toBe(false);
  expect(viaGoogle.userId).toBe(viaEmail.userId);
  const sharing = await db.select().from(users).where(eq(users.email, email));
  expect(sharing.length).toBe(1);
  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, viaEmail.userId));
  expect(accountRows.map((a) => a.provider).sort()).toEqual(["email", "google"]);
});

test("an UNverified provider email does not link — it cannot hijack the account", async () => {
  const email = "verified-owner@example.com";
  const { sender, last } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  const owner = await caller.auth.verifyEmailCode({ email, code: last() });

  // A provider asserting the same address but WITHOUT email verification must
  // never attach to the verified owner — it gets its own distinct weak identity.
  const unverified = await findOrCreateUserForProvider(db, {
    provider: "google",
    providerAccountId: "google-sub-unverified",
    email,
    emailVerified: false,
  });

  expect(unverified.isNewUser).toBe(true);
  expect(unverified.userId).not.toBe(owner.userId);
});

test("phone flow: approved verification creates a user with the phone identity", async () => {
  const phone = "+15551234567";
  const sms: SmsSender = { sendCode: async () => {}, verifyCode: async () => true };
  const caller = makeCaller(db, textModel("ok"), null, { sms });

  await caller.auth.requestPhoneCode({ phone });
  const result = await caller.auth.verifyPhoneCode({ phone, code: "123456" });

  expect(result.isNewUser).toBe(true);
  const userRows = await db.select().from(users).where(eq(users.id, result.userId));
  expect(userRows[0]?.phone).toBe(phone);
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, "phone"), eq(accounts.providerAccountId, phone)));
  expect(accountRows).toHaveLength(1);
});

test("a rejected phone code fails to verify", async () => {
  const phone = "+15559998888";
  const sms: SmsSender = { sendCode: async () => {}, verifyCode: async () => false };
  const caller = makeCaller(db, textModel("ok"), null, { sms });

  await expect(caller.auth.verifyPhoneCode({ phone, code: "000000" })).rejects.toThrow(
    /incorrect code/i,
  );
});

test("the 4th email request in the window is rate-limited", async () => {
  const email = "ratelimit@example.com";
  const { sender } = capturingEmail();
  const caller = emailCaller(sender);

  await caller.auth.requestEmailCode({ email });
  await caller.auth.requestEmailCode({ email });
  await caller.auth.requestEmailCode({ email });
  await expect(caller.auth.requestEmailCode({ email })).rejects.toThrow(/too many/i);
});

test("devLogin is rejected outside development and seeds a completed profile in it", async () => {
  const caller = makeCaller(db, textModel("ok"), null);
  const original = process.env.NODE_ENV;

  process.env.NODE_ENV = "test";
  await expect(caller.auth.devLogin()).rejects.toThrow(/development/i);

  try {
    process.env.NODE_ENV = "development";
    const first = await caller.auth.devLogin();
    expect(first.isNewUser).toBe(true);

    const rows = await db.select().from(users).where(eq(users.id, first.userId));
    expect(rows[0]?.email).toBe("dev@test.local");
    expect(rows[0]?.onboardingCompletedAt).not.toBeNull();

    const second = await caller.auth.devLogin();
    expect(second.isNewUser).toBe(false);
    expect(second.userId).toBe(first.userId);
  } finally {
    process.env.NODE_ENV = original;
  }
});
