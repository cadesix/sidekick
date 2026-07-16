import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, actionItems, progressEvents, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { localDate } from "@sidekick/shared";
import { makeCaller, textModel, createUser } from "./helpers";

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

async function timezone(userId: string): Promise<string> {
  const rows = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  return rows[0]!.tz;
}

test("adopt creates a goal and its default action item", async () => {
  const userId = await createUser(db);
  const { goal, actionItem } = await caller(userId).goals.adopt({ slug: "get-fit" });

  expect(goal.slug).toBe("get-fit");
  expect(goal.label).toBe("Get Fit");
  expect(goal.status).toBe("active");
  expect(actionItem?.slug).toBe("gym");
  expect(actionItem?.cadence).toEqual({ type: "weekly", target: 3 });
});

test("adopt honors a chosen action item and custom cadence", async () => {
  const userId = await createUser(db);
  const { actionItem } = await caller(userId).goals.adopt({
    slug: "get-fit",
    actionSlug: "run",
    cadence: { type: "weekly", target: 4 },
  });
  expect(actionItem?.slug).toBe("run");
  expect(actionItem?.cadence).toEqual({ type: "weekly", target: 4 });
});

test("list returns today's checklist state with streak and weekly tally", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const { actionItem } = await c.goals.adopt({ slug: "get-fit" });
  const today = localDate(await timezone(userId), new Date());
  const yesterday = localDate(await timezone(userId), new Date(Date.now() - 24 * 60 * 60 * 1000));

  await db.insert(progressEvents).values([
    { actionItemId: actionItem!.id, date: today, outcome: "hit", note: "5k", source: "inferred" },
    { actionItemId: actionItem!.id, date: yesterday, outcome: "hit", source: "inferred" },
  ]);

  const list = await c.goals.list();
  expect(list.date).toBe(today);
  expect(list.checkInStatus).toBe("none");
  expect(list.streak).toBe(2);
  expect(list.goals).toHaveLength(1);

  const goal = list.goals[0]!;
  expect(goal.slug).toBe("get-fit");
  expect(goal.tier).toBe(1);
  expect(goal.actionItem?.cadence).toEqual({ type: "weekly", target: 3 });
  expect(goal.today).toEqual({ outcome: "hit", note: "5k" });
  expect(goal.week).toEqual({ completed: 2, target: 3 });
});

test("adjust updates the active action item's cadence", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const { goal, actionItem } = await c.goals.adopt({ slug: "get-fit" });

  const result = await c.goals.adjust({ goalId: goal.id, cadence: { type: "weekly", target: 2 } });
  expect(result.ok).toBe(true);

  const rows = await db.select().from(actionItems).where(eq(actionItems.id, actionItem!.id));
  expect(rows[0]?.cadence).toEqual({ type: "weekly", target: 2 });
});

test("pause and complete change goal status and drop it from the active list", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const paused = await c.goals.adopt({ slug: "get-fit" });
  const done = await c.goals.adopt({ slug: "read-more" });

  await c.goals.pause({ goalId: paused.goal.id });
  await c.goals.complete({ goalId: done.goal.id });

  const list = await c.goals.list();
  expect(list.goals).toHaveLength(0);
});

test("adjust rejects another user's goal", async () => {
  const owner = await createUser(db);
  const stranger = await createUser(db);
  const { goal } = await caller(owner).goals.adopt({ slug: "get-fit" });

  await expect(
    caller(stranger).goals.adjust({ goalId: goal.id, cadence: { type: "daily" } }),
  ).rejects.toThrow();
});
