import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { actionItems, checkIns, goals, progressEvents, users } from "@sidekick/db";
import type { Database } from "@sidekick/db";
import { cadenceSchema } from "../goals/catalog";
import { localDate } from "../goals/dates";
import { defineTool, type SidekickTool } from "./types";

/** Statuses of a check-in that is still open for today. */
const OPEN_CHECKIN_STATUSES = ["pending", "opened"] as const;

async function userTimezone(db: Database, userId: string): Promise<string> {
  const rows = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.timezone ?? "America/New_York";
}

async function activeActionItem(db: Database, userId: string, goalId: string) {
  const rows = await db
    .select({
      id: actionItems.id,
      cadence: actionItems.cadence,
      label: actionItems.label,
    })
    .from(actionItems)
    .innerJoin(goals, eq(actionItems.goalId, goals.id))
    .where(
      and(
        eq(actionItems.goalId, goalId),
        eq(goals.userId, userId),
        eq(actionItems.status, "active"),
      ),
    )
    .orderBy(desc(actionItems.createdAt))
    .limit(1);
  return rows[0];
}

/** Bump the sync/prompt-cache version on any goal/check-in write (user-memory.md §4). */
async function bumpMemoryVersion(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ memoryVersion: sql`${users.memoryVersion} + 1` })
    .where(eq(users.id, userId));
}

export const checkinsTools: SidekickTool[] = [
  defineTool({
    name: "log_checkin",
    description:
      "Record the outcome of one of the user's goals for a specific day, once the conversation makes the outcome clear. Call at most once per goal per day. Never ask the user to confirm 'should I log that' — just log it, and never announce that you logged it.",
    execution: "server",
    parameters: z.object({
      goal_id: z.string().describe("ID from the GOALS section of your context"),
      date: z
        .string()
        .describe("User-local date the outcome applies to (YYYY-MM-DD), usually today or yesterday"),
      result: z.enum(["hit", "missed", "partial", "skipped"]),
      note: z.string().optional().describe("One short phrase of color, e.g. 'ran 3mi, knee sore'"),
    }),
    execute: async ({ goal_id, date, result, note }, { db, userId }) => {
      const item = await activeActionItem(db, userId, goal_id);
      if (!item) {
        return { ok: false, error: "no active action item for that goal" };
      }

      const checkInRows = await db
        .select({ id: checkIns.id })
        .from(checkIns)
        .where(and(eq(checkIns.userId, userId), eq(checkIns.date, date)))
        .limit(1);
      const checkInId = checkInRows[0]?.id ?? null;

      const existing = await db
        .select({ id: progressEvents.id })
        .from(progressEvents)
        .where(and(eq(progressEvents.actionItemId, item.id), eq(progressEvents.date, date)))
        .limit(1);

      if (existing[0]) {
        await db
          .update(progressEvents)
          .set({ outcome: result, note: note ?? null, checkInId, source: "inferred" })
          .where(eq(progressEvents.id, existing[0].id));
      } else {
        await db.insert(progressEvents).values({
          actionItemId: item.id,
          checkInId,
          date,
          outcome: result,
          note: note ?? null,
          source: "inferred",
        });
      }

      await bumpMemoryVersion(db, userId);
      return { ok: true };
    },
  }),

  defineTool({
    name: "complete_check_in",
    description:
      "Mark today's check-in as done, once the user's goals are covered or they clearly want to move on. Silent — don't announce it.",
    execution: "server",
    parameters: z.object({}),
    execute: async (_input, { db, userId }) => {
      const now = new Date();
      const open = await db
        .select({ id: checkIns.id })
        .from(checkIns)
        .where(
          and(eq(checkIns.userId, userId), inArray(checkIns.status, [...OPEN_CHECKIN_STATUSES])),
        )
        .orderBy(desc(checkIns.date))
        .limit(1);

      if (open[0]) {
        await db
          .update(checkIns)
          .set({ status: "completed", completedAt: now })
          .where(eq(checkIns.id, open[0].id));
        await bumpMemoryVersion(db, userId);
        return { ok: true, checkInId: open[0].id };
      }

      const date = localDate(await userTimezone(db, userId), now);
      const inserted = await db
        .insert(checkIns)
        .values({ userId, date, status: "completed", completedAt: now })
        .onConflictDoUpdate({
          target: [checkIns.userId, checkIns.date],
          set: { status: "completed", completedAt: now },
        })
        .returning({ id: checkIns.id });
      await bumpMemoryVersion(db, userId);
      return { ok: true, checkInId: inserted[0]?.id };
    },
  }),

  defineTool({
    name: "adjust_action_item",
    description:
      "Renegotiate a goal's commitment when the user says the cadence is too much or too little — e.g. '3x a week is a lot, can we do 2'. This is a retention save, not a failure.",
    execution: "server",
    parameters: z.object({
      goalId: z.string().describe("ID from the GOALS section of your context"),
      cadence: cadenceSchema.optional().describe("The new cadence; omit to just read the current one"),
    }),
    execute: async ({ goalId, cadence }, { db, userId }) => {
      const item = await activeActionItem(db, userId, goalId);
      if (!item) {
        return { ok: false, error: "no active action item for that goal" };
      }
      if (!cadence) {
        return { ok: true, cadence: item.cadence };
      }
      await db.update(actionItems).set({ cadence }).where(eq(actionItems.id, item.id));
      await bumpMemoryVersion(db, userId);
      return { ok: true, cadence };
    },
  }),
];
