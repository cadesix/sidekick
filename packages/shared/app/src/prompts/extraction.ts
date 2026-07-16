/**
 * Memory-extraction prompt (user-memory.md §2), versioned. One cheap-model call
 * per idle session produces `apply_memory_ops`. The guardrails from the plan are
 * inline: cap the op count, skip trivia, keep sensitive categories out of
 * `interest`, and reference existing ids so dedup works instead of re-adding.
 */
export const EXTRACTION_PROMPT = {
  version: "extraction-v1",
  build({
    activeMemories,
    suppressions,
    transcript,
  }: {
    activeMemories: string;
    suppressions: string;
    transcript: string;
  }): string {
    return `You maintain a user's long-term memory for a friendship-chat app. Read the new
transcript and decide what is worth remembering in a week. Return apply_memory_ops.

Rules:
- Only durable facts about the user: identity, work/school, relationships, schedule,
  interests, preferences, dated events, emotional patterns, goal context.
- Prefer reinforce/supersede over add when an existing memory already covers a fact.
  Reference its id. A changed fact ("new job") is a supersede of the old memory.
- At most 8 ops. Skip message-level trivia ("said good morning").
- One plain third-person sentence per memory ("works nights as a nurse at UCSF").
- Events need a date (event_date); otherwise classify as goal_context.
- Health conditions, sexuality, religion, politics, finances are NEVER interest —
  use emotional/identity only if clearly useful for support, never for ads.
- When the user shows a concrete purchase intent — a thing they're about to buy or
  shop for ("my running shoes are dead", "need a new backpack for the trip") — add
  an "intent" op: content is a short noun phrase ("running shoes"), strength
  "active" if they're shopping now else "passive". NEVER an intent for anything
  sensitive (health, medical, money trouble).
- NEVER re-add anything in the SUPPRESSED list. NEVER invent facts.

ACTIVE MEMORIES (id · kind · content):
${activeMemories}

SUPPRESSED (never re-learn these):
${suppressions}

NEW TRANSCRIPT:
${transcript}`;
  },
} as const;
