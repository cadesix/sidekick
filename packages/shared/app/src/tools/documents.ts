import { z } from "zod";
import {
  createDocument,
  getDocument,
  listDocuments,
  resolveFolderId,
  setDocumentFolder,
  updateDocument,
} from "../documents/store";
import { defineTool, type SidekickTool } from "./types";

/**
 * documents capability tools (15). The sidekick makes things worth keeping —
 * plans, lists, drafts — that persist as markdown documents. Every write goes
 * through the shared store, which appends an immutable version row.
 */
export const documentsTools: SidekickTool[] = [
  defineTool({
    name: "create_document",
    description:
      "Create a document when you've made something worth keeping — a plan, list, draft, or guide. Use it instead of dumping long structured content into the chat bubble: reply with a short in-voice intro and let the document card carry the content. Title: 2-5 words, sentence case.",
    execution: "server",
    parameters: z.object({
      title: z.string().min(1),
      content_markdown: z.string().min(1),
      folder: z
        .string()
        .optional()
        .describe("Folder name; created (with a fitting emoji) if it doesn't exist. Omit for unfiled."),
    }),
    execute: async ({ title, content_markdown, folder }, { db, userId }) => {
      const doc = await createDocument(db, userId, {
        title,
        content: content_markdown,
        folder,
        editedBy: "sidekick",
      });
      return { ok: true, document_id: doc.id, title: doc.title, folder: doc.folderName };
    },
  }),

  defineTool({
    name: "update_document",
    description:
      "Rewrite a document you already made. Re-emit the FULL new content (this replaces the document, it is not a patch). After updating, say what changed in one casual line — silent edits to a user's stuff feel spooky.",
    execution: "server",
    parameters: z.object({
      document_id: z.string(),
      title: z.string().optional(),
      content_markdown: z.string().min(1).describe("The complete new document body; fully replaces the old one."),
    }),
    execute: async ({ document_id, title, content_markdown }, { db, userId }) => {
      const doc = await updateDocument(db, userId, {
        documentId: document_id,
        title,
        content: content_markdown,
        editedBy: "sidekick",
      });
      if (!doc) {
        return { ok: false, error: "document not found" };
      }
      return { ok: true, document_id: doc.id, title: doc.title };
    },
  }),

  defineTool({
    name: "get_document",
    description:
      "Read back the full current content of a document you or the user made — use before updating it, or when the user asks about what's in it.",
    execution: "server",
    parameters: z.object({ document_id: z.string() }),
    execute: async ({ document_id }, { db, userId }) => {
      const doc = await getDocument(db, userId, document_id);
      if (!doc) {
        return { ok: false, error: "document not found" };
      }
      return {
        ok: true,
        document_id: doc.id,
        title: doc.title,
        content: doc.content,
        folder: doc.folderName,
      };
    },
  }),

  defineTool({
    name: "list_documents",
    description: "List the user's documents (titles + ids), optionally within one folder.",
    execution: "server",
    parameters: z.object({
      folder: z.string().optional().describe("Folder name to filter by; omit for all documents."),
    }),
    execute: async ({ folder }, { db, userId }) => {
      const docs = await listDocuments(db, userId, folder);
      return {
        ok: true,
        documents: docs.map((doc) => ({
          document_id: doc.id,
          title: doc.title,
          folder: doc.folderName,
        })),
      };
    },
  }),

  defineTool({
    name: "move_document",
    description: "Move a document into a folder (created if it doesn't exist).",
    execution: "server",
    parameters: z.object({
      document_id: z.string(),
      folder: z.string().describe("Destination folder name."),
    }),
    execute: async ({ document_id, folder }, { db, userId }) => {
      const folderId = await resolveFolderId(db, userId, folder);
      const moved = await setDocumentFolder(db, userId, document_id, folderId);
      if (!moved) {
        return { ok: false, error: "document not found" };
      }
      return { ok: true, document_id, folder };
    },
  }),
];
