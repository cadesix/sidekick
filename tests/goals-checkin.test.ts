import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, progressEvents, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { allTools, dispatchTool, localDate, type ToolContext } from "@sidekick/shared";
import { createConversation, createUser, makeCaller, textModel } from "./helpers";

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

async function today(userId: string): Promise<string> {
  const rows = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  return localDate(rows[0]!.tz, new Date());
}

async function dayOutcome(userId: string, goalId: string, date: string): Promise<string | null> {
  const detail = await caller(userId).goals.detail({ goalId });
  return detail.week.find((d) => d.date === date)?.outcome ?? null;
}

test("manual toggle on then off round-trips through the goals read path", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const { goal, actionItem } = await c.goals.adopt({ slug: "get-fit" });
  const date = await today(userId);

  const on = await c.goals.logCheckIn({ goalId: goal.id, date, result: "hit" });
  expect(on).toEqual({ date, outcome: "hit" });
  expect(await dayOutcome(userId, goal.id, date)).toBe("hit");

  const rows = await db
    .select()
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, actionItem!.id), eq(progressEvents.date, date)));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.source).toBe("manual");

  const off = await c.goals.logCheckIn({ goalId: goal.id, date, result: null });
  expect(off).toEqual({ date, outcome: null });
  expect(await dayOutcome(userId, goal.id, date)).toBeNull();

  const cleared = await db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.actionItemId, actionItem!.id));
  expect(cleared).toHaveLength(0);
});

test("the manual toggle and the chat log_checkin write compatible rows", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const c = caller(userId);
  const { goal, actionItem } = await c.goals.adopt({ slug: "get-fit" });
  const date = await today(userId);

  const logCheckin = allTools.find((t) => t.name === "log_checkin");
  if (!logCheckin) throw new Error("missing log_checkin tool");
  const ctx: ToolContext = { db, userId, conversationId };
  await dispatchTool(logCheckin, { goal_id: goal.id, date, result: "hit", note: "ran 3mi" }, ctx);

  const afterChat = await db
    .select()
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, actionItem!.id), eq(progressEvents.date, date)));
  expect(afterChat).toHaveLength(1);
  expect(afterChat[0]!.source).toBe("inferred");
  expect(afterChat[0]!.outcome).toBe("hit");

  // the manual toggle upserts the SAME (actionItem, date) row — one row, re-tagged
  await c.goals.logCheckIn({ goalId: goal.id, date, result: "partial" });
  const afterManual = await db
    .select()
    .from(progressEvents)
    .where(and(eq(progressEvents.actionItemId, actionItem!.id), eq(progressEvents.date, date)));
  expect(afterManual).toHaveLength(1);
  expect(afterManual[0]!.source).toBe("manual");
  expect(afterManual[0]!.outcome).toBe("partial");
});

test("logCheckIn rejects another user's goal", async () => {
  const owner = await createUser(db);
  const stranger = await createUser(db);
  const { goal } = await caller(owner).goals.adopt({ slug: "get-fit" });
  const date = await today(owner);

  await expect(
    caller(stranger).goals.logCheckIn({ goalId: goal.id, date, result: "hit" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("logCheckIn rejects a future day — no backfilling tomorrow", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const { goal } = await c.goals.adopt({ slug: "get-fit" });
  const rows = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const tomorrow = localDate(rows[0]!.tz, new Date(Date.now() + 24 * 60 * 60 * 1000));

  await expect(
    c.goals.logCheckIn({ goalId: goal.id, date: tomorrow, result: "hit" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
