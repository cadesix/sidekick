import { and, desc, eq, lte } from "drizzle-orm";
import { generateText, type LanguageModel } from "ai";
import {
  type Database,
  memories,
  messages,
  notificationPreferences,
  reminders,
  users,
} from "@sidekick/db";
import {
  bumpMemoryVersion,
  computeNextFireAt,
  estimateTokens,
  parseSchedule,
  renderReminderDeliverySystem,
  renderReminderDeliveryUser,
} from "@sidekick/shared";
import { ensureMainConversation } from "../chat/turn";
import { enqueueNotification } from "../notifications/outbox";

type ReminderRow = typeof reminders.$inferSelect;
type UserRow = typeof users.$inferSelect;

/** Everything the reminder cron needs. Env-derived keys are optional so tests inject none. */
export type ReminderDeps = {
  db: Database;
  model: LanguageModel;
};

/** How many due reminders one cron tick will attempt (10: "limit 500"). */
const FIRE_LIMIT = 500;

export type DueReminder = { reminder: ReminderRow; user: UserRow };

/**
 * The only query the cron runs (10 §delivery): active reminders whose precomputed
 * `nextFireAt` has arrived, joined to their user for voice + push. Reminders fire
 * exactly when set, so quiet-hours never apply here.
 */
export async function selectDueReminders(db: Database, now: Date): Promise<DueReminder[]> {
  const rows = await db
    .select({ reminder: reminders, user: users })
    .from(reminders)
    .innerJoin(users, eq(reminders.userId, users.id))
    .innerJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(
      and(
        eq(reminders.status, "active"),
        lte(reminders.nextFireAt, now),
        eq(notificationPreferences.remindersEnabled, true),
      ),
    )
    .orderBy(reminders.nextFireAt)
    .limit(FIRE_LIMIT);
  return rows.map((r) => ({ reminder: r.reminder, user: r.user }));
}

async function memoryHighlights(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ content: memories.content })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")))
    .orderBy(desc(memories.lastReinforcedAt))
    .limit(3);
  return rows.map((r) => r.content);
}

/**
 * Phrase the reminder in the sidekick's voice via one cheap-model call, falling
 * back to a plain `reminder: {text}` on any model failure or empty output — a
 * robotic reminder beats a missed one (10 §delivery step 1).
 */
async function phraseReminder(
  deps: ReminderDeps,
  user: UserRow,
  reminder: ReminderRow,
): Promise<string> {
  const fallback = `reminder: ${reminder.text}`;
  try {
    const highlights = await memoryHighlights(deps.db, user.id);
    const input = {
      sidekickName: user.sidekickName ?? "your sidekick",
      userName: user.name,
      reminderText: reminder.text,
      memoryHighlights: highlights,
    };
    const { text } = await generateText({
      model: deps.model,
      system: renderReminderDeliverySystem(input),
      prompt: renderReminderDeliveryUser(input),
    });
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

export type FireOutcome =
  | { fired: false; reason: "claimed" }
  | { fired: true; messageId: number; text: string };

/**
 * Deliver one due reminder, idempotently (10 §delivery). The row is *claimed*
 * first — its next state (advanced `nextFireAt` for recurring, `done` for once)
 * is written under a `status='active' AND nextFireAt<=now` guard, so a concurrent
 * or repeated tick that loses the race delivers nothing. Only the winner phrases,
 * inserts the assistant message, and pushes.
 */
export async function fireReminder(
  deps: ReminderDeps,
  due: DueReminder,
  now: Date,
): Promise<FireOutcome> {
  const { db } = deps;
  const { reminder, user } = due;
  const schedule = parseSchedule(reminder.schedule);

  const isRecurring = schedule?.type === "recurring";
  const nextFireAt =
    isRecurring && schedule
      ? computeNextFireAt(schedule, reminder.timezone, now, reminder.createdAt)
      : null;
  const nextStatus = isRecurring && nextFireAt ? "active" : "done";

  const claim = await db
    .update(reminders)
    .set({ status: nextStatus, nextFireAt, updatedAt: now })
    .where(
      and(
        eq(reminders.id, reminder.id),
        eq(reminders.status, "active"),
        lte(reminders.nextFireAt, now),
      ),
    )
    .returning({ id: reminders.id });
  if (!claim[0]) {
    return { fired: false, reason: "claimed" };
  }

  const conversation = await ensureMainConversation(db, user.id);
  const text = await phraseReminder(deps, user, reminder);

  const inserted = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      role: "assistant",
      content: text,
      tokenEstimate: estimateTokens(text),
    })
    .returning({ id: messages.id });
  const message = inserted[0];
  if (!message) {
    throw new Error("failed to persist reminder message");
  }

  await bumpMemoryVersion(db, user.id);

  await enqueueNotification(db, {
    userId: user.id,
    messageId: message.id,
    kind: "reminder",
    title: user.sidekickName ?? "Sidekick",
    body: text,
    data: {
      type: "reminder",
      conversationId: conversation.id,
      reminderId: reminder.id,
      messageId: message.id,
    },
    availableAt: now,
  });

  return { fired: true, messageId: message.id, text };
}

/** Fire every due reminder for a tick; returns how many were selected and delivered. */
export async function fireDueReminders(
  deps: ReminderDeps,
  now: Date,
): Promise<{ due: number; fired: number }> {
  const due = await selectDueReminders(deps.db, now);
  const results = await Promise.all(due.map((d) => fireReminder(deps, d, now)));
  return { due: due.length, fired: results.filter((r) => r.fired).length };
}

/**
 * Nightly tz-drift recompute (10 §data model): for every active reminder whose
 * frozen `timezone` no longer matches the user's current timezone, refreeze it
 * and recompute `nextFireAt` so a 7:30am reminder stays 7:30am after the user
 * moves. Idempotent — a reminder already on the current tz is skipped.
 */
export async function recomputeTimezoneDrift(
  db: Database,
  now: Date,
): Promise<{ recomputed: number }> {
  const rows = await db
    .select({ reminder: reminders, timezone: users.timezone })
    .from(reminders)
    .innerJoin(users, eq(reminders.userId, users.id))
    .where(eq(reminders.status, "active"));

  const drifted = rows.filter((r) => r.reminder.timezone !== r.timezone);
  for (const { reminder, timezone } of drifted) {
    const schedule = parseSchedule(reminder.schedule);
    const nextFireAt = schedule
      ? computeNextFireAt(schedule, timezone, now, reminder.createdAt)
      : reminder.nextFireAt;
    await db
      .update(reminders)
      .set({ timezone, nextFireAt, updatedAt: now })
      .where(eq(reminders.id, reminder.id));
  }
  return { recomputed: drifted.length };
}
