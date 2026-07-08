import {
  WorkoutActivityType,
  isHealthDataAvailable,
  queryCategorySamples,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";
import type { HealthDayInput, HealthWorkout, ReadHealthInput } from "@sidekick/shared";

/**
 * The single seam onto Apple HealthKit (12-life-integrations.md). Every native
 * call lives here, behind `guard()` — Apple never reveals read-permission status
 * and denied reads return empty, so we (a) check `isHealthDataAvailable()` before
 * ever querying and (b) never query a type we didn't request (querying an
 * un-requested type crashes). Reads only; this module never writes to Health.
 */

const READ_TYPES = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRate",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKWorkoutTypeIdentifier",
] as const;

export function healthAvailable(): boolean {
  return isHealthDataAvailable();
}

/** Contextual permission request (12 §permission UX). Returns whether it resolved. */
export async function requestHealthAuthorization(): Promise<boolean> {
  if (!isHealthDataAvailable()) {
    return false;
  }
  return requestAuthorization({ toRead: [...READ_TYPES] });
}

type DayRange = { date: string; startDate: Date; endDate: Date };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The local calendar day `offset` days before today, as an absolute [start,end). */
function dayRange(now: Date, offset: number): DayRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return { date, startDate: start, endDate: end };
}

async function sumFor(
  identifier: "HKQuantityTypeIdentifierStepCount" | "HKQuantityTypeIdentifierActiveEnergyBurned",
  range: DayRange,
): Promise<number | null> {
  const stats = await queryStatisticsForQuantity(identifier, ["cumulativeSum"], {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
  });
  const value = stats.sumQuantity?.quantity;
  return value === undefined ? null : Math.round(value);
}

async function restingHeartRate(range: DayRange): Promise<number | null> {
  const stats = await queryStatisticsForQuantity(
    "HKQuantityTypeIdentifierRestingHeartRate",
    ["discreteAverage"],
    { filter: { date: { startDate: range.startDate, endDate: range.endDate } } },
  );
  const value = stats.averageQuantity?.quantity;
  return value === undefined ? null : Math.round(value);
}

type SleepAggregate = { minutes: number; start: Date; end: Date } | null;

/**
 * Merge sleep across sources (12 §sync): a phone and a Watch both log sleep, so
 * we take the source that reported the most asleep samples (in practice the
 * Watch), summing its asleep intervals and bounding start/end. Awake and in-bed
 * segments are excluded from the total.
 */
async function sleepFor(range: DayRange): Promise<SleepAggregate> {
  const samples = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    limit: 0,
    ascending: true,
  });

  const asleep = samples.filter((s) => isAsleep(s.value));
  if (asleep.length === 0) {
    return null;
  }

  const bySource = new Map<string, typeof asleep>();
  for (const sample of asleep) {
    const key = sample.sourceRevision?.source.bundleIdentifier ?? "unknown";
    const list = bySource.get(key) ?? [];
    list.push(sample);
    bySource.set(key, list);
  }
  let chosen = asleep;
  for (const list of bySource.values()) {
    if (list.length > chosen.length) {
      chosen = list;
    }
  }

  let minutes = 0;
  let start = chosen[0]!.startDate;
  let end = chosen[0]!.endDate;
  for (const sample of chosen) {
    minutes += (sample.endDate.getTime() - sample.startDate.getTime()) / 60000;
    if (sample.startDate < start) {
      start = sample.startDate;
    }
    if (sample.endDate > end) {
      end = sample.endDate;
    }
  }
  return { minutes: Math.round(minutes), start, end };
}

/**
 * Sleep-analysis values are a numeric enum: 0 in-bed, 2 awake, and 1/3/4/5 the
 * asleep stages. We count anything that isn't in-bed or awake as asleep.
 */
function isAsleep(value: number): boolean {
  return value !== 0 && value !== 2;
}

async function workoutsFor(range: DayRange): Promise<HealthWorkout[]> {
  const samples = await queryWorkoutSamples({
    filter: { date: { startDate: range.startDate, endDate: range.endDate } },
    limit: 0,
    ascending: true,
  });
  return samples.map((sample) => ({
    type: WorkoutActivityType[sample.workoutActivityType] ?? "workout",
    minutes: Math.round(sample.duration.quantity / 60),
    calories: sample.totalEnergyBurned ? Math.round(sample.totalEnergyBurned.quantity) : undefined,
    startedAt: sample.startDate.toISOString(),
  }));
}

/**
 * Read the trailing `days` of daily aggregates for `health.sync` (12 §sync).
 * Returns `[]` when Health is unavailable so the caller simply skips syncing.
 */
export async function readHealthDays(days: number): Promise<HealthDayInput[]> {
  if (!isHealthDataAvailable()) {
    return [];
  }
  const now = new Date();
  const result: HealthDayInput[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const range = dayRange(now, offset);
    const [steps, activeCalories, restingHr, sleep, workouts] = await Promise.all([
      sumFor("HKQuantityTypeIdentifierStepCount", range),
      sumFor("HKQuantityTypeIdentifierActiveEnergyBurned", range),
      restingHeartRate(range),
      sleepFor(range),
      workoutsFor(range),
    ]);
    result.push({
      date: range.date,
      steps,
      activeCalories,
      restingHr,
      sleepMinutes: sleep?.minutes ?? null,
      sleepStart: sleep ? sleep.start.toISOString() : null,
      sleepEnd: sleep ? sleep.end.toISOString() : null,
      workouts,
    });
  }
  return result;
}

export type ReadHealthResult =
  | { error: "device_unavailable" }
  | { metric: string; days: { date: string; value: number | null }[] };

/**
 * Fulfil the `read_health` device tool (12 §read_health): one metric over a
 * range. Denied/unavailable → `{ error: 'device_unavailable' }`, which the model
 * acknowledges in-voice.
 */
export async function readHealthMetric(input: ReadHealthInput): Promise<ReadHealthResult> {
  if (!isHealthDataAvailable()) {
    return { error: "device_unavailable" };
  }
  const now = new Date();
  const days: { date: string; value: number | null }[] = [];
  for (let offset = 0; offset < input.range_days; offset += 1) {
    const range = dayRange(now, offset);
    days.push({ date: range.date, value: await metricValue(input.metric, range) });
  }
  return { metric: input.metric, days };
}

async function metricValue(metric: ReadHealthInput["metric"], range: DayRange): Promise<number | null> {
  if (metric === "steps") {
    return sumFor("HKQuantityTypeIdentifierStepCount", range);
  }
  if (metric === "calories") {
    return sumFor("HKQuantityTypeIdentifierActiveEnergyBurned", range);
  }
  if (metric === "heart_rate") {
    return restingHeartRate(range);
  }
  if (metric === "sleep") {
    const sleep = await sleepFor(range);
    return sleep?.minutes ?? null;
  }
  const workouts = await workoutsFor(range);
  return workouts.length;
}
