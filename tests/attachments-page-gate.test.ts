import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, attachments } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { ingestAttachment } from "@sidekick/server";
import { pdfNativeEligible } from "@sidekick/shared";
import { generateModel, testStorage, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("ingest persists the PDF page count on the attachment", async () => {
  const userId = await createUser(db);
  const storage = testStorage();
  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL("./fixtures/sample.pdf", import.meta.url))),
  );
  const storageKey = `attachments/${userId}/file/sample.pdf`;
  await storage.putObject(storageKey, bytes, "application/pdf");
  const inserted = await db
    .insert(attachments)
    .values({
      userId,
      kind: "file",
      mime: "application/pdf",
      bytes: bytes.byteLength,
      storageKey,
      status: "processing",
    })
    .returning({ id: attachments.id });
  const id = inserted[0]!.id;

  await ingestAttachment({ db, storage, captionModel: generateModel("a short pdf") }, id);

  const row = (await db.select().from(attachments).where(eq(attachments.id, id)))[0];
  expect(row?.status).toBe("ready");
  expect(typeof row?.pages).toBe("number");
  expect((row?.pages ?? 0) > 0).toBe(true);
});

test("the native-document gate rejects PDFs over 100 pages, keeps ≤100 in range", () => {
  const base = { mime: "application/pdf", bytes: 1_000_000 };
  expect(pdfNativeEligible({ ...base, pages: 1 })).toBe(true);
  expect(pdfNativeEligible({ ...base, pages: 100 })).toBe(true);
  expect(pdfNativeEligible({ ...base, pages: 101 })).toBe(false);
  expect(pdfNativeEligible({ ...base, pages: 5000 })).toBe(false);
  // Unknown page count falls back to the byte cap governing.
  expect(pdfNativeEligible({ ...base, pages: null })).toBe(true);
  // Over the byte cap, or not a PDF, is never native-eligible.
  expect(pdfNativeEligible({ mime: "application/pdf", bytes: 40 * 1024 * 1024, pages: 3 })).toBe(false);
  expect(pdfNativeEligible({ mime: "text/plain", bytes: 10, pages: 1 })).toBe(false);
});
