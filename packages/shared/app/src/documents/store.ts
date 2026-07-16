import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import {
  type Database,
  documents,
  documentVersions,
  folders,
} from "@sidekick/db";

/**
 * Who committed a document write. Both authors write through the same path, and
 * every write appends a `documentVersions` row (never pruned) so the history
 * powers undo and the "what did my sidekick change?" trust affordance (15).
 */
export type DocumentAuthor = "sidekick" | "user";

export type DocumentRow = typeof documents.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;

/** A document plus its resolved folder name/emoji, the shape both UI and tools want. */
export type DocumentWithFolder = DocumentRow & {
  folderName: string | null;
  folderEmoji: string | null;
};

async function loadOwnedDocument(
  db: Database,
  userId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  const doc = rows[0];
  if (!doc || doc.status !== "active") {
    return null;
  }
  return doc;
}

async function loadFolder(
  db: Database,
  folderId: string | null,
): Promise<FolderRow | null> {
  if (!folderId) {
    return null;
  }
  const rows = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  return rows[0] ?? null;
}

function withFolder(doc: DocumentRow, folder: FolderRow | null): DocumentWithFolder {
  return { ...doc, folderName: folder?.name ?? null, folderEmoji: folder?.emoji ?? null };
}

/** Append the committed state of a document as an immutable version row. */
export async function appendDocumentVersion(
  db: Database,
  input: { documentId: string; content: string; title: string; editedBy: DocumentAuthor },
): Promise<void> {
  await db.insert(documentVersions).values({
    documentId: input.documentId,
    content: input.content,
    title: input.title,
    editedBy: input.editedBy,
  });
}

/** A neutral default emoji for sidekick-created folders; the user can rename it. */
const DEFAULT_FOLDER_EMOJI = "\u{1F4C1}";

/**
 * Find a user's folder by name (case-insensitive), creating it — appended after
 * the last one — when it doesn't exist. Blank names resolve to "unfiled" (null).
 */
export async function resolveFolderId(
  db: Database,
  userId: string,
  name: string | null | undefined,
): Promise<string | null> {
  const trimmed = name?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const existing = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.userId, userId), ilike(folders.name, trimmed)))
    .limit(1);
  if (existing[0]) {
    return existing[0].id;
  }
  const nextPosition = await db
    .select({ max: sql<number>`coalesce(max(${folders.position}), -1) + 1` })
    .from(folders)
    .where(eq(folders.userId, userId));
  const inserted = await db
    .insert(folders)
    .values({ userId, name: trimmed, emoji: DEFAULT_FOLDER_EMOJI, position: nextPosition[0]?.max ?? 0 })
    .returning({ id: folders.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to create folder");
  }
  return row.id;
}

export async function createDocument(
  db: Database,
  userId: string,
  input: { title: string; content: string; folder?: string | null; editedBy: DocumentAuthor },
): Promise<DocumentWithFolder> {
  const folderId = await resolveFolderId(db, userId, input.folder);
  const inserted = await db
    .insert(documents)
    .values({
      userId,
      folderId,
      title: input.title,
      content: input.content,
      lastEditedBy: input.editedBy,
    })
    .returning();
  const doc = inserted[0];
  if (!doc) {
    throw new Error("failed to create document");
  }
  await appendDocumentVersion(db, {
    documentId: doc.id,
    content: doc.content,
    title: doc.title,
    editedBy: input.editedBy,
  });
  return withFolder(doc, await loadFolder(db, folderId));
}

/**
 * Full-content replacement (15: the model re-emits the whole doc, never a diff).
 * Returns `null` when the document isn't the user's active document.
 */
export async function updateDocument(
  db: Database,
  userId: string,
  input: { documentId: string; title?: string | null; content: string; editedBy: DocumentAuthor },
): Promise<DocumentWithFolder | null> {
  const current = await loadOwnedDocument(db, userId, input.documentId);
  if (!current) {
    return null;
  }
  const title = input.title?.trim() ? input.title.trim() : current.title;
  const updated = await db
    .update(documents)
    .set({ title, content: input.content, lastEditedBy: input.editedBy, updatedAt: new Date() })
    .where(eq(documents.id, current.id))
    .returning();
  const doc = updated[0];
  if (!doc) {
    throw new Error("failed to update document");
  }
  await appendDocumentVersion(db, {
    documentId: doc.id,
    content: doc.content,
    title: doc.title,
    editedBy: input.editedBy,
  });
  return withFolder(doc, await loadFolder(db, doc.folderId));
}

export async function getDocument(
  db: Database,
  userId: string,
  documentId: string,
): Promise<DocumentWithFolder | null> {
  const doc = await loadOwnedDocument(db, userId, documentId);
  if (!doc) {
    return null;
  }
  return withFolder(doc, await loadFolder(db, doc.folderId));
}

/** A user's active documents, newest-touched first, optionally within one folder. */
export async function listDocuments(
  db: Database,
  userId: string,
  folderName?: string | null,
): Promise<DocumentWithFolder[]> {
  const rows = await db
    .select({ doc: documents, folder: folders })
    .from(documents)
    .leftJoin(folders, eq(documents.folderId, folders.id))
    .where(and(eq(documents.userId, userId), eq(documents.status, "active")))
    .orderBy(desc(documents.updatedAt));
  const wanted = folderName?.trim().toLowerCase();
  return rows
    .filter((r) => (wanted ? r.folder?.name.toLowerCase() === wanted : true))
    .map((r) => withFolder(r.doc, r.folder));
}

/** Point a document at a folder (or `null` to unfile it). Returns false if not owned. */
export async function setDocumentFolder(
  db: Database,
  userId: string,
  documentId: string,
  folderId: string | null,
): Promise<boolean> {
  const doc = await loadOwnedDocument(db, userId, documentId);
  if (!doc) {
    return false;
  }
  await db
    .update(documents)
    .set({ folderId, updatedAt: new Date() })
    .where(eq(documents.id, doc.id));
  return true;
}

/** Soft-delete (15 data model: status active|deleted). Versions are untouched. */
export async function deleteDocument(
  db: Database,
  userId: string,
  documentId: string,
): Promise<boolean> {
  const doc = await loadOwnedDocument(db, userId, documentId);
  if (!doc) {
    return false;
  }
  await db
    .update(documents)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(documents.id, doc.id));
  return true;
}

export async function listFolders(db: Database, userId: string): Promise<FolderRow[]> {
  return db
    .select()
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(asc(folders.position), asc(folders.createdAt));
}

export async function listDocumentVersions(
  db: Database,
  userId: string,
  documentId: string,
): Promise<DocumentVersionRow[]> {
  const doc = await loadOwnedDocument(db, userId, documentId);
  if (!doc) {
    return [];
  }
  return db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.seq));
}

/**
 * Restore an old version by committing its content as a new write — nothing is
 * destroyed, the restore is itself the newest version (15).
 */
export async function restoreDocumentVersion(
  db: Database,
  userId: string,
  versionId: string,
  editedBy: DocumentAuthor,
): Promise<DocumentWithFolder | null> {
  const rows = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
    .limit(1);
  const version = rows[0];
  if (!version) {
    return null;
  }
  return updateDocument(db, userId, {
    documentId: version.documentId,
    title: version.title,
    content: version.content,
    editedBy,
  });
}
