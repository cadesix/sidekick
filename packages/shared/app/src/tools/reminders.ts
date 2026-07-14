import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { messages, reminders } from "@sidekick/db";
import type { Database } from "@sidekick/db";
import {
  computeNextFireAt,
  parseSchedule,
  scheduleKindLabel,
  scheduleSchema,
  scheduleTimeLabel,
} from "../reminders/schedule";
import { bumpMemoryVersion, userTimezone } from "../users";
import { defineTool, type SidekickTool } from "./types";

/** Reminders past which `create_reminder` refuses (10: "cap 50 active per user"). */
const ACTIVE_CAP = 50;

/** The id of the user message that prompted this tool call, for `createdFromMessageId`. */
async function latestUserMessageId(db: Database, conversationId: string): Promise<number | null> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")))
    .orderBy(desc(messages.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function countActive(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reminders)
    .where(and(eq(reminders.userId, userId), eq(reminders.status, "active")));
  return rows[0]?.count ?? 0;
}

async function ownedReminder(db: Database, userId: string, reminderId: string) {
  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .limit(1);
  return rows[0];
}

function summarize(row: typeof reminders.$inferSelect): {
  reminder_id: string;
  text: string;
  status: string;
  when: string | null;
  next_fire_at: string | null;
} {
  const schedule = parseSchedule(row.schedule);
  return {
    reminder_id: row.id,
    text: row.text,
    status: row.status,
    when: schedule ? `${scheduleTimeLabel(schedule)} · ${scheduleKindLabel(schedule)}` : null,
    next_fire_at: row.nextFireAt ? row.nextFireAt.toISOString() : null,
  };
}

export const remindersTools: SidekickTool[] = [
  defineTool({
    name: "create_reminder",
    description:
      "Set a reminder when the user asks for one or clearly wants one. Resolve relative times ('friday', 'tonight') against the user's local date in your context. Confirm naturally in your reply ('got it, friday 5pm') — never robotically. If the time is genuinely unclear, ask ONE clarifying question first; never invent a time silently.",
    execution: "server",
    parameters: z.object({
      text: z.string().describe("What to remind, in the user's words, e.g. 'call mom about the flight'"),
      schedule: scheduleSchema.describe(
        "once: {type:'once', at:'YYYY-MM-DDTHH:mm'} local time. recurring: {type:'recurring', rrule:'FREQ=...', time:'HH:mm'}",
      ),
    }),
    execute: async ({ text, schedule }, { db, userId, conversationId }) => {
      const active = await countActive(db, userId);
      if (active >= ACTIVE_CAP) {
        return {
          ok: false,
          error: `you already have ${ACTIVE_CAP} active reminders — clear one before adding another`,
        };
      }
      const timezone = await userTimezone(db, userId);
      const now = new Date();
      const nextFireAt = computeNextFireAt(schedule, timezone, now);
      const createdFromMessageId = await latestUserMessageId(db, conversationId);

      const inserted = await db
        .insert(reminders)
        .values({ userId, text, schedule, timezone, nextFireAt, status: "active", createdFromMessageId })
        .returning();
      const row = inserted[0];
      if (!row) {
        return { ok: false, error: "could not save the reminder" };
      }
      await bumpMemoryVersion(db, userId);
      return { ok: true, ...summarize(row) };
    },
  }),

  defineTool({
    name: "update_reminder",
    description:
      "Change a reminder's text, time, or status (pause/resume/complete) — e.g. 'ugh not yet, ask me in an hour' bumps the time, 'never mind' completes it. Use the reminder_id from the REMINDERS section of your context.",
    execution: "server",
    parameters: z.object({
      reminder_id: z.string().describe("ID from the REMINDERS section of your context"),
      text: z.string().optional(),
      schedule: scheduleSchema.optional(),
      status: z.enum(["active", "paused", "done"]).optional(),
    }),
    execute: async ({ reminder_id, text, schedule, status }, { db, userId }) => {
      const existing = await ownedReminder(db, userId, reminder_id);
      if (!existing) {
        return { ok: false, error: "no reminder with that id" };
      }
      const nextSchedule = schedule ?? parseSchedule(existing.schedule);
      const nextStatus = status ?? existing.status;
      const timezone = existing.timezone;

      const recompute = Boolean(schedule) || (status === "active" && existing.status !== "active");
      const nextFireAt =
        recompute && nextSchedule && nextStatus === "active"
          ? computeNextFireAt(nextSchedule, timezone, new Date(), existing.createdAt)
          : existing.nextFireAt;

      const updated = await db
        .update(reminders)
        .set({
          text: text ?? existing.text,
          schedule: nextSchedule ?? existing.schedule,
          status: nextStatus,
          nextFireAt,
          updatedAt: new Date(),
        })
        .where(eq(reminders.id, reminder_id))
        .returning();
      const row = updated[0];
      if (!row) {
        return { ok: false, error: "could not update the reminder" };
      }
      await bumpMemoryVersion(db, userId);
      return { ok: true, ...summarize(row) };
    },
  }),

  defineTool({
    name: "delete_reminder",
    description:
      "Delete a reminder for good when the user no longer wants it. Use the reminder_id from the REMINDERS section of your context.",
    execution: "server",
    parameters: z.object({
      reminder_id: z.string().describe("ID from the REMINDERS section of your context"),
    }),
    execute: async ({ reminder_id }, { db, userId }) => {
      const existing = await ownedReminder(db, userId, reminder_id);
      if (!existing) {
        return { ok: false, error: "no reminder with that id" };
      }
      await db
        .update(reminders)
        .set({ status: "deleted", nextFireAt: null, updatedAt: new Date() })
        .where(eq(reminders.id, reminder_id));
      await bumpMemoryVersion(db, userId);
      return { ok: true, reminder_id };
    },
  }),

  defineTool({
    name: "list_reminders",
    description:
      "List the user's reminders (active, paused, and recently completed) — for 'what do you have for me this week?'. The active set is already in your context; use this when they ask to review everything.",
    execution: "server",
    parameters: z.object({}),
    execute: async (_input, { db, userId }) => {
      const rows = await db
        .select()
        .from(reminders)
        .where(and(eq(reminders.userId, userId), inArray(reminders.status, ["active", "paused", "done"])))
        .orderBy(desc(reminders.nextFireAt), desc(reminders.updatedAt))
        .limit(60);
      return { ok: true, reminders: rows.map(summarize) };
    },
  }),
];
