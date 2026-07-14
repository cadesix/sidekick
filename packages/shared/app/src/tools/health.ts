import { and, asc, eq, gte } from "drizzle-orm";
import { healthDays } from "@sidekick/db";
import { addDays, localDate } from "../goals/dates";
import { HEALTH_METRIC_VALUE, healthSummaryInputSchema } from "../health/types";
import { userTimezone } from "../users";
import { defineTool, type SidekickTool } from "./types";

/**
 * Health is summarized only from the consented, minimized 30-day server window.
 */
export const healthTools: SidekickTool[] = [
  defineTool({
    name: "health_summary",
    description:
      "Summarize the user's explicitly shared Apple Health daily aggregates over the last N days (max 30) for steps, sleep, workouts, or active calories. Use for reflective questions, avoid diagnosis, and describe missing days as unavailable data.",
    execution: "server",
    parameters: healthSummaryInputSchema,
    execute: async ({ range_days, metric }, { db, userId }) => {
      const timezone = await userTimezone(db, userId);
      const today = localDate(timezone, new Date());
      const startDate = addDays(today, -(range_days - 1));
      const rows = await db
        .select({
          date: healthDays.date,
          steps: healthDays.steps,
          sleepMinutes: healthDays.sleepMinutes,
          activeCalories: healthDays.activeCalories,
          workouts: healthDays.workouts,
        })
        .from(healthDays)
        .where(and(eq(healthDays.userId, userId), gte(healthDays.date, startDate)))
        .orderBy(asc(healthDays.date));

      const readMetric = HEALTH_METRIC_VALUE[metric];
      const days = rows.map((row) => ({ date: row.date, value: readMetric(row) }));
      const availableDays = days.filter((day) => day.value !== null).length;
      return {
        metric,
        rangeDays: range_days,
        availableDays,
        missingDays: range_days - availableDays,
        days,
      };
    },
  }),
];

export const HEALTH_CHAT_GUIDANCE = `Apple Health summaries:
- Health context is user-authorized but sensitive. Use it only when it genuinely helps the current conversation; never recite a dashboard unprompted.
- Treat the data as incomplete. Name the covered dates or number of available days when that affects the answer, and never call missing data a zero.
- Be supportive and observational, not diagnostic. Do not infer illness, injury, readiness, or sleep quality from these summaries.
- Prefer one useful connection in natural language (for example, noticing a completed workout toward a goal) over listing every metric.
- If the user asks for a trend beyond today or yesterday, use health_summary and state gaps plainly.`;
