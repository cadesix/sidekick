import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { actionItems, goals, users } from "@sidekick/db";
import { cadencePhrase } from "../onboarding-chat";
import {
  CUSTOM_ACTION_SLUG,
  cadenceSchema,
  getActionItemTemplate,
  getGoalDefinition,
} from "../goals/catalog";
import { defineTool, type SidekickTool } from "./types";

/** A freeform habit label → a stable goal slug (custom, not a catalog slug). */
function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "habit"
  );
}

/**
 * The onboarding chat's restricted tool set (02 §onboarding chat). These are NOT
 * a `capabilities` entry — the turn pipeline swaps them in only for
 * `conversation.kind = 'onboarding'`, so the main chat never sees them and the
 * onboarding chat never sees the main registry.
 */

export const onboardingTools: SidekickTool[] = [
  defineTool({
    name: "commit_onboarding_choice",
    description:
      "Commit one goal's plan once the user has chosen both an action and a cadence. Call exactly once per goal, silently — never announce that you called it. The state machine advances to the next step only after this is called.",
    execution: "server",
    parameters: z.object({
      goal_slug: z.string().describe('The goal being planned, e.g. "get-fit"'),
      action_slug: z
        .string()
        .describe("The chosen action item's slug from the options in your ONBOARDING SETUP CHAT context"),
      cadence: cadenceSchema
        .optional()
        .describe("The chosen cadence; omit to use the action's default"),
    }),
    execute: async ({ goal_slug, action_slug, cadence }, { db, userId }) => {
      const definition = getGoalDefinition(goal_slug);
      const existing = await db
        .select({ id: goals.id })
        .from(goals)
        .where(and(eq(goals.userId, userId), eq(goals.slug, goal_slug), eq(goals.status, "active")))
        .limit(1);
      let goalId = existing[0]?.id;
      if (!goalId) {
        const inserted = await db
          .insert(goals)
          .values({ userId, slug: goal_slug, label: definition?.label ?? goal_slug, status: "active" })
          .returning({ id: goals.id });
        goalId = inserted[0]?.id;
      }
      if (!goalId) {
        return { ok: false, error: "failed to create the goal" };
      }

      const template = getActionItemTemplate(goal_slug, action_slug);
      const resolvedCadence = cadence ?? template?.defaultCadence;
      if (!resolvedCadence) {
        return { ok: false, error: "a cadence is required for a custom action — ask how often" };
      }
      const label = template?.label ?? action_slug;

      const currentItem = await db
        .select({ id: actionItems.id })
        .from(actionItems)
        .where(and(eq(actionItems.goalId, goalId), eq(actionItems.status, "active")))
        .orderBy(desc(actionItems.createdAt))
        .limit(1);
      if (currentItem[0]) {
        await db
          .update(actionItems)
          .set({ slug: action_slug, label, cadence: resolvedCadence })
          .where(eq(actionItems.id, currentItem[0].id));
      } else {
        await db
          .insert(actionItems)
          .values({ goalId, slug: action_slug, label, cadence: resolvedCadence, status: "active" });
      }
      return {
        ok: true,
        goal: definition?.label ?? goal_slug,
        plan: `${label}, ${cadencePhrase(resolvedCadence)}`,
      };
    },
  }),
  defineTool({
    name: "commit_freeform_goal",
    description:
      "Commit the ONE freeform habit once you've landed on a concrete habit AND a cadence with the user. Use this when they didn't pick a catalog goal — you shaped the habit together. Call exactly once, silently — never announce it. The state machine advances after this.",
    execution: "server",
    parameters: z.object({
      label: z
        .string()
        .min(1)
        .describe('A short habit label in the user\'s words, e.g. "go for a run" or "read before bed"'),
      cadence: cadenceSchema.describe(
        "How often: { type: 'daily' }, { type: 'weekly', target: N }, or { type: 'daily-criteria', criteria, value }",
      ),
    }),
    execute: async ({ label, cadence }, { db, userId }) => {
      const slug = slugify(label);
      // Onboarding commits exactly ONE habit — reconcile repeated/refined calls
      // (the model may re-commit as the habit sharpens) onto the user's single
      // active goal rather than creating duplicates.
      const existing = await db
        .select({ id: goals.id })
        .from(goals)
        .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
        .orderBy(desc(goals.createdAt))
        .limit(1);
      let goalId = existing[0]?.id;
      if (goalId) {
        await db.update(goals).set({ slug, label, updatedAt: new Date() }).where(eq(goals.id, goalId));
      } else {
        const inserted = await db
          .insert(goals)
          .values({ userId, slug, label, status: "active" })
          .returning({ id: goals.id });
        goalId = inserted[0]?.id;
      }
      if (!goalId) {
        return { ok: false, error: "failed to create the goal" };
      }

      const currentItem = await db
        .select({ id: actionItems.id })
        .from(actionItems)
        .where(and(eq(actionItems.goalId, goalId), eq(actionItems.status, "active")))
        .orderBy(desc(actionItems.createdAt))
        .limit(1);
      if (currentItem[0]) {
        await db
          .update(actionItems)
          .set({ slug: CUSTOM_ACTION_SLUG, label, cadence })
          .where(eq(actionItems.id, currentItem[0].id));
      } else {
        await db
          .insert(actionItems)
          .values({ goalId, slug: CUSTOM_ACTION_SLUG, label, cadence, status: "active" });
      }
      return { ok: true, plan: `${label}, ${cadencePhrase(cadence)}` };
    },
  }),
  defineTool({
    name: "set_reminder_time",
    description:
      "Store the user's daily check-in time once they've picked one. Call silently — never announce it.",
    execution: "server",
    parameters: z.object({
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .describe('24-hour local time, e.g. "09:00" or "20:30"'),
    }),
    execute: async ({ time }, { db, userId }) => {
      await db.update(users).set({ reminderTime: time, updatedAt: new Date() }).where(eq(users.id, userId));
      return { ok: true, reminderTime: time };
    },
  }),
];
