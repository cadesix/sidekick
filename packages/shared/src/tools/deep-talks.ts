import { z } from "zod";
import { messages } from "@sidekick/db";
import {
  DEEP_TALK_MARKER_ROLE,
  activeDeepTalk,
  encodeDeepTalkMarker,
} from "../deep-talks";
import { defineTool, type SidekickTool } from "./types";

/**
 * Chat-side guidance for deep talks. The per-session beats + the instruction to
 * call `complete_deep_talk` are injected dynamically by `buildContextView` when a
 * session is active; this static block only exists so the model knows what the
 * tool is when it appears. Kept tiny and per-day-stable (cache-safe).
 */
export const DEEP_TALK_CHAT_GUIDANCE = `DEEP TALKS: sometimes a guided session is active — you'll see an "ACTIVE DEEP TALK"
block with beats to work through like a friend, one at a time. Only call
complete_deep_talk when that block is present and the beats are covered or the
user has clearly disengaged. Never mention deep talks when no session is active.`;

/**
 * deep-talks capability tools (14). `complete_deep_talk` is always registered but
 * only meaningful inside an active session: it writes a completion marker that
 * clears the session, and the chat router picks the completion up to run the
 * immediate extraction + score recompute + reward grant out of band (a tool has
 * no model in its context, so that work can't happen here).
 */
export const deepTalksTools: SidekickTool[] = [
  defineTool({
    name: "complete_deep_talk",
    description:
      "Finish the active deep talk once its beats are covered or the user has clearly disengaged. Pass the session's slug. Silent — don't announce it; just wrap the conversation up warmly.",
    execution: "server",
    parameters: z.object({
      slug: z.string().describe("The active deep talk's slug, from the ACTIVE DEEP TALK block"),
    }),
    execute: async ({ slug }, { db, conversationId }) => {
      const active = await activeDeepTalk(db, conversationId);
      if (!active || active.slug !== slug) {
        return { ok: false, note: "no active deep talk to complete" };
      }
      await db.insert(messages).values({
        conversationId,
        role: DEEP_TALK_MARKER_ROLE,
        content: encodeDeepTalkMarker({ phase: "complete", slug }),
        tokenEstimate: 0,
      });
      return { ok: true, slug };
    },
  }),
];
