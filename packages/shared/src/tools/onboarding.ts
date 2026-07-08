import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { actionItems, goals, users } from "@sidekick/db";
import { cadencePhrase } from "../onboarding-chat";
import { cadenceSchema, getActionItemTemplate, getGoalDefinition } from "../goals/catalog";
import { defineTool, type SidekickTool } from "./types";

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
