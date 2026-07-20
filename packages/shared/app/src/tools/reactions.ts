import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { messages } from "@sidekick/db";
import { reactionTypeSchema } from "../schemas";
import { defineTool, type SidekickTool } from "./types";

/**
 * Tapbacks: the sidekick reacting to the user's messages, iMessage-style. The
 * one server tool below targets the user's *latest* message — a turn always
 * persists the triggering user row before `driveTurn`, so "most recent
 * `role='user'` row in this conversation" is the message being replied to, which
 * is also how humans use tapbacks almost all of the time. No message-id
 * plumbing, no target parameter (see the agent-tapbacks plan §"Design
 * decisions").
 *
 * The write mirrors `chat.react`'s toggle exactly: it replaces any existing
 * `from: "them"` reaction (one per sender) and preserves the user's own
 * `from: "me"` one. There is no un-react path — the agent never needs one.
 */
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

/**
 * Chat-side steer for the tapback tool — the capability's `promptGuidance`,
 * appended to the system prompt whenever `react_to_message` is enabled. It adds
 * only the mechanism and the restraint rules; the persona already covers "text
 * like a close friend" and "occasional emoji is fine". The bracketed-note
 * explanation is what gives the agent context on the *user's* tapbacks (rendered
 * into the model view by `assembleTail`), and the "never type those markers"
 * line prevents the one mimicry risk those annotations introduce. Keep it static
 * (no clock time, no user content) — it lives in the cacheable prompt region.
 */
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
  whole thing. never type those bracket markers yourself.` as const;
