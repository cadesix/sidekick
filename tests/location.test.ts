import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, reminders, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { computeNextFireAt } from "@sidekick/shared";
import { makeCaller, textModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("a timezone change refreezes reminders and recomputes nextFireAt", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ timezone: "America/New_York" }).where(eq(users.id, userId));

  const schedule = { type: "recurring" as const, rrule: "FREQ=DAILY", time: "07:30" };
  const createdAt = new Date("2026-07-01T00:00:00.000Z");
  const originalFire = computeNextFireAt(schedule, "America/New_York", createdAt, createdAt);
  const inserted = await db
    .insert(reminders)
    .values({
      userId,
      text: "take meds",
      schedule,
      timezone: "America/New_York",
      nextFireAt: originalFire,
      status: "active",
      createdAt,
    })
    .returning({ id: reminders.id });
  const reminderId = inserted[0]!.id;

  const caller = makeCaller(db, textModel("ok"), userId);
  const result = await caller.location.update({
    city: "San Francisco",
    region: "California",
    country: "United States",
    timezone: "America/Los_Angeles",
  });
  expect(result.timezoneChanged).toBe(true);

  const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  expect(userRow[0]?.timezone).toBe("America/Los_Angeles");
  expect(userRow[0]?.lastCity).toBe("San Francisco");

  const reminderRow = await db.select().from(reminders).where(eq(reminders.id, reminderId)).limit(1);
  expect(reminderRow[0]?.timezone).toBe("America/Los_Angeles");
  const expected = computeNextFireAt(schedule, "America/Los_Angeles", new Date(), createdAt);
  expect(expected).not.toBeNull();
  expect(originalFire).not.toBeNull();
  expect(reminderRow[0]?.nextFireAt?.getTime()).toBe(expected?.getTime());
  expect(reminderRow[0]?.nextFireAt?.getTime()).not.toBe(originalFire?.getTime());
});

test("disconnect clears the stored location fields", async () => {
  const userId = await createUser(db);
  const caller = makeCaller(db, textModel("ok"), userId);
  await caller.location.update({ city: "Chicago", region: "Illinois" });

  const before = await caller.location.status();
  expect(before.connected).toBe(true);
  expect(before.city).toBe("Chicago");

  await caller.location.disconnect();
  const after = await caller.location.status();
  expect(after.connected).toBe(false);
  expect(after.city).toBe(null);
});
