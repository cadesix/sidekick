import { z } from "zod";

/**
 * On-device HealthKit shapes (12-life-integrations.md). Reads only: steps, sleep,
 * workouts and active energy. The client aggregates a day locally (merging
 * sources, Watch preferred) and posts these; the server stores them verbatim into
 * `health_days`. `date` is the user-local calendar day ("YYYY-MM-DD"); timestamps
 * are ISO strings so they cross tRPC unchanged.
 */
export const healthWorkoutSchema = z.object({
  type: z.string(),
  minutes: z.number().nonnegative(),
  calories: z.number().nonnegative().optional(),
  startedAt: z.string(),
});
export type HealthWorkout = z.infer<typeof healthWorkoutSchema>;

const nullableInt = z.number().int().nullable().optional();

export const healthDayInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: nullableInt,
  activeCalories: nullableInt,
  sleepMinutes: nullableInt,
  sleepStart: z.string().nullable().optional(),
  sleepEnd: z.string().nullable().optional(),
  workouts: z.array(healthWorkoutSchema).default([]),
});
export type HealthDayInput = z.infer<typeof healthDayInputSchema>;

/** `health.sync` payload: the trailing week of local days (12 §sync). */
export const healthSyncInputSchema = z.object({
  days: z.array(healthDayInputSchema).max(31),
});
export type HealthSyncInput = z.infer<typeof healthSyncInputSchema>;

/** Metrics available to the server-side summary tool. */
export const healthSummaryMetricSchema = z.enum([
  "steps",
  "sleep",
  "workouts",
  "calories",
]);
export type HealthSummaryMetric = z.infer<typeof healthSummaryMetricSchema>;

export const healthSummaryInputSchema = z.object({
  range_days: z.number().int().min(1).max(30),
  metric: healthSummaryMetricSchema,
});
export type HealthSummaryInput = z.infer<typeof healthSummaryInputSchema>;
