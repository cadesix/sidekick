import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { actionItems, goals, type Database } from "@sidekick/db";
import {
  CUSTOM_ACTION_SLUG,
  type Cadence,
  cadenceSchema,
  defaultActionItem,
  getActionItemTemplate,
  getGoalDefinition,
} from "@sidekick/shared";

export type AdoptGoalInput = {
  slug: string;
  actionSlug?: string;
  cadence?: Cadence;
  label?: string;
};

/**
 * Adopt a catalog goal with a chosen (or default) action item — the same logic
 * as `goals.adopt`, factored out so the onboarding cold-start transaction can
 * seed goals directly (and return the resolved cadence for the memory sentence).
 */
export async function adoptGoal(db: Database, userId: string, input: AdoptGoalInput) {
  const definition = getGoalDefinition(input.slug);
  const label = input.label ?? definition?.label ?? input.slug;

  const insertedGoal = await db
    .insert(goals)
    .values({ userId, slug: input.slug, label, status: "active" })
    .returning();
  const goal = insertedGoal[0];
  if (!goal) {
    throw new Error("failed to create goal");
  }

  const template =
    input.actionSlug && definition
      ? getActionItemTemplate(input.slug, input.actionSlug)
      : defaultActionItem(input.slug);

  const actionSlug = template?.slug ?? input.actionSlug ?? CUSTOM_ACTION_SLUG;
  const actionLabel = template?.label ?? input.label ?? "Custom action";
  const cadence = input.cadence ?? template?.defaultCadence;
  if (!cadence) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "a cadence is required for a custom action item",
    });
  }

  const insertedItem = await db
    .insert(actionItems)
    .values({ goalId: goal.id, slug: actionSlug, label: actionLabel, cadence, status: "active" })
    .returning();

  return { goal, actionItem: insertedItem[0], cadence };
}

export type GoalPlanSummary = {
  label: string;
  actionLabel: string | undefined;
  cadence: Cadence | undefined;
};

/**
 * Make sure one funnel-chosen goal ends up fully planned, whatever happened in
 * the onboarding chat (02 §onboarding chat):
 * - the LLM chat already committed it (goal + action item exist) → keep the
 *   chat's plan untouched;
 * - the chat was abandoned after `startOnboardingChat` seeded a planless goal
 *   row → give it the input/default action item;
 * - the scripted fallback ran (no rows at all) → full adopt.
 * Returns the final plan for the goal-context memory sentence.
 */
export async function ensureGoalPlan(
  db: Database,
  userId: string,
  input: AdoptGoalInput,
): Promise<GoalPlanSummary> {
  const existing = await db
    .select({ id: goals.id, label: goals.label })
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.slug, input.slug), eq(goals.status, "active")))
    .limit(1);
  const goal = existing[0];
  if (!goal) {
    const adopted = await adoptGoal(db, userId, input);
    return {
      label: adopted.goal.label ?? input.slug,
      actionLabel: adopted.actionItem?.label,
      cadence: adopted.cadence,
    };
  }

  const label = goal.label ?? getGoalDefinition(input.slug)?.label ?? input.slug;
  const items = await db
    .select({ label: actionItems.label, cadence: actionItems.cadence })
    .from(actionItems)
    .where(and(eq(actionItems.goalId, goal.id), eq(actionItems.status, "active")))
    .orderBy(desc(actionItems.createdAt))
    .limit(1);
  const item = items[0];
  if (item) {
    const parsed = cadenceSchema.safeParse(item.cadence);
    return { label, actionLabel: item.label, cadence: parsed.success ? parsed.data : undefined };
  }

  const template =
    input.actionSlug && getGoalDefinition(input.slug)
      ? getActionItemTemplate(input.slug, input.actionSlug)
      : defaultActionItem(input.slug);
  const actionSlug = template?.slug ?? input.actionSlug ?? CUSTOM_ACTION_SLUG;
  const actionLabel = template?.label ?? input.label ?? "Custom action";
  const cadence = input.cadence ?? template?.defaultCadence;
  if (!cadence) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "a cadence is required for a custom action item",
    });
  }
  await db
    .insert(actionItems)
    .values({ goalId: goal.id, slug: actionSlug, label: actionLabel, cadence, status: "active" });
  return { label, actionLabel, cadence };
}
