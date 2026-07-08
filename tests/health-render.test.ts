import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, healthDays, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { renderHealthLines } from "@sidekick/shared";
import { registerDevice, syncHealthDays } from "@sidekick/server";
import { makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("renders yesterday's health into a friend-shaped RECENT line", async () => {
  const { userId } = await registerDevice(db, { deviceId: "render-1" });
  await db.update(users).set({ timezone: "America/New_York" }).where(eq(users.id, userId));

  await db.insert(healthDays).values({
    userId,
    date: "2026-07-05",
    steps: 11204,
    sleepMinutes: 401,
    sleepStart: new Date("2026-07-05T04:48:00.000Z"),
    sleepEnd: new Date("2026-07-05T11:29:00.000Z"),
    workouts: [{ type: "run", minutes: 34, startedAt: "2026-07-05T13:00:00.000Z" }],
  });

  const lines = await renderHealthLines(db, userId, new Date("2026-07-06T18:00:00.000Z"));
  expect(lines).toHaveLength(1);
  const line = lines[0]!;
  expect(line.startsWith("- yesterday:")).toBe(true);
  expect(line).toContain("11,204 steps");
  expect(line).toContain("6h41m sleep");
  expect(line).toContain("34-min run");
});

test("no synced days renders nothing (empty section)", async () => {
  const { userId } = await registerDevice(db, { deviceId: "render-2" });
  const lines = await renderHealthLines(db, userId, new Date("2026-07-06T18:00:00.000Z"));
  expect(lines).toEqual([]);
});

test("health.disconnect deletes every synced day", async () => {
  const { userId } = await registerDevice(db, { deviceId: "render-3" });
  await syncHealthDays(db, userId, [
    { date: "2026-07-05", steps: 5000, workouts: [] },
    { date: "2026-07-06", steps: 6000, workouts: [] },
  ]);

  const caller = makeCaller(db, textModel("ok"), userId);
  const status = await caller.health.status();
  expect(status.connected).toBe(true);

  const result = await caller.health.disconnect();
  expect(result.deleted).toBe(2);

  const rows = await db.select().from(healthDays).where(eq(healthDays.userId, userId));
  expect(rows).toHaveLength(0);
  const after = await caller.health.status();
  expect(after.connected).toBe(false);
});
