import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, progressEvents, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { addDays, localDate } from "@sidekick/shared";
import { registerDevice } from "@sidekick/server";
import { makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function caller(userId: string) {
  return makeCaller(db, textModel("ok"), userId);
}

test("detail returns cadence options, per-goal streak, the week strip, and history", async () => {
  const { userId } = await registerDevice(db, { deviceId: "goal-detail-1" });
  const c = caller(userId);
  const { goal, actionItem } = await c.goals.adopt({ slug: "get-fit" });

  const tz = (await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)))[0]!.tz;
  const today = localDate(tz, new Date());
  await db.insert(progressEvents).values([
    { actionItemId: actionItem!.id, date: today, outcome: "hit", note: "5k in the rain", source: "inferred" },
    { actionItemId: actionItem!.id, date: addDays(today, -1), outcome: "hit", source: "inferred" },
    { actionItemId: actionItem!.id, date: addDays(today, -2), outcome: "missed", source: "user_stated" },
  ]);

  const detail = await c.goals.detail({ goalId: goal.id });
  expect(detail.goal.label).toBe("Get Fit");
  expect(detail.goal.tier).toBe(1);
  expect(detail.actionItem?.slug).toBe("gym");
  expect(detail.cadenceOptions.length).toBeGreaterThan(0);
  expect(detail.streak).toBe(2);
  expect(detail.week).toHaveLength(7);
  expect(detail.week.filter((d) => d.isToday)).toHaveLength(1);
  expect(detail.history[0]).toMatchObject({ outcome: "hit", note: "5k in the rain" });
  expect(detail.history).toHaveLength(3);
});

test("detail rejects another user's goal", async () => {
  const { userId: owner } = await registerDevice(db, { deviceId: "goal-detail-owner" });
  const { userId: stranger } = await registerDevice(db, { deviceId: "goal-detail-stranger" });
  const { goal } = await caller(owner).goals.adopt({ slug: "read-more" });
  await expect(caller(stranger).goals.detail({ goalId: goal.id })).rejects.toThrow();
});
