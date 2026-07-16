import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, reminders, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { makeCaller, textModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function makeUser(deviceId: string): Promise<string> {
  const userId = await createUser(db);
  await db.update(users).set({ timezone: "America/New_York" }).where(eq(users.id, userId));
  return userId;
}

async function addReminder(
  userId: string,
  schedule: Record<string, unknown>,
  nextFireAt: Date,
  status = "active",
): Promise<string> {
  const inserted = await db
    .insert(reminders)
    .values({ userId, text: "call mom", schedule, timezone: "America/New_York", nextFireAt, status })
    .returning({ id: reminders.id });
  return inserted[0]!.id;
}

function caller(userId: string) {
  return makeCaller(db, textModel("noop"), userId);
}

test("list groups reminders into today / upcoming / paused", async () => {
  const userId = await makeUser("rem-router-list");
  // `list` derives "today" from its own `new Date()`, so anchor the reminders to
  // an instant that can't cross midnight relative to that clock: a reminder at/just
  // before now is always in the today-or-earlier bucket, one 10 days out is always
  // upcoming — regardless of the reminder timezone or the time of day the test runs.
  const now = new Date();
  await addReminder(userId, { type: "once", at: "2099-01-01T09:00" }, new Date(now.getTime() - 60_000));
  await addReminder(
    userId,
    { type: "recurring", rrule: "FREQ=DAILY", time: "08:00" },
    new Date(now.getTime() + 10 * 86_400_000),
  );
  await addReminder(userId, { type: "once", at: "2099-01-01T09:00" }, new Date(now.getTime() - 60_000), "paused");

  const result = await caller(userId).reminders.list();
  expect(result.today).toHaveLength(1);
  expect(result.upcoming).toHaveLength(1);
  expect(result.paused).toHaveLength(1);
  expect(result.today[0]?.schedule?.type).toBe("once");
});

test("update edits text and recomputes on a schedule change", async () => {
  const userId = await makeUser("rem-router-update");
  const id = await addReminder(userId, { type: "once", at: "2099-07-10T17:00" }, new Date("2099-07-10T21:00:00Z"));

  await caller(userId).reminders.update({
    id,
    text: "call dad",
    schedule: { type: "once", at: "2099-08-01T09:00" },
  });
  const row = (await db.select().from(reminders).where(eq(reminders.id, id)))[0];
  expect(row?.text).toBe("call dad");
  expect(row?.nextFireAt?.toISOString()).toBe("2099-08-01T13:00:00.000Z");
});

test("pause then resume moves a reminder between sections and rebuilds nextFireAt", async () => {
  const userId = await makeUser("rem-router-pause");
  const id = await addReminder(
    userId,
    { type: "recurring", rrule: "FREQ=DAILY", time: "08:00" },
    new Date("2099-07-10T12:00:00Z"),
  );

  await caller(userId).reminders.pause({ id });
  let listed = await caller(userId).reminders.list();
  expect(listed.paused.map((r) => r.id)).toContain(id);

  await caller(userId).reminders.resume({ id });
  const row = (await db.select().from(reminders).where(eq(reminders.id, id)))[0];
  expect(row?.status).toBe("active");
  expect(row?.nextFireAt).toBeInstanceOf(Date);

  listed = await caller(userId).reminders.list();
  expect(listed.paused.map((r) => r.id)).not.toContain(id);
});

test("remove soft-deletes and drops the reminder from the list", async () => {
  const userId = await makeUser("rem-router-remove");
  const id = await addReminder(userId, { type: "once", at: "2099-07-10T17:00" }, new Date("2099-07-10T21:00:00Z"));

  await caller(userId).reminders.remove({ id });
  const row = (await db.select().from(reminders).where(eq(reminders.id, id)))[0];
  expect(row?.status).toBe("deleted");

  const listed = await caller(userId).reminders.list();
  const allIds = [...listed.today, ...listed.upcoming, ...listed.paused].map((r) => r.id);
  expect(allIds).not.toContain(id);
});

test("a caller cannot mutate another user's reminder", async () => {
  const owner = await makeUser("rem-router-owner");
  const stranger = await makeUser("rem-router-stranger");
  const id = await addReminder(owner, { type: "once", at: "2099-07-10T17:00" }, new Date("2099-07-10T21:00:00Z"));

  await expect(caller(stranger).reminders.remove({ id })).rejects.toThrow();
});
