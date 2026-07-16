import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, healthDays, memories, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  adForwardMessages,
  markMessagesSensitive,
  projectAdProfile,
} from "@sidekick/server";
import { createConversation, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("health_days is never part of the ad projection — table-level exclusion", async () => {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ ageBracket: "25-34", gender: "female", lastRegion: "Illinois", personalizedAdsConsent: true })
    .where(eq(users.id, userId));

  await db.insert(memories).values({
    userId,
    kind: "interest",
    content: "into charli xcx",
    source: "import",
  });
  await db.insert(healthDays).values({
    userId,
    date: "2026-07-05",
    steps: 11204,
    sleepMinutes: 401,
    workouts: [{ type: "running", minutes: 34, startedAt: "2026-07-05T13:00:00.000Z" }],
  });

  const profile = await projectAdProfile(db, userId);
  const serialized = JSON.stringify(profile);

  expect(profile.eligible).toBe(true);
  expect(serialized).toContain("into charli xcx");
  for (const leak of ["11204", "steps", "sleep", "401", "running", "workout", "34-min"]) {
    expect(serialized).not.toContain(leak);
  }
});

test("sensitive (health-derived) messages are stripped from the ad-forward window", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);

  const rows = await db
    .insert(messages)
    .values([
      { conversationId, role: "user", content: "how'd i sleep", tokenEstimate: 4 },
      { conversationId, role: "assistant", content: "you got 6h41m last night", tokenEstimate: 6 },
      { conversationId, role: "assistant", content: "how's your day going?", tokenEstimate: 5 },
    ])
    .returning({ id: messages.id, content: messages.content });
  const healthReply = rows.find((r) => r.content.includes("6h41m"));
  await markMessagesSensitive(db, [healthReply!.id]);

  const window = await adForwardMessages(db, conversationId, 50);
  const contents = window.map((m) => m.content);
  expect(contents).toContain("how'd i sleep");
  expect(contents).toContain("how's your day going?");
  expect(contents).not.toContain("you got 6h41m last night");
});
