import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import {
  type Database,
  devicePushTokens,
  notificationOutbox,
} from "@sidekick/db";
import type { PushMessage, PushProvider } from "./provider";

const SEND_LIMIT = 500;
const MAX_ATTEMPTS = 5;

export type NotificationIntent = {
  userId: string;
  messageId: number;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  availableAt: Date;
  expiresAt?: Date;
};

export async function enqueueNotification(
  db: Database,
  intent: NotificationIntent,
): Promise<number> {
  const tokens = await db
    .select({ id: devicePushTokens.id })
    .from(devicePushTokens)
    .where(and(eq(devicePushTokens.userId, intent.userId), eq(devicePushTokens.status, "active")));
  if (tokens.length === 0) {
    return 0;
  }
  const rows = tokens.map((token) => ({
    userId: intent.userId,
    devicePushTokenId: token.id,
    messageId: intent.messageId,
    kind: intent.kind,
    title: intent.title,
    body: intent.body,
    data: intent.data,
    availableAt: intent.availableAt,
    expiresAt: intent.expiresAt,
  }));
  const inserted = await db
    .insert(notificationOutbox)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notificationOutbox.id });
  return inserted.length;
}

type ClaimedRow = {
  id: string;
  tokenId: string;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  expiresAt: Date | null;
  attempts: number;
};

async function claimDue(db: Database, now: Date): Promise<ClaimedRow[]> {
  const due = await db
    .select({
      id: notificationOutbox.id,
      tokenId: devicePushTokens.id,
      token: devicePushTokens.expoToken,
      title: notificationOutbox.title,
      body: notificationOutbox.body,
      data: notificationOutbox.data,
      expiresAt: notificationOutbox.expiresAt,
      attempts: notificationOutbox.attempts,
    })
    .from(notificationOutbox)
    .innerJoin(devicePushTokens, eq(notificationOutbox.devicePushTokenId, devicePushTokens.id))
    .where(
      and(
        eq(notificationOutbox.status, "pending"),
        lte(notificationOutbox.availableAt, now),
        eq(devicePushTokens.status, "active"),
      ),
    )
    .limit(SEND_LIMIT);
  if (due.length === 0) {
    return [];
  }
  const ids = due.map((row) => row.id);
  const claimed = await db
    .update(notificationOutbox)
    .set({ status: "sending", updatedAt: now })
    .where(and(inArray(notificationOutbox.id, ids), eq(notificationOutbox.status, "pending")))
    .returning({ id: notificationOutbox.id });
  const claimedIds = new Set(claimed.map((row) => row.id));
  return due.filter((row) => claimedIds.has(row.id));
}

function toPushMessage(row: ClaimedRow, now: Date): PushMessage {
  let expiresInSeconds: number | undefined;
  if (row.expiresAt) {
    expiresInSeconds = Math.max(0, Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000));
  }
  return {
    token: row.token,
    title: row.title,
    body: row.body,
    data: { ...row.data, notificationId: row.id },
    expiresInSeconds,
    mutableContent: true,
  };
}

function retryAt(now: Date, attempts: number): Date {
  const minutes = Math.min(60, 2 ** attempts);
  return new Date(now.getTime() + minutes * 60_000);
}

export async function sendPendingNotifications(
  db: Database,
  provider: PushProvider,
  now: Date = new Date(),
): Promise<{ selected: number; ticketed: number; failed: number; expired: number }> {
  const claimed = await claimDue(db, now);
  let ticketed = 0;
  let failed = 0;
  let expired = 0;
  const deliverable: ClaimedRow[] = [];
  for (const row of claimed) {
    if (row.expiresAt && row.expiresAt <= now) {
      await db
        .update(notificationOutbox)
        .set({ status: "expired", updatedAt: now })
        .where(eq(notificationOutbox.id, row.id));
      expired += 1;
    } else {
      deliverable.push(row);
    }
  }
  if (deliverable.length === 0) {
    return { selected: claimed.length, ticketed, failed, expired };
  }

  try {
    const tickets = await provider.send(deliverable.map((row) => toPushMessage(row, now)));
    for (let index = 0; index < deliverable.length; index += 1) {
      const row = deliverable[index];
      const ticket = tickets[index];
      if (!row || !ticket) {
        continue;
      }
      const attempts = row.attempts + 1;
      if (ticket.status === "ok") {
        await db
          .update(notificationOutbox)
          .set({
            status: "ticketed",
            attempts,
            expoTicketId: ticket.id,
            sentAt: now,
            updatedAt: now,
          })
          .where(eq(notificationOutbox.id, row.id));
        ticketed += 1;
        continue;
      }
      const permanent = ticket.code === "DeviceNotRegistered" || attempts >= MAX_ATTEMPTS;
      await db
        .update(notificationOutbox)
        .set({
          status: permanent ? "failed" : "pending",
          attempts,
          availableAt: retryAt(now, attempts),
          lastError: ticket.message,
          updatedAt: now,
        })
        .where(eq(notificationOutbox.id, row.id));
      if (ticket.code === "DeviceNotRegistered") {
        await db
          .update(devicePushTokens)
          .set({ status: "invalid", invalidatedAt: now, lastError: ticket.message, updatedAt: now })
          .where(eq(devicePushTokens.id, row.tokenId));
      }
      failed += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "push provider unavailable";
    for (const row of deliverable) {
      const attempts = row.attempts + 1;
      await db
        .update(notificationOutbox)
        .set({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          availableAt: retryAt(now, attempts),
          lastError: message,
          updatedAt: now,
        })
        .where(eq(notificationOutbox.id, row.id));
      failed += 1;
    }
  }
  return { selected: claimed.length, ticketed, failed, expired };
}

export async function checkNotificationReceipts(
  db: Database,
  provider: PushProvider,
  now: Date = new Date(),
): Promise<{ checked: number; delivered: number; failed: number }> {
  const rows = await db
    .select({
      id: notificationOutbox.id,
      ticketId: notificationOutbox.expoTicketId,
      tokenId: notificationOutbox.devicePushTokenId,
    })
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.status, "ticketed"),
        isNotNull(notificationOutbox.expoTicketId),
        lte(notificationOutbox.sentAt, new Date(now.getTime() - 15 * 60_000)),
      ),
    )
    .limit(1000);
  const ticketIds = rows.map((row) => row.ticketId).filter((id): id is string => id !== null);
  if (ticketIds.length === 0) {
    return { checked: 0, delivered: 0, failed: 0 };
  }
  const receipts = await provider.receipts(ticketIds);
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.ticketId) {
      continue;
    }
    const receipt = receipts[row.ticketId];
    if (!receipt) {
      continue;
    }
    if (receipt.status === "ok") {
      await db
        .update(notificationOutbox)
        .set({ status: "delivered", updatedAt: now })
        .where(eq(notificationOutbox.id, row.id));
      delivered += 1;
      continue;
    }
    await db
      .update(notificationOutbox)
      .set({
        status: "failed",
        lastError: receipt.message,
        updatedAt: now,
      })
      .where(eq(notificationOutbox.id, row.id));
    if (receipt.code === "DeviceNotRegistered") {
      await db
        .update(devicePushTokens)
        .set({ status: "invalid", invalidatedAt: now, lastError: receipt.message, updatedAt: now })
        .where(eq(devicePushTokens.id, row.tokenId));
    }
    failed += 1;
  }
  return { checked: rows.length, delivered, failed };
}
