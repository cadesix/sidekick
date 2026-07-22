import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { actionItems, checkIns, goals, messages, progressEvents } from "@sidekick/db";
import type { Database } from "@sidekick/db";
import {
  cadenceSchema,
  currentStreak,
  estimateTokens,
  getActionItemTemplate,
  getGoalDefinition,
  localDate,
  logCheckInInput,
  logGoalProgress,
  addDays,
  mondayOf,
  userTimezone,
  weekStart,
} from "@sidekick/shared";
import { ensureMainConversation } from "../chat/turn";
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

    // All events (not just this week) so we can derive each goal's current
    // day-streak; the week strip is filtered out of the same set below.
    const allEvents =
      itemIds.length > 0
        ? await db
            .select({
              actionItemId: progressEvents.actionItemId,
              date: progressEvents.date,
              outcome: progressEvents.outcome,
              note: progressEvents.note,
            })
            .from(progressEvents)
            .where(inArray(progressEvents.actionItemId, itemIds))
        : [];

    const checkInRow = await db
      .select({ status: checkIns.status })
      .from(checkIns)
      .where(and(eq(checkIns.userId, userId), eq(checkIns.date, today)))
      .limit(1);

    const streak = await userStreak(db, userId, today);

    const goalStates = goalRows.map((goal) => {
      const item = itemByGoal.get(goal.id);
      const events = item ? allEvents.filter((e) => e.actionItemId === item.id) : [];
      const todayEvent = events.find((e) => e.date === today);
      const hitDates = events
        .filter((e) => e.outcome === "hit" || e.outcome === "partial")
        .map((e) => e.date);
      const weekCompleted = hitDates.filter(
        (d) => d >= windowStart && d <= today,
      ).length;
      // consecutive-day streak ending today (or yesterday) — days in a row done
      const goalStreak = currentStreak(hitDates, today);
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
        streak: goalStreak,
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

  /**
   * The GoalsSheet's manual weekly toggle (plan 20 decision 8): mark a day hit
   * (or any outcome), or clear it with `result: null`. Shares the chat
   * `log_checkin` write path so both sources land as identical `progress_events`
   * rows and the read paths agree — tagged `manual`. A future date is rejected
   * (no backfilling tomorrow); the day is upserted on `(actionItem, date)`.
   */
  logCheckIn: protectedProcedure.input(logCheckInInput).mutation(async ({ ctx, input }) => {
    const { db, userId } = ctx;
    await assertGoalOwned(db, input.goalId, userId);
    const today = localDate(await userTimezone(db, userId), new Date());
    if (input.date > today) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "can't log a future day" });
    }
    const logged = await logGoalProgress(db, userId, {
      goalId: input.goalId,
      date: input.date,
      outcome: input.result,
      source: "manual",
    });
    if (!logged.ok) {
      throw new TRPCError({ code: "NOT_FOUND", message: logged.error });
    }
    return { date: input.date, outcome: logged.outcome };
  }),

  /**
   * Goal tap → the sidekick asks about it in the MAIN chat. Drops a canned
   * "did you [action] today?" assistant message into the user's main
   * conversation; the user's reply then flows through a normal turn, where the
   * always-on `log_checkin` tool marks the goal from their answer (hit/missed/
   * partial). Returns the main conversation id so the client can revalidate the
   * transcript and slide the chat open onto the question.
   */
  askCheckin: protectedProcedure
    .input(z.object({ goalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      await assertGoalOwned(db, input.goalId, userId);

      const goalRows = await db.select().from(goals).where(eq(goals.id, input.goalId)).limit(1);
      const goal = goalRows[0];
      if (!goal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "goal not found" });
      }
      const itemRows = await db
        .select({ label: actionItems.label })
        .from(actionItems)
        .where(and(eq(actionItems.goalId, goal.id), eq(actionItems.status, "active")))
        .orderBy(desc(actionItems.createdAt))
        .limit(1);
      const definition = getGoalDefinition(goal.slug);
      // the concrete daily action (falls back to the goal label), lowercased for the
      // mid-sentence texting voice — mirrors the GoalCard phrasing on the client
      const action = (
        itemRows[0]?.label ??
        goal.label ??
        definition?.label ??
        goal.slug
      ).toLowerCase();
      const question = `did you ${action} today?`;

      const conversation = await ensureMainConversation(db, userId);
      await db.insert(messages).values({
        conversationId: conversation.id,
        role: "assistant",
        content: question,
        tokenEstimate: estimateTokens(question),
      });

      return { conversationId: conversation.id };
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
