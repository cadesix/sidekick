import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  conversations,
  devicePushTokens,
  devices,
  messages,
  notificationOutbox,
  notificationPreferences,
  proactiveTurns,
  users,
  type Database,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  GENERIC_PROACTIVE_BODY,
  checkNotificationReceipts,
  dispatchProactiveTurn,
  insideAwakeWindow,
  nextProactiveTime,
  notificationBody,
  registerDevice,
  registerPushToken,
  scheduleProactiveTurns,
  sendPendingNotifications,
  type PushMessage,
  type PushProvider,
  type PushReceipt,
  type PushTicket,
} from "@sidekick/server";
import { and, eq } from "drizzle-orm";
import { objectModel, createUserSession } from "./helpers";

class TestPushProvider implements PushProvider {
  sent: PushMessage[] = [];
  receipt: PushReceipt = { status: "ok" };

  validToken(token: string): boolean {
    return token.startsWith("ExponentPushToken[");
  }

  async send(messagesToSend: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messagesToSend);
    return messagesToSend.map((_, index) => ({ status: "ok", id: `ticket-${index}` }));
  }

  async receipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, this.receipt]));
  }
}

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  close = testDb.close;
});

afterAll(async () => close());

async function eligibleAccount(label: string, lastUserMessageAt: Date) {
  const installationId = `proactive-${label}`;
  const account = await createUserSession(db);
  const userRows = await db
    .update(users)
    .set({
      name: "Casey",
      sidekickName: "Milo",
      onboardingCompletedAt: new Date("2026-07-01T00:00:00Z"),
      timezone: "America/New_York",
    })
    .where(eq(users.id, account.userId))
    .returning({ id: users.id });
  expect(userRows).toHaveLength(1);
  await registerDevice(db, account.userId, { deviceId: installationId });
  const conversationRows = await db
    .insert(conversations)
    .values({ userId: account.userId, kind: "main", lastUserMessageAt })
    .returning({ id: conversations.id });
  const conversation = conversationRows[0];
  if (!conversation) {
    throw new Error("conversation setup failed");
  }
  await db.insert(messages).values({
    conversationId: conversation.id,
    role: "user",
    content: "how did that thing go?",
    tokenEstimate: 6,
    createdAt: lastUserMessageAt,
  });
  await db
    .insert(notificationPreferences)
    .values({
      userId: account.userId,
      proactiveEnabled: true,
      awakeStart: "09:00",
      awakeEnd: "21:30",
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { proactiveEnabled: true, awakeStart: "09:00", awakeEnd: "21:30" },
    });
  const provider = new TestPushProvider();
  await registerPushToken(
    db,
    provider,
    account.userId,
    installationId,
    {
      expoToken: `ExponentPushToken[${label}]`,
      platform: "ios",
      projectId: "a7d12cd6-d264-465b-9199-fbaacd985bcd",
      permissionStatus: "authorized",
    },
    new Date("2026-07-14T00:00:00Z"),
  );
  return { ...account, installationId, conversationId: conversation.id, provider };
}

describe("proactive timing and privacy", () => {
  test("uses a stable minute inside a normal awake window", () => {
    const result = nextProactiveTime({
      eligibleAt: new Date("2026-07-14T14:00:00Z"),
      timezone: "America/New_York",
      awakeStart: "09:00",
      awakeEnd: "21:30",
      random: () => 0.5,
    });
    expect(result.scheduledFor.toISOString()).toBe("2026-07-14T19:45:00.000Z");
    expect(result.localSlotDate).toBe("2026-07-14");
  });

  test("supports awake windows crossing midnight", () => {
    expect(
      insideAwakeWindow(
        new Date("2026-07-15T05:00:00Z"),
        "America/New_York",
        "16:00",
        "02:00",
      ),
    ).toBe(true);
    expect(
      insideAwakeWindow(
        new Date("2026-07-15T16:00:00Z"),
        "America/New_York",
        "16:00",
        "02:00",
      ),
    ).toBe(false);
  });

  test("hides the first and sensitive later bubbles", () => {
    expect(notificationBody("hey!!", 0)).toBe(GENERIC_PROACTIVE_BODY);
    expect(notificationBody("also i found that song", 1)).toBe("also i found that song");
    expect(notificationBody("how is therapy going?", 1)).toBe(GENERIC_PROACTIVE_BODY);
  });
});

