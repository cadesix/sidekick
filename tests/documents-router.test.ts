import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, documents, documentVersions } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { makeCaller, textModel, createUser, createUserSession } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function caller(userId: string) {
  return makeCaller(db, textModel("ok"), userId);
}

async function seedDoc(
  userId: string,
  input: { title: string; content: string; folderId?: string | null; updatedAt?: Date },
): Promise<string> {
  const inserted = await db
    .insert(documents)
    .values({
      userId,
      title: input.title,
      content: input.content,
      folderId: input.folderId ?? null,
      lastEditedBy: "sidekick",
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    })
    .returning({ id: documents.id });
  return inserted[0]!.id;
}

test("list returns folders and active documents, folded by updatedAt desc", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const folder = await c.documents.createFolder({ name: "Plans" });
  await seedDoc(userId, {
    title: "Older",
    content: "a",
    folderId: folder.id,
    updatedAt: new Date("2026-07-01T10:00:00Z"),
  });
  await seedDoc(userId, {
    title: "Newer",
    content: "b",
    updatedAt: new Date("2026-07-05T10:00:00Z"),
  });

  const home = await c.documents.list();
  expect(home.folders.map((f) => f.name)).toEqual(["Plans"]);
  expect(home.documents.map((d) => d.title)).toEqual(["Newer", "Older"]);
});

test("edit versions the write and records the user as the author", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const docId = await seedDoc(userId, { title: "Draft", content: "one" });

  const edited = await c.documents.edit({ id: docId, content: "two" });
  expect(edited.content).toBe("two");

  const docRows = await db.select().from(documents).where(eq(documents.id, docId));
  expect(docRows[0]?.lastEditedBy).toBe("user");

  const versions = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, docId));
  expect(versions).toHaveLength(1);
  expect(versions[0]?.editedBy).toBe("user");
});

test("delete is soft and removes the document from the list", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const docId = await seedDoc(userId, { title: "Trash", content: "x" });

  await c.documents.delete({ id: docId });

  const docRows = await db.select().from(documents).where(eq(documents.id, docId));
  expect(docRows[0]?.status).toBe("deleted");

  const home = await c.documents.list();
  expect(home.documents).toHaveLength(0);
});

test("move files a document into a folder and rejects a stranger's folder", async () => {
  const owner = await createUserSession(db);
  const stranger = await createUserSession(db);
  const oc = caller(owner.userId);
  const folder = await oc.documents.createFolder({ name: "Keep" });
  const docId = await seedDoc(owner.userId, { title: "Movable", content: "x" });

  await oc.documents.move({ id: docId, folderId: folder.id });
  const docRows = await db.select().from(documents).where(eq(documents.id, docId));
  expect(docRows[0]?.folderId).toBe(folder.id);

  await expect(
    caller(stranger.userId).documents.move({ id: docId, folderId: folder.id }),
  ).rejects.toThrow();
});

test("versions + restore create a new version without destroying anything", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const docId = await seedDoc(userId, { title: "Recipe", content: "v1" });

  await c.documents.edit({ id: docId, content: "v2" });
  await c.documents.edit({ id: docId, content: "v3" });

  const versions = await c.documents.versions({ documentId: docId });
  expect(versions.map((v) => v.content)).toEqual(["v3", "v2"]);

  const oldest = versions[versions.length - 1]!;
  const restored = await c.documents.restore({ versionId: oldest.id });
  expect(restored.content).toBe(oldest.content);

  const after = await c.documents.versions({ documentId: docId });
  expect(after).toHaveLength(3);
  expect(after[0]?.content).toBe(oldest.content);
});

test("renameFolder and reorderFolders update folder metadata", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const a = await c.documents.createFolder({ name: "First" });
  const b = await c.documents.createFolder({ name: "Second" });

  await c.documents.renameFolder({ id: a.id, name: "Renamed", emoji: "\u{1F525}" });
  await c.documents.reorderFolders({ orderedIds: [b.id, a.id] });

  const home = await c.documents.list();
  expect(home.folders.map((f) => f.name)).toEqual(["Second", "Renamed"]);
  expect(home.folders.find((f) => f.id === a.id)?.emoji).toBe("\u{1F525}");
});
