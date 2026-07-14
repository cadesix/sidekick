import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { reminders, users } from "@sidekick/db";
import type { Database } from "@sidekick/db";
import {
  computeNextFireAt,
  localDate,
  parseSchedule,
  scheduleSchema,
  userTimezone,
} from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";

type ReminderRow = typeof reminders.$inferSelect;

async function ownedReminder(
  db: Database,
  reminderId: string,
  userId: string,
): Promise<ReminderRow> {
  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "reminder not found" });
  }
  return row;
}

function toItem(row: ReminderRow) {
  return {
    id: row.id,
    text: row.text,
    schedule: parseSchedule(row.schedule),
    status: row.status,
    nextFireAt: row.nextFireAt ? row.nextFireAt.toISOString() : null,
  };
}

export const remindersRouter = router({
  /** The reminders screen's data (10 §screen): TODAY / UPCOMING / PAUSED. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    const timezone = await userTimezone(db, userId);
    const today = localDate(timezone, new Date());

    const rows = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, userId), inArray(reminders.status, ["active", "paused"])))
      .orderBy(asc(reminders.nextFireAt), desc(reminders.updatedAt));

    const todayItems = [];
    const upcoming = [];
    const paused = [];
    for (const row of rows) {
      if (row.status === "paused") {
        paused.push(toItem(row));
        continue;
      }
      const fireDay = row.nextFireAt ? localDate(timezone, row.nextFireAt) : null;
      if (fireDay && fireDay <= today) {
        todayItems.push(toItem(row));
      } else {
        upcoming.push(toItem(row));
      }
    }
    return { today: todayItems, upcoming, paused };
  }),

  /** Edit a reminder's text and/or schedule; recomputes `nextFireAt` on a schedule change. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        text: z.string().min(1).optional(),
        schedule: scheduleSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      const existing = await ownedReminder(db, input.id, userId);
      const nextFireAt =
        input.schedule && existing.status === "active"
          ? computeNextFireAt(input.schedule, existing.timezone, new Date(), existing.createdAt)
          : existing.nextFireAt;
      await db
        .update(reminders)
        .set({
          text: input.text ?? existing.text,
          schedule: input.schedule ?? existing.schedule,
          nextFireAt,
          updatedAt: new Date(),
        })
        .where(eq(reminders.id, input.id));
      return { ok: true };
    }),

  pause: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ownedReminder(ctx.db, input.id, ctx.userId);
      await ctx.db
        .update(reminders)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(reminders.id, input.id));
      return { ok: true, status: "paused" as const };
    }),

  resume: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ownedReminder(ctx.db, input.id, ctx.userId);
      const schedule = parseSchedule(existing.schedule);
      const nextFireAt = schedule
        ? computeNextFireAt(schedule, existing.timezone, new Date(), existing.createdAt)
        : existing.nextFireAt;
      await ctx.db
        .update(reminders)
        .set({ status: "active", nextFireAt, updatedAt: new Date() })
        .where(eq(reminders.id, input.id));
      return { ok: true, status: "active" as const };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ownedReminder(ctx.db, input.id, ctx.userId);
      await ctx.db
        .update(reminders)
        .set({ status: "deleted", nextFireAt: null, updatedAt: new Date() })
        .where(eq(reminders.id, input.id));
      return { ok: true };
    }),
});