test("schedules once, dispatches multiple durable bubbles, and fans out pushes", async () => {
  const now = new Date("2026-07-14T17:00:00Z");
  const account = await eligibleAccount("delivery", new Date(now.getTime() - 13 * 60 * 60_000));
  const first = await scheduleProactiveTurns(db, now, () => 0);
  const second = await scheduleProactiveTurns(db, now, () => 0);
  expect(first.scheduled).toBe(1);
  expect(second.scheduled).toBe(0);

  const rows = await db
    .select()
    .from(proactiveTurns)
    .where(eq(proactiveTurns.userId, account.userId));
  const turn = rows[0];
  if (!turn) {
    throw new Error("scheduled turn missing");
  }
  const delivery = await dispatchProactiveTurn(
    db,
    objectModel({ bubbles: ["saw something that reminded me of u", "the tiny frog video 😭"] }),
    turn,
    turn.scheduledFor,
  );
  expect(delivery).toEqual({ delivered: true, messages: 2 });

  const persisted = await db
    .select({ content: messages.content, sequence: messages.proactiveSequence })
    .from(messages)
    .where(eq(messages.proactiveTurnId, turn.id));
  expect(persisted).toEqual([
    { content: "saw something that reminded me of u", sequence: 0 },
    { content: "the tiny frog video 😭", sequence: 1 },
  ]);
  const outbox = await db
    .select({ body: notificationOutbox.body })
    .from(notificationOutbox)
    .where(eq(notificationOutbox.userId, account.userId));
  expect(outbox).toEqual([
    { body: GENERIC_PROACTIVE_BODY },
    { body: "the tiny frog video 😭" },
  ]);

  const sent = await sendPendingNotifications(db, account.provider, turn.scheduledFor);
  expect(sent.ticketed).toBe(2);
  expect(account.provider.sent).toHaveLength(2);
  expect(account.provider.sent[0]?.data.notificationId).toEqual(expect.any(String));

  const receiptTime = new Date(turn.scheduledFor.getTime() + 16 * 60_000);
  const receipts = await checkNotificationReceipts(db, account.provider, receiptTime);
  expect(receipts.delivered).toBe(2);
});

test("exactly twelve hours is not eligible", async () => {
  const now = new Date("2026-07-14T17:00:00Z");
  const account = await eligibleAccount("exact-twelve", new Date(now.getTime() - 12 * 60 * 60_000));
  await scheduleProactiveTurns(db, now, () => 0);
  const turns = await db
    .select({ id: proactiveTurns.id })
    .from(proactiveTurns)
    .where(eq(proactiveTurns.userId, account.userId));
  expect(turns).toHaveLength(0);
});

test("token registration replaces the prior token for one installation", async () => {
  const account = await eligibleAccount("rotation", new Date("2026-07-13T00:00:00Z"));
  await registerPushToken(
    db,
    account.provider,
    account.userId,
    account.installationId,
    {
      expoToken: "ExponentPushToken[rotation-new]",
      platform: "ios",
      projectId: "a7d12cd6-d264-465b-9199-fbaacd985bcd",
      permissionStatus: "authorized",
    },
    new Date("2026-07-14T01:00:00Z"),
  );
  const installation = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.deviceId, account.installationId));
  const tokens = await db
    .select({ token: devicePushTokens.expoToken, status: devicePushTokens.status })
    .from(devicePushTokens)
    .where(eq(devicePushTokens.deviceId, installation[0]?.id ?? ""));
  expect(tokens).toEqual([{ token: "ExponentPushToken[rotation-new]", status: "active" }]);
});
