import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  type Database,
  actionItems,
  checkIns,
  goals,
  progressEvents,
  users,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { allTools, dispatchTool, type SidekickTool, type ToolContext } from "@sidekick/shared";
import { createConversation, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function tool(name: string): SidekickTool {
  const found = allTools.find((t) => t.name === name);
  if (!found) {
    throw new Error(`missing tool ${name}`);
  }
  return found;
}

async function seedGoal(
  userId: string,
  cadence: unknown = { type: "weekly", target: 3 },
): Promise<{ goalId: string; actionItemId: string }> {
  const g = await db
    .insert(goals)
    .values({ userId, slug: "get-fit", label: "Get Fit", status: "active" })
    .returning({ id: goals.id });
  const goalId = g[0]!.id;
  const item = await db
    .insert(actionItems)
    .values({ goalId, slug: "gym", label: "Hit the gym", cadence, status: "active" })
    .returning({ id: actionItems.id });
  return { goalId, actionItemId: item[0]!.id };
}

test("log_checkin upserts a progress event and bumps memory_version", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const { goalId, actionItemId } = await seedGoal(userId);
  const ctx: ToolContext = { db, userId, conversationId };

  const before = await db.select({ v: users.memoryVersion }).from(users).where(eq(users.id, userId));

  const first = await dispatchTool(
    tool("log_checkin"),
    { goal_id: goalId, date: "2026-07-06", result: "hit", note: "ran 3mi, knee sore" },
    ctx,
  );
  expect(first).toEqual({ status: "done", result: { ok: true } });

  let rows = await db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.actionItemId, actionItemId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.outcome).toBe("hit");
  expect(rows[0]?.note).toBe("ran 3mi, knee sore");
  expect(rows[0]?.source).toBe("inferred");

  await dispatchTool(
    tool("log_checkin"),
    { goal_id: goalId, date: "2026-07-06", result: "partial" },
    ctx,
  );
  rows = await db.select().from(progressEvents).where(eq(progressEvents.actionItemId, actionItemId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.outcome).toBe("partial");

  const after = await db.select({ v: users.memoryVersion }).from(users).where(eq(users.id, userId));
  expect(after[0]!.v).toBeGreaterThan(before[0]!.v);
});

test("log_checkin links to today's check-in row when one exists", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const { goalId } = await seedGoal(userId);
  const ci = await db
    .insert(checkIns)
    .values({ userId, date: "2026-07-06", status: "opened" })
    .returning({ id: checkIns.id });

  await dispatchTool(
    tool("log_checkin"),
    { goal_id: goalId, date: "2026-07-06", result: "hit" },
    { db, userId, conversationId },
  );

  const rows = await db.select().from(progressEvents).where(eq(progressEvents.date, "2026-07-06"));
  const linked = rows.find((r) => r.checkInId === ci[0]!.id);
  expect(linked).toBeDefined();
});

test("complete_check_in closes the open check-in", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  await db.insert(checkIns).values({ userId, date: "2026-07-06", status: "opened" });

  const result = await dispatchTool(tool("complete_check_in"), {}, { db, userId, conversationId });
  expect(result.status).toBe("done");

  const rows = await db.select().from(checkIns).where(eq(checkIns.userId, userId));
  expect(rows[0]?.status).toBe("completed");
  expect(rows[0]?.completedAt).not.toBeNull();
});

test("complete_check_in creates today's row when none is open", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);

  await dispatchTool(tool("complete_check_in"), {}, { db, userId, conversationId });

  const rows = await db.select().from(checkIns).where(eq(checkIns.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("completed");
});

test("adjust_action_item renegotiates the cadence", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const { goalId, actionItemId } = await seedGoal(userId, { type: "weekly", target: 3 });
  const ctx: ToolContext = { db, userId, conversationId };

  const read = await dispatchTool(tool("adjust_action_item"), { goalId }, ctx);
  expect(read).toEqual({ status: "done", result: { ok: true, cadence: { type: "weekly", target: 3 } } });

  await dispatchTool(
    tool("adjust_action_item"),
    { goalId, cadence: { type: "weekly", target: 2 } },
    ctx,
  );
  const rows = await db.select().from(actionItems).where(eq(actionItems.id, actionItemId));
  expect(rows[0]?.cadence).toEqual({ type: "weekly", target: 2 });
});

test("tools reject a goal that isn't the caller's", async () => {
  const owner = await createUser(db);
  const stranger = await createUser(db);
  const conversationId = await createConversation(db, stranger);
  const { goalId } = await seedGoal(owner);

  const result = await dispatchTool(
    tool("log_checkin"),
    { goal_id: goalId, date: "2026-07-06", result: "hit" },
    { db, userId: stranger, conversationId },
  );
  expect(result).toEqual({ status: "done", result: { ok: false, error: "no active action item for that goal" } });

  const events = await db
    .select()
    .from(progressEvents)
    .innerJoin(actionItems, eq(progressEvents.actionItemId, actionItems.id))
    .innerJoin(goals, and(eq(actionItems.goalId, goals.id), eq(goals.userId, stranger)));
  expect(events).toHaveLength(0);
});
