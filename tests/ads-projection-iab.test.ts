import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, goals, memories, purchaseIntents, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  type InterestClassifier,
  modelInterestClassifier,
  projectAdProfile,
} from "@sidekick/server";
import { objectModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function eligibleUser(deviceId: string): Promise<string> {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", gender: "female", personalizedAdsConsent: true })
    .where(eq(users.id, userId));
  return userId;
}

test("deterministic fallback (no classifier): raw interest labels + goal-slug map", async () => {
  const userId = await eligibleUser("iab-fallback");
  await db.insert(memories).values({ userId, kind: "interest", content: "into trail running", source: "extraction" });
  await db.insert(goals).values({ userId, slug: "get-fit", label: "get fit" });

  const profile = await projectAdProfile(db, userId);
  const labels = (profile.interests as { label: string }[]).map((i) => i.label);
  expect(labels).toContain("into trail running");
  expect(labels).toContain("Healthy Living/Fitness");
});

test("model classifier maps interest sentences to IAB codes; goal map still applies", async () => {
  const userId = await eligibleUser("iab-model");
  await db.insert(memories).values({ userId, kind: "interest", content: "obsessed with espresso", source: "extraction" });
  await db.insert(goals).values({ userId, slug: "read-more", label: "read more" });

  const classifier: InterestClassifier = modelInterestClassifier(
    objectModel({ interests: [{ label: "Food & Drink/Coffee", code: "IAB8-5" }] }),
  );
  const profile = await projectAdProfile(db, userId, { classifier });
  const interests = profile.interests as { label: string; code?: string }[];
  const labels = interests.map((i) => i.label);
  expect(labels).toContain("Food & Drink/Coffee");
  expect(labels).toContain("Books & Literature");
  expect(labels).not.toContain("obsessed with espresso");
  expect(interests.find((i) => i.label === "Food & Drink/Coffee")?.code).toBe("IAB8-5");
});

test("non-expired purchase intents project; expired ones are dropped", async () => {
  const userId = await eligibleUser("iab-intents");
  const now = new Date("2026-07-07T00:00:00.000Z");
  await db.insert(purchaseIntents).values([
    { userId, signal: "running shoes", strength: "active", expiresAt: new Date("2026-08-20T00:00:00.000Z") },
    { userId, signal: "old backpack", strength: "passive", expiresAt: new Date("2026-06-01T00:00:00.000Z") },
  ]);

  const profile = await projectAdProfile(db, userId, { now });
  const intents = profile.intents as { signal: string; strength: string }[];
  expect(intents.map((i) => i.signal)).toEqual(["running shoes"]);
  expect(intents[0]?.strength).toBe("active");
});

test("a minor projects nothing — no interests, no intents, ineligible", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ ageBracket: "under-18", personalizedAdsConsent: true }).where(eq(users.id, userId));
  await db.insert(memories).values({ userId, kind: "interest", content: "into skateboarding", source: "extraction" });
  await db.insert(purchaseIntents).values({
    userId,
    signal: "new deck",
    strength: "active",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  });

  const profile = await projectAdProfile(db, userId);
  expect(profile.eligible).toBe(false);
  expect(profile.interests).toEqual([]);
  expect(profile.intents).toEqual([]);
});
