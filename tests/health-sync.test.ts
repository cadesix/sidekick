import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  type Database,
  actionItems,
  goals,
  healthDays,
  progressEvents,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { registerDevice, syncHealthDays } from "@sidekick/server";
import { allTools, dispatchTool } from "@sidekick/shared";
import { createConversation } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function fitnessUser(deviceId: string, actionSlug: string) {
  const { userId } = await registerDevice(db, { deviceId });
  const goal = await db
    .insert(goals)
    .values({ userId, slug: "get-fit", label: "Get Fit", status: "active" })
    .returning({ id: goals.id });
  const goalId = goal[0]!.id;
  const item = await db
    .insert(actionItems)
    .values({
      goalId,
      slug: actionSlug,
      label: actionSlug,
      cadence: { type: "weekly", target: 3 },
      status: "active",
    })
    .returning({ id: actionItems.id });
  return { userId, actionItemId: item[0]!.id };
}

test("sync upserts a day and re-sync updates in place (merge, no dup)", async () => {
  const { userId } = await registerDevice(db, { deviceId: "health-1" });

  await syncHealthDays(db, userId, [
    { date: "2026-07-05", steps: 4000, workouts: [] },
  ]);
  await syncHealthDays(db, userId, [
    {
      date: "2026-07-05",
      steps: 11204,
      sleepMinutes: 401,
      sleepStart: "2026-07-05T04:48:00.000Z",
      sleepEnd: "2026-07-05T11:29:00.000Z",
      workouts: [{ type: "running", minutes: 34, calories: 310, startedAt: "2026-07-05T13:00:00.000Z" }],
    },
  ]);

  const rows = await db.select().from(healthDays).where(eq(healthDays.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.steps).toBe(11204);
  expect(rows[0]?.sleepMinutes).toBe(401);
  expect(Array.isArray(rows[0]?.workouts)).toBe(true);
});

test("sync retains only the newest 30 local calendar days", async () => {
  const { userId } = await registerDevice(db, { deviceId: "health-retention" });
  const days = Array.from({ length: 31 }, (_, offset) => {
    const date = new Date(Date.UTC(2026, 6, 31 - offset));
    return { date: date.toISOString().slice(0, 10), steps: 5000 + offset, workouts: [] };
  });
  await syncHealthDays(db, userId, days);

  const rows = await db.select().from(healthDays).where(eq(healthDays.userId, userId));
  expect(rows).toHaveLength(30);
  expect(rows.some((row) => row.date === "2026-07-01")).toBe(false);
});

test("health_summary reads only the consented server aggregate window", async () => {
  const { userId } = await registerDevice(db, { deviceId: "health-summary" });
  await syncHealthDays(db, userId, [
    { date: new Date().toISOString().slice(0, 10), steps: 8200, workouts: [] },
  ]);
  const tool = allTools.find((candidate) => candidate.name === "health_summary");
  expect(tool).toBeDefined();
  if (!tool) {
    return;
  }
  const conversationId = await createConversation(db, userId);
  const result = await dispatchTool(
    tool,
    { metric: "steps", range_days: 7 },
    { db, userId, conversationId },
  );
  expect(result).toEqual({
    status: "done",
    result: {
      metric: "steps",
      days: [{ date: new Date().toISOString().slice(0, 10), value: 8200 }],
    },
  });
});

test("a matching workout auto-logs a device-verified hit", async () => {
  const { userId, actionItemId } = await fitnessUser("health-run", "run");
  await syncHealthDays(db, userId, [
    {
      date: "2026-07-06",
      steps: 9000,
      workouts: [{ type: "running", minutes: 30, startedAt: "2026-07-06T13:00:00.000Z" }],
    },
  ]);

  const events = await db
    .select()
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, actionItemId), eq(progressEvents.date, "2026-07-06")));
  expect(events).toHaveLength(1);
  expect(events[0]?.outcome).toBe("hit");
  expect(events[0]?.source).toBe("device");
});

test("a walk logs a walk item but not a run item; an unrecognized workout falls back to gym", async () => {
  const run = await fitnessUser("health-walk-run", "run");
  const walk = await fitnessUser("health-walk-walk", "walk");
  const gym = await fitnessUser("health-walk-gym", "gym");

  const walkDay = {
    date: "2026-07-06",
    workouts: [{ type: "walking", minutes: 40, startedAt: "2026-07-06T13:00:00.000Z" }],
  };
  await syncHealthDays(db, run.userId, [walkDay]);
  await syncHealthDays(db, walk.userId, [walkDay]);
  await syncHealthDays(db, gym.userId, [
    { date: "2026-07-06", workouts: [{ type: "kickboxing", minutes: 30, startedAt: "2026-07-06T13:00:00.000Z" }] },
  ]);

  const runEvents = await db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.actionItemId, run.actionItemId));
  const walkEvents = await db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.actionItemId, walk.actionItemId));
  const gymEvents = await db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.actionItemId, gym.actionItemId));
  expect(runEvents).toHaveLength(0);
  expect(walkEvents).toHaveLength(1);
  expect(gymEvents).toHaveLength(1);
});

test("user_stated outranks device: a device sync never overwrites a user event", async () => {
  const { userId, actionItemId } = await fitnessUser("health-precedence", "run");

  await db.insert(progressEvents).values({
    actionItemId,
    date: "2026-07-06",
    outcome: "missed",
    note: "the watch missed my class",
    source: "user_stated",
  });

  await syncHealthDays(db, userId, [
    {
      date: "2026-07-06",
      workouts: [{ type: "running", minutes: 30, startedAt: "2026-07-06T13:00:00.000Z" }],
    },
  ]);

  const events = await db
    .select()
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, actionItemId), eq(progressEvents.date, "2026-07-06")));
  expect(events).toHaveLength(1);
  expect(events[0]?.outcome).toBe("missed");
  expect(events[0]?.source).toBe("user_stated");
});

test("sleepStart before the target logs the sleep goal a hit; after logs missed", async () => {
  const { userId } = await registerDevice(db, { deviceId: "health-sleep" });
  const goal = await db
    .insert(goals)
    .values({ userId, slug: "sleep-better", label: "Sleep Better", status: "active" })
    .returning({ id: goals.id });
  const item = await db
    .insert(actionItems)
    .values({
      goalId: goal[0]!.id,
      slug: "sleep-by",
      label: "Asleep by a set time",
      cadence: { type: "daily-criteria", criteria: "asleep-by", value: "23:30" },
      status: "active",
    })
    .returning({ id: actionItems.id });
  const itemId = item[0]!.id;

  await syncHealthDays(db, userId, [
    { date: "2026-07-06", sleepStart: "2026-07-07T03:05:00.000Z", workouts: [] },
  ]);
  const early = await db
    .select()
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, itemId), eq(progressEvents.date, "2026-07-06")));
  expect(early[0]?.outcome).toBe("hit");
  expect(early[0]?.source).toBe("device");

  await syncHealthDays(db, userId, [
    { date: "2026-07-08", sleepStart: "2026-07-09T05:10:00.000Z", workouts: [] },
  ]);
  const late = await db
    .select()
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, itemId), eq(progressEvents.date, "2026-07-08")));
  expect(late[0]?.outcome).toBe("missed");
});
