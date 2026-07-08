import { z } from "zod";

/**
 * On-device HealthKit shapes (12-life-integrations.md). Reads only: steps, sleep,
 * workouts, heart rate, active energy. The client aggregates a day locally (merging
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
  restingHr: nullableInt,
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

/** `read_health` device-tool metrics (12 §read_health). */
export const readHealthMetricSchema = z.enum([
  "steps",
  "sleep",
  "workouts",
  "heart_rate",
  "calories",
]);
export type ReadHealthMetric = z.infer<typeof readHealthMetricSchema>;

export const readHealthInputSchema = z.object({
  range_days: z.number().int().min(1).max(30),
  metric: readHealthMetricSchema,
});
export type ReadHealthInput = z.infer<typeof readHealthInputSchema>;
