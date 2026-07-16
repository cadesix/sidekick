import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

const proactiveOutput = z.object({
  bubbles: z.array(z.string().trim().min(1).max(180)).min(1).max(3),
});

export const PROACTIVE_PROMPT_VERSION = "proactive-v1";

export async function generateProactiveBubbles(
  model: LanguageModel,
  input: {
    sidekickName: string;
    userName: string | null;
    recentMessages: { role: string; content: string }[];
    recentProactiveMessages: string[];
  },
): Promise<string[]> {
  const { object } = await generateObject({
    model,
    schema: proactiveOutput,
    system: `You are ${input.sidekickName}, a close, warm sidekick texting a friend. Write one coherent thought as 1-3 natural text-message bubbles. Prefer one bubble. Each bubble is at most 180 characters. Never guilt them, mention how long they were gone, manufacture urgency, mention private health/location/financial/sexual details, or use generic engagement bait. No ads. Continue a meaningful unfinished thread when possible.`,
    prompt: JSON.stringify({
      userName: input.userName,
      recentConversation: input.recentMessages,
      avoidRepeating: input.recentProactiveMessages,
    }),
  });
  return object.bubbles;
}
