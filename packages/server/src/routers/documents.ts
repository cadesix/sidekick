import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { folders } from "@sidekick/db";
import type { Database } from "@sidekick/db";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  listDocumentVersions,
  listFolders,
  restoreDocumentVersion,
  setDocumentFolder,
  updateDocument,
} from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";

async function assertFolderOwned(db: Database, folderId: string, userId: string): Promise<void> {
  const rows = await db
    .select({ userId: folders.userId })
    .from(folders)
    .where(eq(folders.id, folderId))
    .limit(1);
  if (!rows[0] || rows[0].userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "folder not found" });
  }
}

function notFound(message: string): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message });
}

/** The documents surface (15): folders + documents list, viewer/editor, versions. */
export const documentsRouter = router({
  /** Everything the documents home renders: the user's folders and active docs. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const [folderRows, docs] = await Promise.all([
      listFolders(ctx.db, ctx.userId),
      listDocuments(ctx.db, ctx.userId),
    ]);
    return {
      folders: folderRows.map((f) => ({ id: f.id, name: f.name, emoji: f.emoji })),
      documents: docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        folderId: doc.folderId,
        folderName: doc.folderName,
        folderEmoji: doc.folderEmoji,
        lastEditedBy: doc.lastEditedBy,
        updatedAt: doc.updatedAt,
      })),
    };
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await getDocument(ctx.db, ctx.userId, input.id);
      if (!doc) {
        throw notFound("document not found");
      }
      return {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        folderId: doc.folderId,
        folderName: doc.folderName,
        folderEmoji: doc.folderEmoji,
        lastEditedBy: doc.lastEditedBy,
        updatedAt: doc.updatedAt,
      };
    }),

  /** A user edit from the app's editor. Versioned, `lastEditedBy: user` (15). */
  edit: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        content: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await updateDocument(ctx.db, ctx.userId, {
        documentId: input.id,
        title: input.title,
        content: input.content,
        editedBy: "user",
      });
      if (!doc) {
        throw notFound("document not found");
      }
      return { id: doc.id, title: doc.title, content: doc.content, updatedAt: doc.updatedAt };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await deleteDocument(ctx.db, ctx.userId, input.id);
      if (!deleted) {
        throw notFound("document not found");
      }
      return { ok: true };
    }),

  move: protectedProcedure
    .input(z.object({ id: z.string().uuid(), folderId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (input.folderId) {
        await assertFolderOwned(ctx.db, input.folderId, ctx.userId);
      }
      const moved = await setDocumentFolder(ctx.db, ctx.userId, input.id, input.folderId);
      if (!moved) {
        throw notFound("document not found");
      }
      return { ok: true };
    }),

  versions: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await listDocumentVersions(ctx.db, ctx.userId, input.documentId);
      return rows.map((v) => ({
        id: v.id,
        title: v.title,
        content: v.content,
        editedBy: v.editedBy,
        createdAt: v.createdAt,
      }));
    }),

  restore: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await restoreDocumentVersion(ctx.db, ctx.userId, input.versionId, "user");
      if (!doc) {
        throw notFound("version not found");
      }
      return { id: doc.id, title: doc.title, content: doc.content, updatedAt: doc.updatedAt };
    }),

  createFolder: protectedProcedure
    .input(z.object({ name: z.string().min(1), emoji: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const nextPosition = await ctx.db
        .select({ max: sql<number>`coalesce(max(${folders.position}), -1) + 1` })
        .from(folders)
        .where(eq(folders.userId, ctx.userId));
      const inserted = await ctx.db
        .insert(folders)
        .values({
          userId: ctx.userId,
          name: input.name.trim(),
          emoji: input.emoji ?? null,
          position: nextPosition[0]?.max ?? 0,
        })
        .returning();
      const folder = inserted[0];
      if (!folder) {
        throw new Error("failed to create folder");
      }
      return { id: folder.id, name: folder.name, emoji: folder.emoji };
    }),

  renameFolder: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        emoji: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertFolderOwned(ctx.db, input.id, ctx.userId);
      const patch: { name?: string; emoji?: string } = {};
      if (input.name) {
        patch.name = input.name.trim();
      }
      if (input.emoji) {
        patch.emoji = input.emoji;
      }
      await ctx.db.update(folders).set(patch).where(eq(folders.id, input.id));
      return { ok: true };
    }),

  reorderFolders: protectedProcedure
    .input(z.object({ orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await Promise.all(
        input.orderedIds.map((id, position) =>
          ctx.db
            .update(folders)
            .set({ position })
            .where(and(eq(folders.id, id), eq(folders.userId, ctx.userId))),
        ),
      );
      return { ok: true };
    }),
});
