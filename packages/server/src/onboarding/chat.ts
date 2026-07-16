import { and, eq } from "drizzle-orm";
import { type LanguageModel, generateText } from "ai";
import { type Database, conversations, goals, messages } from "@sidekick/db";
import {
  ONBOARDING_INTRO_INSTRUCTION,
  buildContextView,
  estimateTokens,
  getGoalDefinition,
  renderSystem,
} from "@sidekick/shared";
import { modelName } from "../model";

/**
 * Start (or resume) the LLM-driven onboarding chat (02 §onboarding chat).
 * Idempotent per user: an existing `kind='onboarding'` conversation is returned
 * as-is so re-entering the funnel step never restarts the beats. First call:
 * creates the conversation, seeds a planless `goals` row per funnel-chosen slug
 * (the beat machine derives "current step" from which goals still lack an active
 * action item), and renders the sidekick's intro — one LLM call against the
 * onboarding context view — as the first assistant message.
 */
export async function startOnboardingChat(
  db: Database,
  model: LanguageModel,
  userId: string,
  goalSlugs: string[],
): Promise<{ conversationId: string }> {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.kind, "onboarding")))
    .limit(1);
  if (existing[0]) {
    return { conversationId: existing[0].id };
  }

  const inserted = await db
    .insert(conversations)
    .values({ userId, kind: "onboarding" })
    .returning({ id: conversations.id });
  const conversationId = inserted[0]?.id;
  if (!conversationId) {
    throw new Error("failed to create onboarding conversation");
  }

  for (const slug of goalSlugs) {
    const owned = await db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.slug, slug), eq(goals.status, "active")))
      .limit(1);
    if (!owned[0]) {
      await db
        .insert(goals)
        .values({ userId, slug, label: getGoalDefinition(slug)?.label ?? slug, status: "active" });
    }
  }

  const view = await buildContextView(db, conversationId);
  const { text } = await generateText({
    model,
    system: renderSystem(view.system),
    prompt: ONBOARDING_INTRO_INSTRUCTION,
  });
  await db.insert(messages).values({
    conversationId,
    role: "assistant",
    content: text,
    tokenEstimate: estimateTokens(text),
    model: modelName(model),
    promptVersion: view.promptVersion,
  });

  return { conversationId };
}
