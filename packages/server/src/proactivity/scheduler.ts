import { and, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import {
  type Database,
  conversations,
  devicePushTokens,
  notificationPreferences,
  notificationOutbox,
  proactiveTurns,
  users,
} from "@sidekick/db";
import { nextProactiveTime, insideAwakeWindow } from "./timing";

const ELIGIBILITY_MS = 12 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

async function backoffUntil(db: Database, userId: string, now: Date): Promise<Date | null> {
  const turns = await db
    .select({ scheduledFor: proactiveTurns.scheduledFor, repliedAt: proactiveTurns.repliedAt })
    .from(proactiveTurns)
    .where(and(eq(proactiveTurns.userId, userId), eq(proactiveTurns.status, "delivered")))
    .orderBy(desc(proactiveTurns.scheduledFor))
    .limit(3);
  let ignored = 0;
  for (const turn of turns) {
    if (turn.repliedAt || now.getTime() - turn.scheduledFor.getTime() < DAY_MS) {
      break;
    }
    ignored += 1;
  }
  const latest = turns[0];
  if (!latest || ignored === 0) {
    return null;
  }
  let delay = 36 * 60 * 60_000;
  if (ignored === 2) {
    delay = 72 * 60 * 60_000;
  }
  if (ignored >= 3) {
    delay = 7 * DAY_MS;
  }
  return new Date(latest.scheduledFor.getTime() + delay);
}

export async function scheduleProactiveTurns(
  db: Database,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<{ candidates: number; scheduled: number }> {
  const cutoff = new Date(now.getTime() - ELIGIBILITY_MS);
  const candidates = await db
    .select({
      userId: users.id,
      timezone: users.timezone,
      conversationId: conversations.id,
      lastUserMessageAt: conversations.lastUserMessageAt,
      awakeStart: notificationPreferences.awakeStart,
      awakeEnd: notificationPreferences.awakeEnd,
    })
    .from(notificationPreferences)
    .innerJoin(users, eq(notificationPreferences.userId, users.id))
    .innerJoin(
      conversations,
      and(eq(conversations.userId, users.id), eq(conversations.kind, "main")),
    )
    .where(
      and(
        eq(notificationPreferences.proactiveEnabled, true),
        lt(conversations.lastUserMessageAt, cutoff),
        sql`${users.onboardingCompletedAt} is not null`,
      ),
    );
  let scheduled = 0;
  for (const candidate of candidates) {
    if (!candidate.lastUserMessageAt) {
      continue;
    }
    const pausedUntil = await backoffUntil(db, candidate.userId, now);
    if (pausedUntil && pausedUntil > now) {
      continue;
    }
    const activeToken = await db
      .select({ id: devicePushTokens.id })
      .from(devicePushTokens)
      .where(
        and(
          eq(devicePushTokens.userId, candidate.userId),
          eq(devicePushTokens.status, "active"),
        ),
      )
      .limit(1);
    if (!activeToken[0]) {
      continue;
    }
    let eligibleAt = new Date(candidate.lastUserMessageAt.getTime() + ELIGIBILITY_MS + 1);
    if (eligibleAt < now) {
      eligibleAt = now;
    }
    const timing = nextProactiveTime({
      eligibleAt,
      timezone: candidate.timezone,
      awakeStart: candidate.awakeStart,
      awakeEnd: candidate.awakeEnd,
      random,
    });
    const inserted = await db
      .insert(proactiveTurns)
      .values({
        userId: candidate.userId,
        conversationId: candidate.conversationId,
        localSlotDate: timing.localSlotDate,
        scheduledFor: timing.scheduledFor,
        eligibilityUserMessageAt: candidate.lastUserMessageAt,
      })
      .onConflictDoNothing()
      .returning({ id: proactiveTurns.id });
    scheduled += inserted.length;
  }
  return { candidates: candidates.length, scheduled };
}

type DueTurn = typeof proactiveTurns.$inferSelect;

export async function proactiveCancellationReason(
  db: Database,
  turn: DueTurn,
  now: Date,
): Promise<string | null> {
  const rows = await db
    .select({
      timezone: users.timezone,
      onboardingCompletedAt: users.onboardingCompletedAt,
      proactiveEnabled: notificationPreferences.proactiveEnabled,
      awakeStart: notificationPreferences.awakeStart,
      awakeEnd: notificationPreferences.awakeEnd,
      lastUserMessageAt: conversations.lastUserMessageAt,
    })
    .from(users)
    .innerJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .innerJoin(conversations, eq(conversations.id, turn.conversationId))
    .where(eq(users.id, turn.userId))
    .limit(1);
  const state = rows[0];
  if (!state?.onboardingCompletedAt || !state.proactiveEnabled) {
    return "disabled";
  }
  if (!state.lastUserMessageAt || state.lastUserMessageAt.getTime() !== turn.eligibilityUserMessageAt.getTime()) {
    return "user-returned";
  }
  if (now.getTime() - state.lastUserMessageAt.getTime() <= ELIGIBILITY_MS) {
    return "too-recent";
  }
  const pausedUntil = await backoffUntil(db, turn.userId, now);
  if (pausedUntil && pausedUntil > now) {
    return "backoff";
  }
  if (!insideAwakeWindow(now, state.timezone, state.awakeStart, state.awakeEnd)) {
    return "quiet-hours";
  }
  const collisions = await db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.userId, turn.userId),
        inArray(notificationOutbox.status, ["ticketed", "delivered"]),
        gt(notificationOutbox.sentAt, new Date(now.getTime() - 2 * 60 * 60_000)),
        sql`${notificationOutbox.kind} <> 'reminder'`,
      ),
    )
    .limit(1);
  if (collisions[0]) {
    return "notification-collision";
  }
  const recent = await db
    .select({ scheduledFor: proactiveTurns.scheduledFor })
    .from(proactiveTurns)
    .where(
      and(
        eq(proactiveTurns.userId, turn.userId),
        eq(proactiveTurns.status, "delivered"),
        gt(proactiveTurns.scheduledFor, new Date(now.getTime() - 7 * DAY_MS)),
      ),
    )
    .orderBy(desc(proactiveTurns.scheduledFor));
  if (recent.some((row) => row.scheduledFor > new Date(now.getTime() - DAY_MS))) {
    return "daily-budget";
  }
  if (recent.length >= 3) {
    return "weekly-budget";
  }
  return null;
}

export async function dueProactiveTurns(db: Database, now: Date): Promise<DueTurn[]> {
  return db
    .select()
    .from(proactiveTurns)
    .where(and(eq(proactiveTurns.status, "scheduled"), lte(proactiveTurns.scheduledFor, now)))
    .limit(100);
}
