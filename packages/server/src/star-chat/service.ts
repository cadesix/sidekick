import { eq } from "drizzle-orm";
import { type LanguageModel, generateText } from "ai";
import { type Database, users } from "@sidekick/db";
import { buildArtifactPrompt, buildCardPrompt, buildControllerPrompt } from "@sidekick/core";
import type { StarChatControllerInput, StarChatStateInput } from "@sidekick/shared";
import { parseStoredAstral } from "../sessions/service";

// The Star Chat's LLM calls, moved server-side from packages/expo's StarChat.tsx
// — which called api.openai.com directly with a key bundled into the app. The
// prompts themselves already lived in @sidekick/core, so the server builds them
// from the state it's handed rather than accepting prompt text: token budgets,
// the fixed user turns and the 20s bound are a VERBATIM port of that client code.

const LLM_TIMEOUT_MS = 20000;

/**
 * One model turn → the reply text, or null on error/timeout. Null is
 * load-bearing: the runner falls back to its scripted nudge (controller) or its
 * fallback artifact, so a failure must never be papered over with invented text.
 */
async function llm(
  model: LanguageModel,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      system,
      prompt: user,
      maxOutputTokens: maxTokens,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (text.trim()) return text.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * The chapter-boundary card pass: deepen the astral card from everything learned
 * plus the card they already have. The prior card is read from the DB (the same
 * row `sessions.complete` writes), never from the payload — so a client can't
 * seed the reading it wants back.
 */
export async function starChatCard(
  db: Database,
  model: LanguageModel,
  userId: string,
  input: StarChatStateInput,
): Promise<string | null> {
  const rows = await db.select({ astral: users.astral }).from(users).where(eq(users.id, userId)).limit(1);
  const prior = parseStoredAstral(rows[0]?.astral);
  return llm(model, buildCardPrompt(input.state, prior), "write it now.", 460);
}

/** The final payoff pass: the full artifact, with evidence-cited insights. */
export function starChatArtifact(
  model: LanguageModel,
  input: StarChatStateInput,
): Promise<string | null> {
  return llm(model, buildArtifactPrompt(input.state), "write the artifact now.", 520);
}

/** One controller turn: react + extract + steer, over the recent transcript. */
export function starChatController(
  model: LanguageModel,
  input: StarChatControllerInput,
): Promise<string | null> {
  const transcript = input.messages
    .map((m) => `${m.role === "bot" ? "sidekick" : "user"}: ${m.text}`)
    .join("\n");
  return llm(model, buildControllerPrompt(input.state), transcript, 340);
}
