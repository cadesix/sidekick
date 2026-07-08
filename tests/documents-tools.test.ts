import { afterAll, beforeAll, expect, test } from "vitest";
import { desc, eq } from "drizzle-orm";
import { type Database, documents, documentVersions, folders } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { allTools, dispatchTool, type SidekickTool, type ToolContext } from "@sidekick/shared";
import { registerDevice } from "@sidekick/server";
import { createConversation } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function tool(name: string): SidekickTool {
  const found = allTools.find((t) => t.name === name);
  if (!found) {
    throw new Error(`missing tool ${name}`);
  }
  return found;
}

async function ctxFor(deviceId: string): Promise<{ ctx: ToolContext; userId: string }> {
  const { userId } = await registerDevice(db, { deviceId });
  const conversationId = await createConversation(db, userId);
  return { ctx: { db, userId, conversationId }, userId };
}

function unwrap(result: { status: string; result?: unknown }): Record<string, unknown> {
  expect(result.status).toBe("done");
  return result.result as Record<string, unknown>;
}

async function versionCount(documentId: string): Promise<number> {
  const rows = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  return rows.length;
}

test("create_document persists the doc, an initial version, and a new folder", async () => {
  const { ctx, userId } = await ctxFor("docs-tool-create");

  const created = unwrap(
    await dispatchTool(
      tool("create_document"),
      { title: "Half-marathon plan", content_markdown: "# Week 1\neasy base", folder: "Fitness" },
      ctx,
    ),
  );
  expect(created.ok).toBe(true);
  expect(created.title).toBe("Half-marathon plan");
  expect(created.folder).toBe("Fitness");
  const documentId = created.document_id as string;

  const docRows = await db.select().from(documents).where(eq(documents.id, documentId));
  expect(docRows[0]?.content).toBe("# Week 1\neasy base");
  expect(docRows[0]?.lastEditedBy).toBe("sidekick");
  expect(docRows[0]?.status).toBe("active");

  expect(await versionCount(documentId)).toBe(1);

  const folderRows = await db.select().from(folders).where(eq(folders.userId, userId));
  expect(folderRows).toHaveLength(1);
  expect(folderRows[0]?.name).toBe("Fitness");
  expect(folderRows[0]?.emoji).not.toBeNull();
});

test("create_document reuses an existing folder case-insensitively", async () => {
  const { ctx, userId } = await ctxFor("docs-tool-folder-reuse");
  await dispatchTool(
    tool("create_document"),
    { title: "A", content_markdown: "a", folder: "Recipes" },
    ctx,
  );
  await dispatchTool(
    tool("create_document"),
    { title: "B", content_markdown: "b", folder: "recipes" },
    ctx,
  );
  const folderRows = await db.select().from(folders).where(eq(folders.userId, userId));
  expect(folderRows).toHaveLength(1);
});

test("update_document fully replaces content and appends a version", async () => {
  const { ctx } = await ctxFor("docs-tool-update");
  const created = unwrap(
    await dispatchTool(
      tool("create_document"),
      { title: "Packing list", content_markdown: "socks\nshirts" },
      ctx,
    ),
  );
  const documentId = created.document_id as string;

  const updated = unwrap(
    await dispatchTool(
      tool("update_document"),
      { document_id: documentId, content_markdown: "totally new body" },
      ctx,
    ),
  );
  expect(updated.ok).toBe(true);
  expect(updated.title).toBe("Packing list");

  const docRows = await db.select().from(documents).where(eq(documents.id, documentId));
  expect(docRows[0]?.content).toBe("totally new body");
  expect(await versionCount(documentId)).toBe(2);

  const withTitle = unwrap(
    await dispatchTool(
      tool("update_document"),
      { document_id: documentId, title: "Trip packing", content_markdown: "final" },
      ctx,
    ),
  );
  expect(withTitle.title).toBe("Trip packing");
  expect(await versionCount(documentId)).toBe(3);

  const versions = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.seq));
  expect(versions[0]?.content).toBe("final");
});

test("update_document rejects a document that isn't the caller's", async () => {
  const owner = await ctxFor("docs-tool-owner");
  const stranger = await ctxFor("docs-tool-stranger");
  const created = unwrap(
    await dispatchTool(
      tool("create_document"),
      { title: "Private", content_markdown: "secret" },
      owner.ctx,
    ),
  );
  const documentId = created.document_id as string;

  const result = unwrap(
    await dispatchTool(
      tool("update_document"),
      { document_id: documentId, content_markdown: "hacked" },
      stranger.ctx,
    ),
  );
  expect(result).toEqual({ ok: false, error: "document not found" });

  const docRows = await db.select().from(documents).where(eq(documents.id, documentId));
  expect(docRows[0]?.content).toBe("secret");
});

test("get_document returns current content, list_documents filters by folder", async () => {
  const { ctx } = await ctxFor("docs-tool-getlist");
  const a = unwrap(
    await dispatchTool(
      tool("create_document"),
      { title: "Filed", content_markdown: "in a folder", folder: "Work" },
      ctx,
    ),
  );
  await dispatchTool(
    tool("create_document"),
    { title: "Loose", content_markdown: "unfiled" },
    ctx,
  );

  const got = unwrap(
    await dispatchTool(tool("get_document"), { document_id: a.document_id }, ctx),
  );
  expect(got.content).toBe("in a folder");
  expect(got.folder).toBe("Work");

  const all = unwrap(await dispatchTool(tool("list_documents"), {}, ctx));
  expect((all.documents as unknown[]).length).toBe(2);

  const filtered = unwrap(
    await dispatchTool(tool("list_documents"), { folder: "Work" }, ctx),
  );
  const titles = (filtered.documents as { title: string }[]).map((d) => d.title);
  expect(titles).toEqual(["Filed"]);
});

test("move_document files a document into a folder (created on demand)", async () => {
  const { ctx, userId } = await ctxFor("docs-tool-move");
  const created = unwrap(
    await dispatchTool(
      tool("create_document"),
      { title: "Drifter", content_markdown: "x" },
      ctx,
    ),
  );
  const documentId = created.document_id as string;

  const moved = unwrap(
    await dispatchTool(
      tool("move_document"),
      { document_id: documentId, folder: "Archive" },
      ctx,
    ),
  );
  expect(moved.ok).toBe(true);

  const folderRows = await db.select().from(folders).where(eq(folders.userId, userId));
  const archive = folderRows.find((f) => f.name === "Archive");
  const docRows = await db.select().from(documents).where(eq(documents.id, documentId));
  expect(docRows[0]?.folderId).toBe(archive?.id);
});
