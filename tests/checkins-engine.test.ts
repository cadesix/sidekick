import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type LanguageModel } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { type Database, checkIns, conversations, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { registerDevice } from "@sidekick/server";
import {
  type CheckinDeps,
  closeStaleCheckins,
  followUpCheckin,
  openCheckin,
  selectDueUsers,
} from "../packages/server/src/checkins/engine";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

/** A model whose `generateText` returns a fixed opener (doGenerate path). */
function openerModel(text: string): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      warnings: [],
    }),
  });
}

async function makeUser(
  deviceId: string,
  attrs: { timezone: string; reminderTime?: string; name?: string; sidekickName?: string },
): Promise<typeof users.$inferSelect> {
  const { userId } = await registerDevice(db, { deviceId });
  const updated = await db
    .update(users)
    .set({
      timezone: attrs.timezone,
      reminderTime: attrs.reminderTime ?? "09:00",
      name: attrs.name ?? "Maya",
      sidekickName: attrs.sidekickName ?? "Kick",
    })
    .where(eq(users.id, userId))
    .returning();
  return updated[0]!;
}

function deps(model: LanguageModel): CheckinDeps {
  return { db, model };
}

async function assistantMessages(userId: string): Promise<(typeof messages.$inferSelect)[]> {
  const rows = await db
    .select({ message: messages })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(messages.role, "assistant")));
  return rows.map((r) => r.message);
}

test("selectDueUsers shards by local reminder hour", async () => {
  const ny = await makeUser("engine-ny", { timezone: "America/New_York", reminderTime: "09:00" });
  const la = await makeUser("engine-la", { timezone: "America/Los_Angeles", reminderTime: "09:00" });

  const at9NY = new Date("2026-07-06T13:00:00Z"); // 09:00 EDT, 06:00 PDT
  const dueA = await selectDueUsers(db, at9NY);
  expect(dueA.map((u) => u.id)).toContain(ny.id);
  expect(dueA.map((u) => u.id)).not.toContain(la.id);

  const at9LA = new Date("2026-07-06T16:00:00Z"); // 12:00 EDT, 09:00 PDT
  const dueB = await selectDueUsers(db, at9LA);
  expect(dueB.map((u) => u.id)).toContain(la.id);
  expect(dueB.map((u) => u.id)).not.toContain(ny.id);
});

test("openCheckin inserts one opener + check-in row and is idempotent on re-run", async () => {
  const user = await makeUser("engine-open", { timezone: "UTC" });
  const now = new Date("2026-07-06T09:00:00Z");
  const model = openerModel("morning sunshine ☀️ ready for today?");

  const first = await openCheckin(deps(model), user, now);
  expect(first.created).toBe(true);

  const again = await openCheckin(deps(model), user, now);
  expect(again).toEqual({ created: false, reason: "already-open" });

  const checkInRows = await db.select().from(checkIns).where(eq(checkIns.userId, user.id));
  expect(checkInRows).toHaveLength(1);
  expect(checkInRows[0]?.date).toBe("2026-07-06");
  expect(checkInRows[0]?.status).toBe("opened");
  expect(checkInRows[0]?.openerMessageId).not.toBeNull();

  const msgs = await assistantMessages(user.id);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]?.content).toBe("morning sunshine ☀️ ready for today?");
  expect(checkInRows[0]?.openerMessageId).toBe(msgs[0]?.id);
});

test("followUpCheckin sends one soft nudge, then stays quiet", async () => {
  const user = await makeUser("engine-followup", { timezone: "UTC" });
  const model = openerModel("hey! how's your day starting?");

  await openCheckin(deps(model), user, new Date("2026-07-06T08:00:00Z"));

  const tooEarly = await followUpCheckin(deps(model), user, new Date("2026-07-06T15:00:00Z"));
  expect(tooEarly).toEqual({ sent: false, reason: "too-early" });

  const evening = new Date("2026-07-06T20:00:00Z");
  const nudge = await followUpCheckin(deps(model), user, evening);
  expect(nudge.sent).toBe(true);

  const second = await followUpCheckin(deps(model), user, evening);
  expect(second).toEqual({ sent: false, reason: "already-nudged" });

  const msgs = await assistantMessages(user.id);
  expect(msgs).toHaveLength(2); // opener + one follow-up
});

test("followUpCheckin stays quiet once the user has engaged", async () => {
  const user = await makeUser("engine-engaged", { timezone: "UTC" });
  const model = openerModel("morning!");
  const opened = await openCheckin(deps(model), user, new Date("2026-07-06T08:00:00Z"));
  if (!opened.created) {
    throw new Error("expected opener");
  }
  const conversation = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .limit(1);
  await db.insert(messages).values({
    conversationId: conversation[0]!.id,
    role: "user",
    content: "hey! good actually",
    tokenEstimate: 5,
  });

  const result = await followUpCheckin(deps(model), user, new Date("2026-07-06T20:00:00Z"));
  expect(result).toEqual({ sent: false, reason: "engaged" });
});

test("closeStaleCheckins skips only check-ins whose local day has passed", async () => {
  const user = await makeUser("engine-close", { timezone: "UTC" });
  await db.insert(checkIns).values({ userId: user.id, date: "2026-07-05", status: "opened" });
  await db.insert(checkIns).values({ userId: user.id, date: "2026-07-06", status: "opened" });

  const now = new Date("2026-07-06T12:00:00Z");
  const { closed } = await closeStaleCheckins(db, now);
  expect(closed).toBe(1);

  const rows = await db.select().from(checkIns).where(eq(checkIns.userId, user.id));
  const yesterday = rows.find((r) => r.date === "2026-07-05");
  const today = rows.find((r) => r.date === "2026-07-06");
  expect(yesterday?.status).toBe("skipped");
  expect(today?.status).toBe("opened");
});
