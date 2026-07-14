import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import {
  type Database,
  actionItems,
  documents,
  goals,
  memories,
  reminders,
  users,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { renderMemoryBlock } from "@sidekick/shared";
import { registerDevice } from "@sidekick/server";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("renderMemoryBlock composes the profile sections from the DB with relative dates", async () => {
  const { userId } = await registerDevice(db, { deviceId: "render-1" });
  await db
    .update(users)
    .set({
      name: "Maya",
      gender: "female",
      ageBracket: "25-34",
      personality: { archetype: "The Spark", tagline: "playful and social" },
      lastCity: "Chicago",
      lastRegion: "Illinois",
      lastCountry: "United States",
    })
    .where(eq(users.id, userId));

  await db.insert(memories).values([
    { userId, kind: "identity", content: "lives in chicago with roommate priya", source: "onboarding" },
    { userId, kind: "relationship", content: "dating alex, ~8 months", source: "extraction" },
    { userId, kind: "interest", content: "into matcha and thrifting", source: "extraction" },
    { userId, kind: "preference", content: "hates being asked did you work out", confidence: "inferred", source: "extraction" },
    { userId, kind: "event", content: "sister's wedding in ohio", eventDate: "2026-07-12", source: "extraction" },
    { userId, kind: "event", content: "hit a 5k PR", eventDate: "2026-07-04", source: "extraction" },
  ]);

  const goal = await db
    .insert(goals)
    .values({ userId, slug: "get-fit", label: "get fit" })
    .returning({ id: goals.id });
  const goalId = goal[0]?.id ?? "";
  await db.insert(actionItems).values({
    goalId,
    slug: "run",
    label: "run",
    cadence: { type: "per_week", target: 3 },
  });

  await db.insert(reminders).values({
    userId,
    text: "call mom",
    schedule: {},
    timezone: "America/New_York",
  });
  await db.insert(documents).values({
    userId,
    title: "Trip plan",
    content: "flights + hotel",
    lastEditedBy: "user",
  });

  const block = await renderMemoryBlock(db, userId, new Date("2026-07-06T16:00:00Z"));

  expect(block).toContain("=== WHAT YOU KNOW ABOUT MAYA ===");
  expect(block).toMatch(/today is \w+day, july 6/);
  expect(block).toContain("lives in chicago with roommate priya");
  expect(block).toContain("personality: The Spark — playful and social");
  expect(block).toContain("CURRENT CONTEXT");
  expect(block).toContain("current location: Chicago, Illinois, United States (city-level, shared from their device)");
  expect(block).toContain("HER PEOPLE");
  expect(block).toContain("dating alex, ~8 months");
  expect(block).toContain("into matcha and thrifting");
  expect(block).toContain("hates being asked did you work out (maybe)");
  expect(block).toContain("in 6 days (jul 12): sister's wedding in ohio");
  expect(block).toContain("2 days ago: hit a 5k PR");
  expect(block).toContain(`- ${goalId} · get fit: run (3x/week)`);
  expect(block).toContain("call mom");
  expect(block).toContain("Trip plan");
  expect(block).toContain("=== END ===");
});

test("renderMemoryBlock renders a minimal profile without optional sections", async () => {
  const { userId } = await registerDevice(db, { deviceId: "render-2" });
  await db.update(users).set({ name: "Sam" }).where(eq(users.id, userId));

  const block = await renderMemoryBlock(db, userId, new Date("2026-07-06T16:00:00Z"));
  expect(block).toContain("=== WHAT YOU KNOW ABOUT SAM ===");
  expect(block).not.toContain("HER PEOPLE");
  expect(block).not.toContain("GOALS");
});
