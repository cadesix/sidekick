import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, goals, memories, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { cadencePhrase, goalContextSentence } from "@sidekick/server";
import { createUser, makeCaller, textModel } from "./helpers";

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

const baseCommit = (overrides: Record<string, unknown> = {}) => ({
  reason: "both" as const,
  profile: {
    name: "Maya",
    gender: "woman",
    birthday: "1996-05-01",
    sidekickName: "Pip",
    sidekickColor: "#f5c542",
  },
  habit: {
    slug: "exercise-more",
    label: "exercise more",
    actionLabel: "a 10-min walk",
    cadence: { type: "daily" as const },
  },
  ...overrides,
});

test("seed builders render the exact onboarding memory strings", () => {
  expect(cadencePhrase({ type: "daily" })).toBe("every day");
  expect(cadencePhrase({ type: "weekly", target: 3 })).toBe("3× a week");
  expect(goalContextSentence("Maya", "Exercise More", "a 10-min walk", { type: "daily" })).toBe(
    "Maya chose exercise more (a 10-min walk, every day).",
  );
});

test("commitResult completes onboarding: profile, completion flag, habit goal, memories", async () => {
  const userId = await createUser(db);
  const before = await caller(userId).users.me();
  expect(before.onboardingComplete).toBe(false);

  const res = await caller(userId).onboarding.commitResult(baseCommit());
  expect(res.alreadyComplete).toBe(false);

  const me = await caller(userId).users.me();
  expect(me.onboardingComplete).toBe(true);
  expect(me.onboardingCompletedAt).not.toBeNull();
  expect(me.name).toBe("Maya");
  expect(me.sidekickName).toBe("Pip");
  expect(me.reminderTime).toBe("19:00"); // default when none collected

  const goalRows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, "active")));
  expect(goalRows.map((g) => g.slug)).toContain("exercise-more");

  const mem = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(mem.find((m) => m.kind === "identity")?.content).toBe("Maya is 25–34, woman.");
  expect(mem.some((m) => m.kind === "goal_context")).toBe(true);
});

test("commitResult is idempotent — a re-commit never double-seeds", async () => {
  const userId = await createUser(db);
  await caller(userId).onboarding.commitResult(baseCommit());
  const second = await caller(userId).onboarding.commitResult(baseCommit());
  expect(second.alreadyComplete).toBe(true);

  const goalRows = await db.select().from(goals).where(eq(goals.userId, userId));
  expect(goalRows.filter((g) => g.slug === "exercise-more").length).toBe(1);
  const mem = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(mem.filter((m) => m.kind === "identity").length).toBe(1);
});

test("a pre-set reminder time survives commitResult without one", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ reminderTime: "20:30" }).where(eq(users.id, userId));

  await caller(userId).onboarding.commitResult(baseCommit());

  const me = await caller(userId).users.me();
  expect(me.reminderTime).toBe("20:30");
  expect(me.onboardingComplete).toBe(true);
});
