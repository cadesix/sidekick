import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, attachments } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { ingestAttachment } from "@sidekick/server";
import { generateModel, testStorage, transcriptionModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
}

async function seedAttachment(
  userId: string,
  storage: { putObject: (k: string, d: Uint8Array, m: string) => Promise<void> },
  input: { kind: string; mime: string; storageKey: string; bytes: Uint8Array },
): Promise<string> {
  await storage.putObject(input.storageKey, input.bytes, input.mime);
  const inserted = await db
    .insert(attachments)
    .values({
      userId,
      kind: input.kind,
      mime: input.mime,
      bytes: input.bytes.byteLength,
      storageKey: input.storageKey,
      status: "processing",
    })
    .returning({ id: attachments.id });
  const id = inserted[0]?.id;
  if (!id) {
    throw new Error("seed failed");
  }
  return id;
}

async function statusOf(id: string) {
  const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return rows[0];
}

test("image ingest writes a vision caption and lands ready", async () => {
  const userId = await createUser(db);
  const storage = testStorage();
  const id = await seedAttachment(userId, storage, {
    kind: "image",
    mime: "image/jpeg",
    storageKey: `attachments/${userId}/img/photo.jpg`,
    bytes: fixture("sample.csv"),
  });

  await ingestAttachment(
    { db, storage, captionModel: generateModel("a golden retriever puppy on a beach") },
    id,
  );

  const row = await statusOf(id);
  expect(row?.status).toBe("ready");
  expect(row?.caption).toBe("a golden retriever puppy on a beach");
});

test("audio ingest transcribes to a transcript and lands ready", async () => {
  const userId = await createUser(db);
  const storage = testStorage();
  const id = await seedAttachment(userId, storage, {
    kind: "audio",
    mime: "audio/m4a",
    storageKey: `attachments/${userId}/aud/voice.m4a`,
    bytes: new Uint8Array([1, 2, 3, 4]),
  });

  await ingestAttachment(
    {
      db,
      storage,
      captionModel: generateModel("unused"),
      transcriptionModel: transcriptionModel("hey are we still on for saturday"),
    },
    id,
  );

  const row = await statusOf(id);
  expect(row?.status).toBe("ready");
  expect(row?.transcript).toBe("hey are we still on for saturday");
});

test("file ingest extracts real text from each fixture and summarizes it", async () => {
  const userId = await createUser(db);
  const storage = testStorage();
  const cases = [
    { name: "sample.csv", mime: "text/csv", contains: "designer" },
    { name: "sample.pdf", mime: "application/pdf", contains: "revenue up 12 percent" },
    {
      name: "sample.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contains: "parking spot 12",
    },
    {
      name: "sample.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contains: "apples",
    },
  ];

  for (const c of cases) {
    const id = await seedAttachment(userId, storage, {
      kind: "file",
      mime: c.mime,
      storageKey: `attachments/${userId}/file/${c.name}`,
      bytes: fixture(c.name),
    });
    await ingestAttachment({ db, storage, captionModel: generateModel("a short summary") }, id);
    const row = await statusOf(id);
    expect(row?.status, c.name).toBe("ready");
    expect(row?.extractedText ?? "", c.name).toContain(c.contains);
    expect(row?.caption, c.name).toBe("a short summary");
  }
});

test("audio ingest with no transcription model fails and marks the row failed", async () => {
  const userId = await createUser(db);
  const storage = testStorage();
  const id = await seedAttachment(userId, storage, {
    kind: "audio",
    mime: "audio/m4a",
    storageKey: `attachments/${userId}/fail/voice.m4a`,
    bytes: new Uint8Array([1, 2, 3]),
  });

  await expect(
    ingestAttachment({ db, storage, captionModel: generateModel("unused") }, id),
  ).rejects.toThrow();

  const row = await statusOf(id);
  expect(row?.status).toBe("failed");
});
