# Agent tapbacks — let the sidekick react to messages

## Goal

The sidekick can send iMessage-style reactions (heart, haha, thumbs up, custom
emoji, …) on the user's messages, like a real friend texting — including
reaction-*only* replies where the tapback is the whole response. It also
understands tapbacks the user puts on its messages.

## Current state (verified)

Almost all the plumbing exists; only the agent-side path is missing.

| Piece | State |
|---|---|
| `ReactionType` (`heart\|thumbsUp\|thumbsDown\|haha\|exclamation\|question\|emoji:${string}`) + `Reaction { type, from: "me" \| "them" }` | exists — `packages/shared/app/src/schemas.ts:8` |
| `messages.reactions` jsonb column | exists — `packages/db/src/schema.ts:296`, no migration needed |
| UI renders reactions for both senders (corner-aware) | exists — `TapbackBadge.tsx`, `MessageRow.tsx`; a `from: "them"` reaction renders today with zero UI changes |
| `chat.react` mutation | user-only (`from: "me"` hardcoded) but already **preserves** `from !== "me"` reactions — `packages/server/src/routers/chat.ts:181` |
| LLM tool for reacting | **missing** — no tool in the capability registry |
| Reactions in the model's context view | **missing** — `tailMessages` doesn't select `reactions`; `assembleTail` never renders them |
| Empty-bubble handling for tapback-only turns | **missing** — `fetchTranscript` (`packages/expo/src/imessage/server.ts:114`) keeps assistant rows with empty content → would render an empty bubble |

## Design decisions

1. **Targeting: the user's latest message, no message-id plumbing.** The model
   view (`assembleTail`) carries no message ids, and exposing them would add
   noise + cache churn. A turn always persists the triggering user message
   before `driveTurn`, so "most recent `role='user'` row in this conversation"
   *is* the message the agent is replying to — which is also how humans use
   tapbacks 95% of the time. No target parameter in v1.
2. **One reaction per sender, mirroring the user side.** The tool replaces any
   existing `from: "them"` reaction and preserves the user's `from: "me"` one —
   the exact mirror of `chat.react`'s toggle logic. No removal path for the
   agent (it never needs to un-react).
3. **Tapback-only replies are a feature.** The model may call the tool and emit
   no text. `persistTurn` already tolerates empty `fullText`; `repliesEligible`
   already skips chips for empty text. Only the client transcript filter needs
   to learn to drop text-less, attachment-less assistant rows (strict
   improvement: device-tool-only rows can already produce empty bubbles today).
