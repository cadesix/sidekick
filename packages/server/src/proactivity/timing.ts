import { localCalendarDate, localDate, parseTimeOfDay, zonedWallTimeToUtc } from "@sidekick/shared";

const MINIMUM_REMAINING_MINUTES = 30;

function addLocalDays(date: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function windowForDate(
  date: { year: number; month: number; day: number },
  awakeStart: string,
  awakeEnd: string,
  timezone: string,
): { start: Date; end: Date } {
  const startTime = parseTimeOfDay(awakeStart);
  const endTime = parseTimeOfDay(awakeEnd);
  const crossesMidnight =
    endTime.hour < startTime.hour ||
    (endTime.hour === startTime.hour && endTime.minute <= startTime.minute);
  const endDate = crossesMidnight ? addLocalDays(date, 1) : date;
  return {
    start: zonedWallTimeToUtc({ ...date, ...startTime }, timezone),
    end: zonedWallTimeToUtc({ ...endDate, ...endTime }, timezone),
  };
}

export function nextProactiveTime(input: {
  eligibleAt: Date;
  timezone: string;
  awakeStart: string;
  awakeEnd: string;
  random: () => number;
}): { scheduledFor: Date; localSlotDate: string } {
  const local = localCalendarDate(input.eligibleAt, input.timezone);
  let chosen = windowForDate(local, input.awakeStart, input.awakeEnd, input.timezone);
  if (chosen.end <= input.eligibleAt) {
    chosen = windowForDate(addLocalDays(local, 1), input.awakeStart, input.awakeEnd, input.timezone);
  }
  let availableStart = chosen.start > input.eligibleAt ? chosen.start : input.eligibleAt;
  if (chosen.end.getTime() - availableStart.getTime() < MINIMUM_REMAINING_MINUTES * 60_000) {
    const nextDate = addLocalDays(localCalendarDate(chosen.end, input.timezone), 1);
    chosen = windowForDate(nextDate, input.awakeStart, input.awakeEnd, input.timezone);
    availableStart = chosen.start;
  }
  const availableMinutes = Math.max(
    0,
    Math.floor((chosen.end.getTime() - availableStart.getTime()) / 60_000),
  );
  const offset = Math.floor(input.random() * (availableMinutes + 1));
  const scheduledFor = new Date(availableStart.getTime() + offset * 60_000);
  return { scheduledFor, localSlotDate: localDate(input.timezone, chosen.start) };
}

export function insideAwakeWindow(
  now: Date,
  timezone: string,
  awakeStart: string,
  awakeEnd: string,
): boolean {
  const local = localCalendarDate(now, timezone);
  const today = windowForDate(local, awakeStart, awakeEnd, timezone);
  if (now >= today.start && now <= today.end) {
    return true;
  }
  const yesterday = windowForDate(addLocalDays(local, -1), awakeStart, awakeEnd, timezone);
  return now >= yesterday.start && now <= yesterday.end;
}
