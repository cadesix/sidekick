import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, goals, memories, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  cadencePhrase,
  goalContextSentence,
  identitySentence,
  preferenceSentence,
} from "@sidekick/server";
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

const SPARK = {
  archetype: "The Spark",
  tagline: "Spontaneous, playful, lives in the moment.",
  blurb: "You thrive on fun, people, and the present moment.",
  percents: { O: 60, C: 40, E: 80, A: 70, N: 30 },
};

const baseComplete = (overrides: Record<string, unknown> = {}) => ({
  name: "Maya",
  ageBracket: "25-34",
  gender: "female",
  personality: SPARK,
  sidekickName: "Pip",
  sidekickColor: "yellow",
  timezone: "America/Chicago",
  reminderTime: "09:00",
  goals: [
    { slug: "get-fit", actionSlug: "run", cadence: { type: "weekly" as const, target: 3 } },
    { slug: "sleep-better" },
  ],
  ...overrides,
});

test("seed sentences render the exact onboarding memory strings", () => {
  expect(identitySentence("Maya", "25-34", "female")).toBe("Maya is 25–34, female.");
  expect(identitySentence("Maya", "under-18", "prefer-not")).toBe("Maya is under 18.");
  expect(preferenceSentence("Maya", SPARK)).toBe(
    "Maya's coaching style is The Spark — spontaneous, playful, lives in the moment.",
  );
  expect(cadencePhrase({ type: "weekly", target: 3 })).toBe("3× a week");
  expect(cadencePhrase({ type: "daily" })).toBe("every day");
  expect(cadencePhrase({ type: "daily-criteria", criteria: "asleep-by", value: "23:30" })).toBe(
    "asleep by 23:30",
  );
  expect(
    goalContextSentence("Maya", "Get Fit", "Go for a run", { type: "weekly", target: 3 }),
  ).toBe("Maya chose get fit (go for a run, 3× a week).");
});

test("users.me is server-authoritative for onboarding completion", async () => {
  const userId = await createUser(db);
  const before = await caller(userId).users.me();
  expect(before.onboardingComplete).toBe(false);
  expect(before.sidekickName).toBeNull();

  await caller(userId).onboarding.complete(baseComplete());

  const after = await caller(userId).users.me();
  expect(after.onboardingComplete).toBe(true);
  expect(after.onboardingCompletedAt).not.toBeNull();
  expect(after.name).toBe("Maya");
  expect(after.sidekickName).toBe("Pip");
  expect(after.sidekickColor).toBe("yellow");
  expect(after.timezone).toBe("America/Chicago");
  expect(after.reminderTime).toBe("09:00");
});

test("a chat-set reminder time survives a complete() without one", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ reminderTime: "20:30" }).where(eq(users.id, userId));

  const input = baseComplete();
  await caller(userId).onboarding.complete({ ...input, reminderTime: undefined });

  const me = await caller(userId).users.me();
  expect(me.reminderTime).toBe("20:30");
  expect(me.onboardingComplete).toBe(true);
});

test("complete without any reminder time falls back to the default", async () => {
  const userId = await createUser(db);
  const input = baseComplete();
  await caller(userId).onboarding.complete({ ...input, reminderTime: undefined });
  const me = await caller(userId).users.me();
  expect(me.reminderTime).toBe("09:00");
});

test("updateProfile applies age-gate consequences for under-18", async () => {
  const userId = await createUser(db);
  await caller(userId).users.updateProfile({ name: "Sam", ageBracket: "under-18", gender: "male" });

  const rows = await db
    .select({
      ageGatePassed: users.ageGatePassed,
      consent: users.personalizedAdsConsent,
      bracket: users.ageBracket,
    })
    .from(users)
    .where(eq(users.id, userId));
  expect(rows[0]?.ageGatePassed).toBe(true);
  expect(rows[0]?.consent).toBe(false);
  expect(rows[0]?.bracket).toBe("under-18");

  const me = await caller(userId).users.me();
  expect(me.onboardingComplete).toBe(false);
});

test("updateProfile leaves ads consent undecided for adults", async () => {
  const userId = await createUser(db);
  await caller(userId).users.updateProfile({ ageBracket: "25-34" });
  const rows = await db
    .select({ consent: users.personalizedAdsConsent, gate: users.ageGatePassed })
    .from(users)
    .where(eq(users.id, userId));
  expect(rows[0]?.gate).toBe(true);
  expect(rows[0]?.consent).toBeNull();
});

test("complete seeds profile, goals, and the exact onboarding memories", async () => {
  const userId = await createUser(db);
  const result = await caller(userId).onboarding.complete(baseComplete());
  expect(result).toEqual({ ok: true, alreadyComplete: false });

  const goalRows = await db.select().from(goals).where(eq(goals.userId, userId));
  expect(goalRows.map((g) => g.slug).sort()).toEqual(["get-fit", "sleep-better"]);

  const memoryRows = await db
    .select({ kind: memories.kind, content: memories.content, source: memories.source, confidence: memories.confidence })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")));

  const contents = memoryRows.map((m) => m.content).sort();
  expect(contents).toEqual(
    [
      "Maya is 25–34, female.",
      "Maya's coaching style is The Spark — spontaneous, playful, lives in the moment.",
      "Maya chose get fit (go for a run, 3× a week).",
      "Maya chose sleep better (asleep by a set time, asleep by 23:30).",
    ].sort(),
  );
  for (const row of memoryRows) {
    expect(row.source).toBe("onboarding");
    expect(row.confidence).toBe("stated");
  }
});

test("complete seeds one interest memory from declared interests", async () => {
  const userId = await createUser(db);
  await caller(userId).onboarding.complete(
    baseComplete({ interests: ["music", "gaming", "fitness"] }),
  );
  const interestRows = await db
    .select({ content: memories.content })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.kind, "interest")));
  expect(interestRows).toHaveLength(1);
  expect(interestRows[0]?.content).toBe("Maya is into music, gaming, fitness.");
});

test("complete is idempotent — a re-run seeds nothing new", async () => {
  const userId = await createUser(db);
  await caller(userId).onboarding.complete(baseComplete());
  const again = await caller(userId).onboarding.complete(
    baseComplete({ sidekickName: "Different", reminderTime: "21:00" }),
  );
  expect(again).toEqual({ ok: true, alreadyComplete: true });

  const goalRows = await db.select().from(goals).where(eq(goals.userId, userId));
  expect(goalRows).toHaveLength(2);
  const memoryRows = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(memoryRows).toHaveLength(4);

  const me = await caller(userId).users.me();
  expect(me.sidekickName).toBe("Pip");
  expect(me.reminderTime).toBe("09:00");
});
