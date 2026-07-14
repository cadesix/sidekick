import { and, asc, eq, gte } from "drizzle-orm";
import { healthDays } from "@sidekick/db";
import { healthSummaryInputSchema } from "../health/types";
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
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - range_days + 1);
      const startDate = start.toISOString().slice(0, 10);
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

      const days = rows.map((row) => {
        let value: number | null = null;
        if (metric === "steps") {
          value = row.steps;
        } else if (metric === "sleep") {
          value = row.sleepMinutes;
        } else if (metric === "calories") {
          value = row.activeCalories;
        } else if (Array.isArray(row.workouts)) {
          value = row.workouts.length;
        }
        return { date: row.date, value };
      });
      return { metric, days };
    },
  }),
];
