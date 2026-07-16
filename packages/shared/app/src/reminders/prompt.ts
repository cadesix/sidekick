/**
 * The reminder-delivery prompt (10-reminders.md §delivery step 1). A dedicated
 * cheap-model call phrases the reminder in the sidekick's voice — persona + a
 * trimmed memory block + the verbatim reminder text → a 1–2 sentence nudge. On
 * any model failure the cron falls back to `reminder: {text}`, so this prompt
 * only ever shapes the happy path.
 */
export const REMINDER_DELIVERY_PROMPT = {
  version: "reminder-delivery-v1",
} as const;

/**
 * Chat-side guidance for the reminder tools (10 §chat tools + §delivery). The
 * chat-core engineer appends this to the system prompt alongside the rendered
 * REMINDERS context — same seam as CHECKIN_CHAT_GUIDANCE.
 */
export const REMINDER_CHAT_GUIDANCE = `Reminders:
- If the time is genuinely unclear ("remind me later"), ask ONE clarifying question, then create — never create with a guessed time silently.
- After delivering a reminder, follow the user's lead — snooze (update_reminder), complete, or drop it without ceremony.` as const;

export type ReminderDeliveryInput = {
  sidekickName: string;
  userName: string | null;
  /** The user's own words for what to be reminded of. */
  reminderText: string;
  /** A few active memory highlights, for voice and context (may be empty). */
  memoryHighlights: string[];
};

export function renderReminderDeliverySystem(input: ReminderDeliveryInput): string {
  const lines = [
    `You are ${input.sidekickName}, the user's sidekick — a warm, slightly cheeky friend who texts them.`,
    "The user earlier asked you to remind them about something, and that time is now.",
    "Deliver the reminder in your own voice, like a friend giving them a nudge.",
    "",
    "Rules:",
    "- 1–2 short sentences, lowercase, casual, texty. No markdown, no lists. An emoji is fine, not required.",
    "- Make it clearly a reminder about the thing below — don't bury the point.",
    "- Warm and human, never robotic. Don't say 'reminder:' or read it like an alarm.",
  ];
  return lines.join("\n");
}

export function renderReminderDeliveryUser(input: ReminderDeliveryInput): string {
  const lines: string[] = [];
  lines.push(input.userName ? `Their name is ${input.userName}.` : "You don't know their name yet.");
  lines.push("", `Remind them about: ${input.reminderText}`);
  if (input.memoryHighlights.length > 0) {
    lines.push("", "A little context about them (weave in only if it helps):");
    for (const highlight of input.memoryHighlights) {
      lines.push(`- ${highlight}`);
    }
  }
  return lines.join("\n");
}
