import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type LanguageModel } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { type Database, conversations, messages, reminders, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  type ReminderDeps,
  fireDueReminders,
  fireReminder,
  recomputeTimezoneDrift,
  selectDueReminders,
} from "../packages/server/src/reminders/engine";
import { generateModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

// The cron scans every user's reminders, so isolate each test's due-set.
afterEach(async () => {
  await db.delete(reminders);
});

/** A model whose generateText throws — exercises the delivery fallback path. */
function throwingModel(): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: async () => {
      throw new Error("model down");
    },
  });
}

async function makeUser(deviceId: string): Promise<string> {
  const userId = await createUser(db);
  await db
    .update(users)
    .set({ timezone: "America/New_York", name: "Maya", sidekickName: "Kick" })
    .where(eq(users.id, userId));
  return userId;
}

async function addReminder(
  userId: string,
  schedule: Record<string, unknown>,
  nextFireAt: Date,
): Promise<string> {
  const inserted = await db
    .insert(reminders)
    .values({
      userId,
      text: "call mom about the flight",
      schedule,
      timezone: "America/New_York",
      nextFireAt,
      status: "active",
    })
    .returning({ id: reminders.id });
  return inserted[0]!.id;
}

async function assistantMessages(userId: string): Promise<(typeof messages.$inferSelect)[]> {
  const rows = await db
    .select({ message: messages })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(messages.role, "assistant")));
  return rows.map((r) => r.message);
}

function deps(model: LanguageModel): ReminderDeps {
  return { db, model };
}

test("selectDueReminders returns only active reminders whose fire time has arrived", async () => {
  const userId = await makeUser("rem-eng-select");
  const now = new Date("2099-07-01T12:00:00Z");
  await addReminder(userId, { type: "once", at: "2099-07-01T08:00" }, new Date("2099-07-01T12:00:00Z"));
  await addReminder(userId, { type: "once", at: "2099-07-05T08:00" }, new Date("2099-07-05T12:00:00Z"));

  const due = await selectDueReminders(db, now);
  const forUser = due.filter((d) => d.reminder.userId === userId);
  expect(forUser).toHaveLength(1);
});

test("a once reminder fires in-voice, inserts one assistant message, then completes", async () => {
  const userId = await makeUser("rem-eng-once");
  const now = new Date("2099-07-01T12:05:00Z");
  const id = await addReminder(userId, { type: "once", at: "2099-07-01T08:00" }, new Date("2099-07-01T12:00:00Z"));

  const first = await fireDueReminders(deps(generateModel("hey! you wanted me to bug you about calling your mom 📞")), now);
  expect(first).toEqual({ due: 1, fired: 1 });

  const messagesAfter = await assistantMessages(userId);
  expect(messagesAfter).toHaveLength(1);
  expect(messagesAfter[0]?.content).toContain("calling your mom");

  const row = (await db.select().from(reminders).where(eq(reminders.id, id)))[0];
  expect(row?.status).toBe("done");

  // Idempotent: a re-run finds nothing due and posts no second message.
  const second = await fireDueReminders(deps(generateModel("should not fire")), now);
  expect(second.fired).toBe(0);
  expect(await assistantMessages(userId)).toHaveLength(1);
});

test("a recurring reminder advances its nextFireAt and stays active", async () => {
  const userId = await makeUser("rem-eng-recurring");
  const now = new Date("2099-07-01T12:05:00Z");
  const id = await addReminder(
    userId,
    { type: "recurring", rrule: "FREQ=DAILY", time: "08:00" },
    new Date("2099-07-01T12:00:00Z"),
  );

  await fireReminder(deps(generateModel("morning nudge")), { reminder: (await db.select().from(reminders).where(eq(reminders.id, id)))[0]!, user: (await db.select().from(users).where(eq(users.id, userId)))[0]! }, now);

  const row = (await db.select().from(reminders).where(eq(reminders.id, id)))[0];
  expect(row?.status).toBe("active");
  expect(row?.nextFireAt?.getTime()).toBeGreaterThan(now.getTime());
  expect(await assistantMessages(userId)).toHaveLength(1);
});

test("delivery falls back to a plain template when the model fails", async () => {
  const userId = await makeUser("rem-eng-fallback");
  const now = new Date("2099-07-01T12:05:00Z");
  await addReminder(userId, { type: "once", at: "2099-07-01T08:00" }, new Date("2099-07-01T12:00:00Z"));

  await fireDueReminders(deps(throwingModel()), now);
  const messagesAfter = await assistantMessages(userId);
  expect(messagesAfter).toHaveLength(1);
  expect(messagesAfter[0]?.content).toBe("reminder: call mom about the flight");
});

test("concurrent fires of the same reminder deliver exactly once", async () => {
  const userId = await makeUser("rem-eng-concurrent");
  const now = new Date("2099-07-01T12:05:00Z");
  const id = await addReminder(userId, { type: "once", at: "2099-07-01T08:00" }, new Date("2099-07-01T12:00:00Z"));
  const reminder = (await db.select().from(reminders).where(eq(reminders.id, id)))[0]!;
  const user = (await db.select().from(users).where(eq(users.id, userId)))[0]!;

  const results = await Promise.all([
    fireReminder(deps(generateModel("one")), { reminder, user }, now),
    fireReminder(deps(generateModel("two")), { reminder, user }, now),
  ]);
  expect(results.filter((r) => r.fired)).toHaveLength(1);
  expect(await assistantMessages(userId)).toHaveLength(1);
});

test("recomputeTimezoneDrift refreezes reminders whose user moved timezones", async () => {
  const userId = await makeUser("rem-eng-tz");
  const id = await addReminder(
    userId,
    { type: "recurring", rrule: "FREQ=DAILY", time: "07:30" },
    new Date("2099-07-01T11:30:00Z"),
  );
  await db.update(users).set({ timezone: "America/Los_Angeles" }).where(eq(users.id, userId));

  const result = await recomputeTimezoneDrift(db, new Date("2099-07-01T20:00:00Z"));
  expect(result.recomputed).toBeGreaterThanOrEqual(1);

  const row = (await db.select().from(reminders).where(eq(reminders.id, id)))[0];
  expect(row?.timezone).toBe("America/Los_Angeles");
  // 07:30 PDT (UTC-7) → 14:30Z.
  expect(row?.nextFireAt?.getUTCHours()).toBe(14);
  expect(row?.nextFireAt?.getUTCMinutes()).toBe(30);
});
