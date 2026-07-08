/**
 * Thread-compaction prompt (08-chat-thread-compaction.md), versioned. The
 * compaction engineer owns the body; this is the verbatim template from the
 * plan. `build` fills the three slots so the summary can be regenerated from
 * immutable message history at any time.
 */
export const COMPACTION_PROMPT = {
  version: "compaction-v1",
  build({
    memoryBlock,
    currentSummary,
    newMessages,
  }: {
    memoryBlock: string;
    currentSummary: string | null;
    newMessages: string;
  }): string {
    return `You maintain the sidekick's short-term memory of one continuous friendship-chat.
Rewrite the running summary to absorb the new messages. Output ONLY the summary,
in second person ("you promised…"), under 800 tokens, using exactly these sections:

RECENT ARC — 2-4 sentences: what the last stretch of conversation has been about,
  the user's mood trajectory, anything mid-discussion.
OPEN LOOPS — things left unresolved that a good friend would follow up on.
PROMISES YOU MADE — anything you said you'd do or remember.
RUNNING BITS — inside jokes, nicknames, recurring references, tone calibrations.
ALREADY COVERED — advice given and stories told, so you never repeat them.

Rules:
- DO NOT restate facts from LONG-TERM MEMORY below — that block is always in your
  context separately. Your job is conversational texture, not biography.
- Prefer dropping the oldest, least-alive items to stay under the cap.
- Resolved loops and kept promises get deleted, not marked done.
- Never invent; if unsure whether something was said, leave it out.

LONG-TERM MEMORY (for dedup only):
${memoryBlock}

CURRENT SUMMARY:
${currentSummary ?? "(none yet)"}

NEW MESSAGES:
${newMessages}`;
  },
} as const;
