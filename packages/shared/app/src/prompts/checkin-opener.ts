/**
 * The daily check-in opener prompt (03-goals-and-checkins.md §2, user-memory.md
 * §opener). A dedicated prompt, NOT the chat prompt: one short, human opener that
 * leads with a single fresh signal and rotates tone so the daily message never
 * feels like a form. Variability is the product — sameness kills the "friend
 * texting you" illusion.
 */
export const CHECKIN_OPENER_PROMPT = {
  version: "checkin-opener-v1",
} as const;

/**
 * Rotating tone archetypes. The engine advances through these by prior-check-in
 * count so consecutive days don't repeat a register.
 */
export const TONE_ARCHETYPES = ["hype", "cozy", "curious", "playful-callback"] as const;
export type ToneArchetype = (typeof TONE_ARCHETYPES)[number];

const TONE_DIRECTION: Record<ToneArchetype, string> = {
  hype: "high-energy and pumped for them, like you can't wait for them to start the day.",
  cozy: "warm, soft, and low-key — like a text from bed on a slow morning.",
  curious: "genuinely curious about one specific thing in their life right now.",
  "playful-callback": "playful, teasing lightly, ideally calling back to something recent.",
};

/** Deterministically rotate tone by how many check-ins the user has had. */
export function pickTone(priorCheckinCount: number): ToneArchetype {
  const index = ((priorCheckinCount % TONE_ARCHETYPES.length) + TONE_ARCHETYPES.length) %
    TONE_ARCHETYPES.length;
  return TONE_ARCHETYPES[index] ?? "cozy";
}

/** One optional context signal the opener may lead with. */
export type OpenerSignal = { label: string; detail: string };

export type OpenerPromptInput = {
  sidekickName: string;
  userName: string | null;
  tone: ToneArchetype;
  dayOfWeek: string;
  /** Fresh signals, most-notable first; the opener leads with at most one. */
  signals: OpenerSignal[];
  /** Yesterday auto-closed unopened — reference gently, never with guilt. */
  yesterdaySkipped: boolean;
  /** Recent opener texts, to actively avoid repeating structure or wording. */
  recentOpeners: string[];
};

export function renderOpenerSystem(input: OpenerPromptInput): string {
  const lines = [
    `You are ${input.sidekickName}, the user's sidekick — a warm, slightly cheeky friend who texts them every day.`,
    `Write ONE opener message to start today's conversation. It is ${input.dayOfWeek}.`,
    "",
    "Rules:",
    "- 1–2 short sentences, lowercase, casual, texty. No markdown, no lists. An emoji is fine, not required.",
    "- Reference AT MOST ONE thing from the context below. If nothing fits, just be a friend about the day itself.",
    "- Never open on a missed goal with guilt. Never nag. Never sound like a reminder or a form.",
    "- Don't quote or list the context. Weave it in the way a friend naturally would.",
    `- Tone for today: ${TONE_DIRECTION[input.tone]}`,
  ];
  if (input.yesterdaySkipped) {
    lines.push(
      "- They didn't check in yesterday. If you reference it at all, be light and forward-looking (a fresh-start vibe), never disappointed.",
    );
  }
  if (input.recentOpeners.length > 0) {
    lines.push(
      "",
      "Your recent openers (do NOT repeat their structure, opening word, or vibe):",
      ...input.recentOpeners.map((o) => `- "${o}"`),
    );
  }
  return lines.join("\n");
}

export function renderOpenerUser(input: OpenerPromptInput): string {
  const lines: string[] = [];
  lines.push(input.userName ? `Their name is ${input.userName}.` : "You don't know their name yet.");
  if (input.signals.length > 0) {
    lines.push("", "Fresh context (lead with at most one, or none):");
    for (const s of input.signals) {
      lines.push(`- ${s.label}: ${s.detail}`);
    }
  } else {
    lines.push("", "No fresh context — open on the day itself.");
  }
  lines.push("", "Write the opener now. Output only the message text.");
  return lines.join("\n");
}