4. **Context on tapbacks via transcript annotations, not ids.** Render
   reactions as a bracketed note appended to the carrying message in the model
   view: `[user reacted ❤️]` on assistant rows (from `"me"` = the human),
   `[you reacted 👍]` on user rows (from `"them"` = the sidekick). This also
   gives the agent memory of its *own* past reactions — important because
   server-tool calls that resolve in-turn are dropped from the tail view
   (`assembleTail`'s `resolvedCallIds` check), so the react tool-call itself
   vanishes from later views.
5. **Zero persona changes.** All steering lives in a new capability
   `promptGuidance` block — the seam built for exactly this (`Capability` in
   `tools/types.ts`). No `PERSONA_PROMPT` edit, no persona version bump. (The
   new guidance block itself invalidates cache breakpoint A once on deploy —
   unavoidable and normal for any capability launch.)

## Implementation

### 1. New capability: `packages/shared/app/src/tools/reactions.ts`

```ts
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { messages } from "@sidekick/db";
import { reactionTypeSchema } from "../schemas";
import { defineTool, type SidekickTool } from "./types";

export const reactionsTools: SidekickTool[] = [
  defineTool({
    name: "react_to_message",
    description:
      'Put a tapback reaction on the user\'s latest message, like iMessage. ' +
      'Types: "heart", "thumbsUp", "thumbsDown", "haha", "exclamation", ' +
      '"question", or any emoji as "emoji:🔥".',
    execution: "server",
    parameters: z.object({ type: reactionTypeSchema }),
    execute: async ({ type }, { db, conversationId }) => {
      const rows = await db
        .select({ id: messages.id, reactions: messages.reactions })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")))
        .orderBy(desc(messages.id))
        .limit(1);
      const target = rows[0];
      if (!target) {
        return { ok: false, reason: "no user message to react to" };
      }
      const kept = target.reactions.filter((r) => r.from !== "them");
      await db
        .update(messages)
        .set({ reactions: [...kept, { type, from: "them" }] })
        .where(eq(messages.id, target.id));
      return { ok: true };
    },
  }),
];
```

Notes:
- Reuses `reactionTypeSchema` verbatim — the tool accepts exactly what the DB
  and UI accept, custom emoji included.
- `defineTool` revalidates input at the boundary; no new validation code.
- Check the `@sidekick/db` import direction: other tool files (`checkins.ts`,
  `reminders.ts`) already query the DB from this package — follow whichever
  import style they use.

### 2. Register it: `packages/shared/app/src/tools/index.ts`

```ts
{ name: "reactions", tools: reactionsTools, promptGuidance: REACTION_CHAT_GUIDANCE },
```

Placement in the `capabilities` array is the guidance's position in the system
prompt (registry order). Put it after `memory` — it's core-persona-adjacent,
not a life-integration. Feature-flaggable for free via `SIDEKICK_DISABLED_TOOLS=react_to_message`
(drops the tool *and* the guidance block, per `selectGuidance`).

Onboarding conversations are untouched — they run the restricted onboarding
tool set and never see this.

### 3. Prompt guidance (the "minimal prompt change")

Lives with the capability (in `reactions.ts`, like `FOCUS_CHAT_GUIDANCE` lives
in `focus.ts`). Draft, matching persona voice:

```ts
export const REACTION_CHAT_GUIDANCE = `tapbacks (message reactions):
you can react to the user's latest message with react_to_message, exactly like
iMessage tapbacks: heart, thumbsUp, thumbsDown, haha, exclamation, question, or
any emoji via "emoji:🔥".
react like a real friend texting:
- big win or sweet moment → heart. genuinely funny → haha. hype → "emoji:🔥".
- a reaction can BE the whole reply. for a quick "done!" or a photo that speaks
  for itself, react and send nothing, or react plus one short line.
- react when it genuinely lands, not on every message — tapbacks feel special
  because they're occasional.
- never react and then also gush about the same thing in text. pick one.
- bracketed transcript notes like [user reacted ❤️] mean the user tapbacked
  that message. let it land (a "haha glad that hit" is fine), don't make it a
  whole thing. never type those bracket markers yourself.`;
```

Why this is sufficient as the *entire* prompt change:
- The persona already says "occasional emoji is fine" and "text like a close
  friend" — the guidance only adds the mechanism and restraint rules.
- The two failure modes to steer against are (a) over-reacting on every message
  and (b) double-dipping (react + gushing text about the same thing). Both are
  addressed with one line each.
- The marker-explanation line is what "gives the agent context on tapbacks" for
  the *user's* reactions, and the "never type those markers" line prevents the
  one mimicry risk the annotations introduce.
- Keep it static (no time/user content) — it sits in the cacheable region A.

### 4. Reactions in the model view (agent context on tapbacks)

`packages/shared/app/src/conversation.ts`:
- Add `reactions: messages.reactions` to the `tailMessages` select and
  `reactions: Reaction[]` to `TailMessage`.

`packages/shared/app/src/context.ts` (`assembleTail`):
- Add a small helper mapping `ReactionType` → glyph (`heart`→❤️, `thumbsUp`→👍,
  `thumbsDown`→👎, `haha`→😂, `exclamation`→‼️, `question`→❓,
  `emoji:X`→`X`) and rendering a note per reaction:
  - `from: "me"` → `[user reacted ❤️]`
  - `from: "them"` → `[you reacted 👍]`
- Append as a final line to the message's text content: user rows get it as a
  trailing text part in `userContent` (after attachments), assistant rows get
  it appended to `content` before the tool-call branch.

Cache note: a reaction on an older tail row shifts the message-prefix cache
from that row onward for the *next* turn. Reactions land on recent messages
almost always, so the invalidated suffix is shallow — accepted, same class of
churn as an edited tail.

Token note: annotations aren't counted in `tokenEstimate` — a dozen chars per
reacted message, noise relative to the ~4-chars/token estimate.

### 5. Tapback-only turns: drop empty assistant bubbles

`packages/expo/src/imessage/server.ts` `fetchTranscript`:

```ts
const visibleRows = rows.filter(
  (row) =>
    (row.role === "user" || row.role === "assistant") &&
    row.adUnitId === null &&
    (row.content.trim().length > 0 || row.attachments.length > 0),
);
```

- Voice-note user rows (empty text + audio attachment) survive via the
  attachment check.
- Also fixes today's latent empty-bubble case (assistant row that only carried
  device-tool calls).
- UX flow needs no other work: the typing indicator shows while the turn runs,
  `onSettled` invalidates the transcript, and the reaction appears on the
  user's bubble (the persisted row — the optimistic local bubble is replaced by
  then). Reaction render is `TapbackBadge`, already sender-aware.

### 6. No server/router changes

`chat.react` already preserves `from: "them"` when the user toggles their own
reaction — verified in the mutation body. `persistTurn` already records the
react tool-call on the assistant row (`toolCalls` jsonb) for observability.

## Tests

Follow the existing real-pg pattern in `tests/chat-message-features.test.ts`
(no mocks):

1. **Tool execute** (direct call with a real `ToolContext`): reacts to the
   latest user message with `from: "them"`; replaces a prior `"them"` reaction;
   preserves the user's `"me"` reaction; returns `ok: false` when the
   conversation has no user message; rejects an invalid type (zod boundary).
2. **`chat.react` coexistence**: extend the existing react test — seed a
   `from: "them"` reaction, toggle the user's own, assert the sidekick's
   survives.
3. **`assembleTail` annotations**: a reacted user row renders `[you reacted …]`
   as its last content line; a reacted assistant row renders `[user reacted …]`;
   `emoji:🔥` renders the raw emoji; un-reacted messages render byte-identical
   to today (cache safety).
4. **Manual** (per the usual iOS-sim + real backend loop): send something
   heart-worthy ("just ran my first 5k!!") and confirm a tapback lands on the
   bubble; confirm a tapback-only reply shows no empty bubble; long-press the
   same bubble and confirm user + sidekick reactions coexist on opposite
   corners.

## Out of scope / later

- Reacting to older messages (would need id plumbing or quote-matching in the
  tool — wait for a real need).
- The user's tapback *triggering* a sidekick turn (today the agent only learns
  about it on the next turn; iMessage semantics — a reaction isn't a message —
  so this matches).
- Streaming the reaction to the client mid-turn (a stream frame like the
  search captions) so it lands before the reply text. Pure polish; the
  post-turn invalidation already shows it within the same beat.
