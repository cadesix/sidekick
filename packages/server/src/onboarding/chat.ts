import { type LanguageModel, generateObject, generateText } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Database, conversations, messages } from "@sidekick/db";
import { buildContextView, estimateTokens } from "@sidekick/shared";
import { overheadExpressionSchema, type OverheadExpression } from "../chat/expression";
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

  // Fixed two-message opener (hyped, deterministic — no intro model call). Inserted
  // sequentially so their timestamps order correctly in the transcript.
  const view = await buildContextView(db, conversationId);
  const openers = ["WOO NEW GOAL TIME!", "lets get after it, what habit do you want to add?"];
  for (const content of openers) {
    await db.insert(messages).values({
      conversationId,
      role: "assistant",
      content,
      tokenEstimate: estimateTokens(content),
      model: modelName(model),
      promptVersion: view.promptVersion,
    });
  }

  return { conversationId };
}

const HABIT_ACK_SYSTEM = `You are the user's sidekick — a little character on their home screen. They just finished setting up a NEW habit with you in the chat and walked back to you. Say ONE short, hyped, encouraging line reacting to the SPECIFIC habit they committed to — name it and show you're in it with them. Lowercase texting voice, warm and a little playful, at most one emoji. No quotes, no preamble. One line only.`;

/**
 * A personalized "you got a new habit!" line for the home speech bubble after the
 * goal-screen "+" flow finishes — riffs on the just-created habit from the chat
 * transcript (mirrors chat.capoff, but hyped rather than snarky).
 */
export async function generateHabitAck(
  db: Database,
  model: LanguageModel,
  userId: string,
  conversationId: string,
): Promise<{ line: string | null; expression: OverheadExpression }> {
  // ownership guard — only riff on the caller's own habit conversation
  const conv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!conv[0]) {
    return { line: null, expression: "happy" };
  }

  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(12);
  const transcript = rows
    .reverse()
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => `${r.role === "user" ? "them" : "you"}: ${r.content}`)
    .join("\n");
  if (transcript.trim().length === 0) {
    return { line: null, expression: "happy" };
  }

  const { object } = await generateObject({
    model,
    schema: z.object({ line: z.string(), expression: overheadExpressionSchema }),
    system: HABIT_ACK_SYSTEM,
    prompt: `the conversation:\n${transcript}\n\nwrite the one-liner and pick the matching face now.`,
  });
  const line = object.line.trim();
  return { line: (line.length > 0 ? line : null) as string | null, expression: object.expression };
}

const ACTION_REGULATE_SYSTEM = `You turn a user's freeform habit idea into ONE concrete DAILY CHECKPOINT — a tiny action they can do and check off every single day during onboarding.

A good daily checkpoint:
- is doable in a single day, ideally a few minutes
- is a concrete thing you DO, not a vague outcome, feeling, or one-time task
- is a short lowercase phrase, 2–6 words, no leading "do"/"try", no period
- good examples: "a 10-min walk", "read 5 pages", "drink water first thing", "10 pushups", "jot one gratitude"

Decide:
- If the idea can become a daily checkpoint, set ok=true and put the cleaned-up checkpoint in "action" (rewrite it to fit the rules while keeping their intent; scale big goals down to a daily version — "run a marathon" → "a short run"). Leave "nudge" empty.
- If it truly can't be a daily action (a vague feeling with no action, an unrelated thing, or a strict one-time task), set ok=false, leave "action" empty, and put a short warm one-line nudge in "nudge" that references their idea and asks for a small daily version. lowercase texting voice, at most one emoji.`;

const actionRegulateSchema = z.object({
  ok: z.boolean(),
  action: z.string(),
  nudge: z.string(),
});

/**
 * Regulate a user's freeform onboarding action into a daily checkpoint. Used by
 * the scripted intro chat's "which feels doable?" step when the user types their
 * own instead of tapping a preset: the model normalizes it into a small daily
 * action (ok), or — if it can't be a daily action — bounces back a nudge so the
 * chat re-asks. Pure normalization; no db/user state.
 */
export async function regulateHabitAction(
  model: LanguageModel,
  improve: string,
  text: string,
): Promise<{ ok: true; action: string } | { ok: false; nudge: string }> {
  const { object } = await generateObject({
    model,
    schema: actionRegulateSchema,
    system: ACTION_REGULATE_SYSTEM,
    prompt: `they want to improve: ${improve}\ntheir idea: "${text}"\n\nregulate it into a daily checkpoint now.`,
  });
  const action = object.action.trim();
  if (object.ok && action.length > 0) {
    return { ok: true, action };
  }
  const nudge = object.nudge.trim();
  return {
    ok: false,
    nudge:
      nudge.length > 0
        ? nudge
        : "let's make that something you can do every day — what's a small daily version?",
  };
}
