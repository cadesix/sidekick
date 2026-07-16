import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { attachments } from "@sidekick/db";
import { defineTool, type SidekickTool } from "./types";

/**
 * Chat-side guidance for multimodal messages (09 §what the LLM sees). Static,
 * so it rides inside the cacheable persona region. Tells the model how the view
 * rules shape what it can see and when to reach for `read_attachment`.
 */
export const ATTACHMENT_CHAT_GUIDANCE = `Attachments:
- Users send photos, voice notes, and files. You see the 3 most recent photos directly; older ones appear as [photo: caption]. Voice notes arrive as text prefixed [voice note]; treat them as the user's words. Files show their full text while recent, then collapse to [file: name — caption].
- When the user refers back to an older photo or file you can no longer see in full, call read_attachment(attachment_id) to pull its full text or transcript. Attachment ids for recent files are in the RECENT section of your context.
- React to what's actually in the attachment — never say "nice pic!" without having seen it.` as const;

/**
 * `read_attachment(attachment_id)` (09): re-pull the full extractedText/transcript
 * of any of this user's past attachments on demand — what makes swapping older
 * files out of the verbatim view for `[file: …]` safe.
 */
export const attachmentsTools: SidekickTool[] = [
  defineTool({
    name: "read_attachment",
    description:
      "Retrieve the full text or transcript of an attachment the user sent earlier (a file's extracted text or a voice note's transcript). Use when the user refers back to something no longer shown in full in the conversation.",
    execution: "server",
    parameters: z.object({
      attachment_id: z.string().describe("Attachment id from the RECENT section or an earlier [file: …] reference"),
    }),
    execute: async ({ attachment_id }, { db, userId }) => {
      const rows = await db
        .select({
          kind: attachments.kind,
          status: attachments.status,
          caption: attachments.caption,
          transcript: attachments.transcript,
          extractedText: attachments.extractedText,
          storageKey: attachments.storageKey,
        })
        .from(attachments)
        .where(and(eq(attachments.id, attachment_id), eq(attachments.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return { ok: false, error: "no such attachment" };
      }
      if (row.status !== "ready") {
        return { ok: false, error: `attachment is ${row.status}` };
      }
      const content = row.transcript ?? row.extractedText;
      if (content === null) {
        return { ok: true, kind: row.kind, caption: row.caption, content: null };
      }
      return { ok: true, kind: row.kind, caption: row.caption, content };
    },
  }),
];
