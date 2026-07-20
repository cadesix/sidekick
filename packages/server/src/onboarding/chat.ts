import { type LanguageModel, generateText } from "ai";
import { type Database, conversations, messages } from "@sidekick/db";
import {
  HABIT_INTRO_INSTRUCTION,
  buildContextView,
  estimateTokens,
  renderSystem,
} from "@sidekick/shared";
import { modelName } from "../model";

/**
 * Start a fresh guided habit-add chat (the goal-screen "+"): a new
 * `kind='habit'` conversation with the sidekick's intro. Not idempotent — each
 * "+" is its own short flow that creates one new goal via `commit_habit`.
 */
export async function startHabitChat(
  db: Database,
  model: LanguageModel,
  userId: string,
): Promise<{ conversationId: string }> {
  const inserted = await db
    .insert(conversations)
    .values({ userId, kind: "habit" })
    .returning({ id: conversations.id });
  const conversationId = inserted[0]?.id;
  if (!conversationId) {
    throw new Error("failed to create habit conversation");
  }

  const view = await buildContextView(db, conversationId);
  const { text } = await generateText({
    model,
    system: renderSystem(view.system),
    prompt: HABIT_INTRO_INSTRUCTION,
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
