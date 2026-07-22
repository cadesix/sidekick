import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { actionItems, checkIns } from "@sidekick/db";
import { cadenceSchema } from "../goals/catalog";
import { activeActionItem, logGoalProgress } from "../goals/checkin";
import { localDate } from "../goals/dates";
import { bumpMemoryVersion, userTimezone } from "../users";
import { defineTool, type SidekickTool } from "./types";

/** Statuses of a check-in that is still open for today. */
const OPEN_CHECKIN_STATUSES = ["pending", "opened"] as const;

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
      // Clamp a future date to the user's local today. In the evening in the
      // Americas the model sometimes resolves "today" to the UTC date (a day
      // ahead), which would file the outcome on a day the Goals UI — keyed to
      // local "today" — never shows. Never file ahead of the user's today.
      const today = localDate(await userTimezone(db, userId), new Date());
      const day = date > today ? today : date;
      const logged = await logGoalProgress(db, userId, {
        goalId: goal_id,
        date: day,
        outcome: result,
        note,
        source: "inferred",
      });
      if (!logged.ok) {
        return { ok: false, error: logged.error };
      }
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
