import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { actionItems, checkIns, goals, progressEvents } from "@sidekick/db";
import type { Database } from "@sidekick/db";
import {
  cadenceSchema,
  currentStreak,
  getActionItemTemplate,
  getGoalDefinition,
  localDate,
  addDays,
  mondayOf,
  userTimezone,
  weekStart,
} from "@sidekick/shared";
import { adoptGoal } from "../onboarding/adopt";
import { userStreak } from "../rewards/service";
import { protectedProcedure, router } from "../trpc";

async function assertGoalOwned(db: Database, goalId: string, userId: string): Promise<void> {
  const rows = await db
    .select({ userId: goals.userId })
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);
  if (!rows[0] || rows[0].userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "goal not found" });
  }
}

const adoptInput = z.object({
  slug: z.string().min(1),
  actionSlug: z.string().min(1).optional(),
  cadence: cadenceSchema.optional(),
  label: z.string().min(1).optional(),
});

export const goalsRouter = router({
  /** Adopt a goal from the catalog with a chosen (or default) action item. */
  adopt: protectedProcedure.input(adoptInput).mutation(async ({ ctx, input }) => {
    const { goal, actionItem } = await adoptGoal(ctx.db, ctx.userId, input);
    return { goal, actionItem };
  }),

  /** Today's home-screen checklist: every active goal with its state (03/07). */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    const now = new Date();
    const timezone = await userTimezone(db, userId);
    const today = localDate(timezone, now);
    const windowStart = weekStart(today);

    const goalRows = await db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
      .orderBy(asc(goals.createdAt));
    const goalIds = goalRows.map((g) => g.id);

    const items =
      goalIds.length > 0
        ? await db
            .select()
            .from(actionItems)
            .where(and(inArray(actionItems.goalId, goalIds), eq(actionItems.status, "active")))
            .orderBy(desc(actionItems.createdAt))
        : [];
    const itemByGoal = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      if (!itemByGoal.has(item.goalId)) {
        itemByGoal.set(item.goalId, item);
      }
    }
    const itemIds = [...itemByGoal.values()].map((i) => i.id);

    const weekEvents =
      itemIds.length > 0
        ? await db
            .select()
            .from(progressEvents)
            .where(
              and(
                inArray(progressEvents.actionItemId, itemIds),
                gte(progressEvents.date, windowStart),
                lte(progressEvents.date, today),
              ),
            )
        : [];

    const checkInRow = await db
      .select({ status: checkIns.status })
      .from(checkIns)
      .where(and(eq(checkIns.userId, userId), eq(checkIns.date, today)))
      .limit(1);

    const streak = await userStreak(db, userId, today);

    const goalStates = goalRows.map((goal) => {
      const item = itemByGoal.get(goal.id);
      const events = item ? weekEvents.filter((e) => e.actionItemId === item.id) : [];
      const todayEvent = events.find((e) => e.date === today);
      const weekCompleted = events.filter(
        (e) => e.outcome === "hit" || e.outcome === "partial",
      ).length;
      const parsedCadence = item ? cadenceSchema.safeParse(item.cadence) : null;
      const cadence = parsedCadence?.success ? parsedCadence.data : null;
      const target = cadence?.type === "weekly" ? cadence.target : null;
      const definition = getGoalDefinition(goal.slug);

      return {
        goalId: goal.id,
        slug: goal.slug,
        label: goal.label ?? definition?.label ?? goal.slug,
        status: goal.status,
        tier: definition?.tier ?? null,
        actionItem: item
          ? { id: item.id, slug: item.slug, label: item.label, cadence }
          : null,
        today: {
          outcome: todayEvent?.outcome ?? null,
          note: todayEvent?.note ?? null,
        },
        week: { completed: weekCompleted, target },
      };
    });

    return {
      date: today,
      checkInStatus: checkInRow[0]?.status ?? "none",
      streak,
      goals: goalStates,
    };
  }),

  /** One goal's detail (07 §4): cadence, per-goal streak, this week's strip, history. */
  detail: protectedProcedure
    .input(z.object({ goalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      await assertGoalOwned(db, input.goalId, userId);
      const timezone = await userTimezone(db, userId);
      const today = localDate(timezone, new Date());

      const goalRows = await db.select().from(goals).where(eq(goals.id, input.goalId)).limit(1);
      const goal = goalRows[0];
      if (!goal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "goal not found" });
      }
      const definition = getGoalDefinition(goal.slug);

      const itemRows = await db
        .select()
        .from(actionItems)
        .where(and(eq(actionItems.goalId, goal.id), eq(actionItems.status, "active")))
        .orderBy(desc(actionItems.createdAt))
        .limit(1);
      const item = itemRows[0] ?? null;

      const events = item
        ? await db
            .select({
              date: progressEvents.date,
              outcome: progressEvents.outcome,
              note: progressEvents.note,
              source: progressEvents.source,
            })
            .from(progressEvents)
            .where(eq(progressEvents.actionItemId, item.id))
            .orderBy(desc(progressEvents.date))
        : [];

      const streak = currentStreak(
        events.filter((e) => e.outcome === "hit" || e.outcome === "partial").map((e) => e.date),
        today,
      );

      const parsedCadence = item ? cadenceSchema.safeParse(item.cadence) : null;
      const cadence = parsedCadence?.success ? parsedCadence.data : null;

      const monday = mondayOf(today);
      const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const week = labels.map((weekday, i) => {
        const date = addDays(monday, i);
        const event = events.find((e) => e.date === date);
        return { date, weekday, outcome: event?.outcome ?? null, isToday: date === today };
      });

      return {
        goal: {
          id: goal.id,
          slug: goal.slug,
          label: goal.label ?? definition?.label ?? goal.slug,
          status: goal.status,
          tier: definition?.tier ?? null,
          weeklyChallenge: definition?.weeklyChallenge ?? false,
        },
        actionItem: item ? { id: item.id, slug: item.slug, label: item.label, cadence } : null,
        cadenceOptions:
          item && definition
            ? (getActionItemTemplate(goal.slug, item.slug)?.cadenceOptions ?? [])
            : [],
        streak,
        week,
        history: events.slice(0, 20),
      };
    }),

  /** Renegotiate a goal's active action-item cadence (chat-parallel to the tool). */
  adjust: protectedProcedure
    .input(z.object({ goalId: z.string().uuid(), cadence: cadenceSchema }))
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      await assertGoalOwned(db, input.goalId, userId);
      const rows = await db
        .select({ id: actionItems.id })
        .from(actionItems)
        .where(and(eq(actionItems.goalId, input.goalId), eq(actionItems.status, "active")))
        .orderBy(desc(actionItems.createdAt))
        .limit(1);
      const item = rows[0];
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "no active action item" });
      }
      await db.update(actionItems).set({ cadence: input.cadence }).where(eq(actionItems.id, item.id));
      return { ok: true, actionItemId: item.id, cadence: input.cadence };
    }),

  pause: protectedProcedure
    .input(z.object({ goalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertGoalOwned(ctx.db, input.goalId, ctx.userId);
      await ctx.db
        .update(goals)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(goals.id, input.goalId));
      return { ok: true, status: "paused" as const };
    }),

  complete: protectedProcedure
    .input(z.object({ goalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertGoalOwned(ctx.db, input.goalId, ctx.userId);
      await ctx.db
        .update(goals)
        .set({ status: "done", updatedAt: new Date() })
        .where(eq(goals.id, input.goalId));
      return { ok: true, status: "done" as const };
    }),
});
