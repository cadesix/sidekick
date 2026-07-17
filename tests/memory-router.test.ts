import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, goals, memories, memorySuppressions, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { projectAdProfile } from "@sidekick/server";
import { createConversation, makeCaller, textModel, createUser, createUserSession } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("memory.list, forget and edit drive the transparency surface", async () => {
  const userId = await createUser(db);
  const seeded = await db
    .insert(memories)
    .values([
      { userId, kind: "interest", content: "into matcha", source: "extraction" },
      { userId, kind: "work_school", content: "works at acme", source: "extraction" },
    ])
    .returning({ id: memories.id, content: memories.content });
  const caller = makeCaller(db, textModel("x"), userId);

  const listed = await caller.memory.list();
  expect(listed).toHaveLength(2);

  const matcha = seeded.find((m) => m.content === "into matcha");
  await caller.memory.forget({ memoryId: matcha?.id ?? "" });
  const afterForget = await caller.memory.list();
  expect(afterForget.map((m) => m.content)).not.toContain("into matcha");
  const suppressions = await db
    .select()
    .from(memorySuppressions)
    .where(eq(memorySuppressions.userId, userId));
  expect(suppressions.map((s) => s.content)).toContain("into matcha");

  const acme = seeded.find((m) => m.content === "works at acme");
  await caller.memory.edit({ memoryId: acme?.id ?? "", content: "works at globex" });
  const afterEdit = await caller.memory.list();
  expect(afterEdit.map((m) => m.content)).toContain("works at globex");
  const old = await db.select().from(memories).where(eq(memories.id, acme?.id ?? ""));
  expect(old[0]?.status).toBe("superseded");
});

test("ad projection allowlists only interests + goals and excludes sensitive kinds", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", gender: "female", personalizedAdsConsent: true, lastRegion: "IL" })
    .where(eq(users.id, userId));
  await db.insert(memories).values([
    { userId, kind: "interest", content: "into live music", source: "extraction" },
    { userId, kind: "emotional", content: "stress spikes before deadlines", source: "extraction" },
    { userId, kind: "relationship", content: "dating alex", source: "extraction" },
  ]);
  await db.insert(goals).values({ userId, slug: "get-fit", label: "get fit" });

  const profile = await projectAdProfile(db, userId);
  expect(profile.eligible).toBe(true);
  const labels = (profile.interests as { label: string }[]).map((i) => i.label);
  expect(labels).toContain("into live music");
  expect(labels).toContain("Healthy Living/Fitness");
  expect(labels).not.toContain("stress spikes before deadlines");
  expect(labels).not.toContain("dating alex");
  expect(profile.region).toBe("IL");
});

test("ad projection marks minors and non-consenting users ineligible with no interests", async () => {
  const minor = await createUserSession(db);
  await db
    .update(users)
    .set({ ageBracket: "under-18", personalizedAdsConsent: true })
    .where(eq(users.id, minor.userId));
  await db.insert(memories).values({ userId: minor.userId, kind: "interest", content: "gaming", source: "extraction" });
  const minorProfile = await projectAdProfile(db, minor.userId);
  expect(minorProfile.eligible).toBe(false);
  expect(minorProfile.interests).toEqual([]);

  const noConsent = await createUserSession(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", personalizedAdsConsent: false })
    .where(eq(users.id, noConsent.userId));
  const noConsentProfile = await projectAdProfile(db, noConsent.userId);
  expect(noConsentProfile.eligible).toBe(false);
});

test("the post-turn safety valve flags a marathon tail and schedules background work", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  for (let i = 0; i < 20; i++) {
    await db
      .insert(messages)
      .values({ conversationId, role: "user", content: `x${i}`, tokenEstimate: 1500 });
  }

  const scheduled: Array<() => Promise<unknown>> = [];
  const caller = makeCaller(db, textModel("ok"), userId, (task) => {
    scheduled.push(task);
  });

  const outcome = await caller.chat.send({ conversationId, text: "still here" });
  expect(outcome.needsCompaction).toBe(true);
  expect(scheduled).toHaveLength(1);
});
