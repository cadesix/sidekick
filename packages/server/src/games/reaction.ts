import { generateText, type LanguageModel } from "ai";
import type { GameActor, GameType } from "@sidekick/core";
import { type Database, messages } from "@sidekick/db";
import {
  GAMES_CHAT_GUIDANCE,
  PERSONA_PROMPT,
  describeHighlight,
  estimateTokens,
  gameDisplayName,
} from "@sidekick/shared";

export type GameReactionInput = {
  conversationId: string;
  gameType: GameType;
  winner: GameActor;
  /** Winner-first final tally, e.g. "10–7" — context for the model, not to recite. */
  standing: string;
  highlights: string[];
};

/** The one factual line the model reacts to (plan 21 §"The one reaction message"). */
function resultLine(input: GameReactionInput): string {
  const who = input.winner === "user" ? "the user won" : "you won";
  const notable =
    input.highlights.length > 0
      ? ` notable: ${input.highlights.map(describeHighlight).join(", ")}.`
      : "";
  const tally = input.standing.length > 0 ? ` ${input.standing}` : "";
  return `a game of ${gameDisplayName(input.gameType)} just finished. ${who}${tally}.${notable}`;
}

/**
 * The single in-voice reaction a completed match earns (plan 21 §"The one reaction
 * message"): persona + games guidance + the factual result → one short assistant
 * bubble, inserted into the match's conversation. The outside-a-turn model call +
 * insertion precedent is `proactivity/generator.ts`. No push notification — the
 * user is in the app, one tap from chat, and refetches on overlay dismiss.
 *
 * Called AFTER the completion transaction commits, and its caller swallows any
 * error (reward + state commit first — plan 21 §"Failure & edge behavior").
 */
export async function generateGameReaction(
  db: Database,
  model: LanguageModel,
  input: GameReactionInput,
): Promise<void> {
  const { text } = await generateText({
    model,
    system: `${PERSONA_PROMPT.text}\n\n${GAMES_CHAT_GUIDANCE}`,
    prompt: `${resultLine(input)}\nreact in one short message, like a friend who was just playing.`,
  });
  const content = text.trim();
  if (content.length === 0) {
    return;
  }
  await db.insert(messages).values({
    conversationId: input.conversationId,
    role: "assistant",
    content,
    tokenEstimate: estimateTokens(content),
  });
}
