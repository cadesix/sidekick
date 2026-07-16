import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, messages, reminders, users } from "@sidekick/db";
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

async function run(name: string, input: unknown, ctx: ToolContext): Promise<Record<string, unknown>> {
  const dispatched = await dispatchTool(tool(name), input, ctx);
  if (dispatched.status !== "done") {
    throw new Error("tool did not execute server-side");
  }
  return dispatched.result as Record<string, unknown>;
}

async function setup(deviceId: string): Promise<ToolContext> {
  const userId = await createUser(db);
  await db.update(users).set({ timezone: "America/New_York", name: "Maya" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  await db
    .insert(messages)
    .values({ conversationId, role: "user", content: "remind me to call mom friday", tokenEstimate: 8 });
  return { db, userId, conversationId };
}

test("create_reminder saves a once reminder with a computed nextFireAt and source message", async () => {
  const ctx = await setup("rem-tool-1");
  const result = await run(
    "create_reminder",
    { text: "call mom about the flight", schedule: { type: "once", at: "2099-07-10T17:00" } },
    ctx,
  );
  expect(result.ok).toBe(true);

  const rows = await db.select().from(reminders).where(eq(reminders.userId, ctx.userId));
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.status).toBe("active");
  expect(row?.text).toBe("call mom about the flight");
  expect(row?.nextFireAt?.toISOString()).toBe("2099-07-10T21:00:00.000Z");
  expect(row?.timezone).toBe("America/New_York");
  expect(typeof row?.createdFromMessageId).toBe("number");
});

test("create_reminder computes nextFireAt for a recurring schedule", async () => {
  const ctx = await setup("rem-tool-2");
  const result = await run(
    "create_reminder",
    { text: "take creatine", schedule: { type: "recurring", rrule: "FREQ=DAILY", time: "07:30" } },
    ctx,
  );
  expect(result.ok).toBe(true);
  const rows = await db.select().from(reminders).where(eq(reminders.userId, ctx.userId));
  expect(rows[0]?.nextFireAt).toBeInstanceOf(Date);
});

test("create_reminder enforces the 50-active cap", async () => {
  const ctx = await setup("rem-tool-cap");
  const values = Array.from({ length: 50 }, (_, i) => ({
    userId: ctx.userId,
    text: `reminder ${i}`,
    schedule: { type: "once", at: "2099-01-01T09:00" },
    timezone: "America/New_York",
    nextFireAt: new Date("2099-01-01T14:00:00Z"),
    status: "active",
  }));
  await db.insert(reminders).values(values);

  const result = await run(
    "create_reminder",
    { text: "one too many", schedule: { type: "once", at: "2099-02-02T09:00" } },
    ctx,
  );
  expect(result.ok).toBe(false);
  expect(String(result.error)).toContain("50");

  const active = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, ctx.userId), eq(reminders.status, "active")));
  expect(active).toHaveLength(50);
});

test("update_reminder changes status and recomputes on a schedule change", async () => {
  const ctx = await setup("rem-tool-3");
  const created = await run(
    "create_reminder",
    { text: "water plants", schedule: { type: "once", at: "2099-07-10T17:00" } },
    ctx,
  );
  const reminderId = String(created.reminder_id);

  await run("update_reminder", { reminder_id: reminderId, status: "paused" }, ctx);
  let row = (await db.select().from(reminders).where(eq(reminders.id, reminderId)))[0];
  expect(row?.status).toBe("paused");

  await run(
    "update_reminder",
    { reminder_id: reminderId, status: "active", schedule: { type: "once", at: "2099-08-01T09:00" } },
    ctx,
  );
  row = (await db.select().from(reminders).where(eq(reminders.id, reminderId)))[0];
  expect(row?.status).toBe("active");
  expect(row?.nextFireAt?.toISOString()).toBe("2099-08-01T13:00:00.000Z");
});

test("delete_reminder soft-deletes and clears the fire time", async () => {
  const ctx = await setup("rem-tool-4");
  const created = await run(
    "create_reminder",
    { text: "stretch", schedule: { type: "once", at: "2099-07-10T17:00" } },
    ctx,
  );
  const reminderId = String(created.reminder_id);
  await run("delete_reminder", { reminder_id: reminderId }, ctx);
  const row = (await db.select().from(reminders).where(eq(reminders.id, reminderId)))[0];
  expect(row?.status).toBe("deleted");
  expect(row?.nextFireAt).toBeNull();
});

test("list_reminders returns active and paused, hides deleted", async () => {
  const ctx = await setup("rem-tool-5");
  const a = await run(
    "create_reminder",
    { text: "one", schedule: { type: "once", at: "2099-07-10T17:00" } },
    ctx,
  );
  const b = await run(
    "create_reminder",
    { text: "two", schedule: { type: "once", at: "2099-07-11T17:00" } },
    ctx,
  );
  await run("update_reminder", { reminder_id: String(a.reminder_id), status: "paused" }, ctx);
  await run("delete_reminder", { reminder_id: String(b.reminder_id) }, ctx);
  await run(
    "create_reminder",
    { text: "three", schedule: { type: "once", at: "2099-07-12T17:00" } },
    ctx,
  );

  const listed = await run("list_reminders", {}, ctx);
  const items = listed.reminders as Array<{ text: string; status: string }>;
  const texts = items.map((i) => i.text).sort();
  expect(texts).toEqual(["one", "three"]);
});

test("tools reject a reminder id owned by another user", async () => {
  const ctx = await setup("rem-tool-owner-a");
  const other = await setup("rem-tool-owner-b");
  const created = await run(
    "create_reminder",
    { text: "mine", schedule: { type: "once", at: "2099-07-10T17:00" } },
    ctx,
  );
  const result = await run(
    "delete_reminder",
    { reminder_id: String(created.reminder_id) },
    other,
  );
  expect(result.ok).toBe(false);
});
