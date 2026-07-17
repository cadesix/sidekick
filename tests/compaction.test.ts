import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import {
  type Database,
  conversationSummaries,
  conversations,
  messages,
  users,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { type TailMessage, buildContextView } from "@sidekick/shared";
import { applyCompaction, runCompaction, selectBoundary } from "@sidekick/server";
import { createConversation, generateModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function tail(rows: Partial<TailMessage>[]): TailMessage[] {
  return rows.map((row, index) => ({
    id: row.id ?? index + 1,
    role: row.role ?? "assistant",
    content: row.content ?? "",
    tokenEstimate: row.tokenEstimate ?? 0,
    isCheckinOpener: row.isCheckinOpener ?? false,
    toolCalls: row.toolCalls ?? null,
    attachments: row.attachments ?? [],
  }));
}

test("boundary cuts where the next kept message is a user message", () => {
  const rows = tail([
    { id: 1, role: "assistant", tokenEstimate: 100 },
    { id: 2, role: "user", tokenEstimate: 100 },
    { id: 3, role: "assistant", tokenEstimate: 5000 },
    { id: 4, role: "user", tokenEstimate: 100 },
    { id: 5, role: "assistant", tokenEstimate: 5000 },
  ]);
  const boundary = selectBoundary(rows, { targetTokens: 8000, maxSummarizableId: 5 });
  expect(boundary?.coversToMessageId).toBe(3);
});

test("boundary walks older to a user seam when the ideal cut lands on an assistant reply", () => {
  const rows = tail([
    { id: 1, role: "user", tokenEstimate: 100 },
    { id: 2, role: "assistant", tokenEstimate: 100 },
    { id: 3, role: "user", tokenEstimate: 4000 },
    { id: 4, role: "assistant", tokenEstimate: 4100 },
  ]);
  const boundary = selectBoundary(rows, { targetTokens: 8000, maxSummarizableId: 4 });
  expect(boundary?.coversToMessageId).toBe(2);
});

test("boundary prefers a check-in opener within 2k tokens of the ideal cut", () => {
  const rows = tail([
    { id: 1, role: "user", tokenEstimate: 100 },
    { id: 2, role: "assistant", tokenEstimate: 100 },
    { id: 3, role: "assistant", tokenEstimate: 1000, isCheckinOpener: true },
    { id: 4, role: "user", tokenEstimate: 500 },
    { id: 5, role: "assistant", tokenEstimate: 7000 },
  ]);
  const boundary = selectBoundary(rows, { targetTokens: 8000, maxSummarizableId: 5 });
  expect(boundary?.coversToMessageId).toBe(2);
  expect(boundary?.keepStart).toBe(2);
});

test("boundary never leaves a tool result as the first kept message", () => {
  const rows = tail([
    { id: 1, role: "user", tokenEstimate: 100 },
    { id: 2, role: "assistant", tokenEstimate: 100 },
    { id: 3, role: "user", tokenEstimate: 100 },
    { id: 4, role: "assistant", tokenEstimate: 100 },
    { id: 5, role: "tool", tokenEstimate: 7900 },
  ]);
  const boundary = selectBoundary(rows, { targetTokens: 8000, maxSummarizableId: 5 });
  expect(boundary?.coversToMessageId).toBe(2);
  const firstKept = rows[boundary?.keepStart ?? 0];
  expect(firstKept?.role).toBe("user");
});

test("boundary is clamped so it never passes the extraction watermark", () => {
  const rows = tail([
    { id: 1, role: "assistant", tokenEstimate: 100 },
    { id: 2, role: "user", tokenEstimate: 100 },
    { id: 3, role: "assistant", tokenEstimate: 5000 },
    { id: 4, role: "user", tokenEstimate: 100 },
    { id: 5, role: "assistant", tokenEstimate: 5000 },
  ]);
  const boundary = selectBoundary(rows, { targetTokens: 8000, maxSummarizableId: 2 });
  expect(boundary?.coversToMessageId).toBe(1);
});

async function insertMessage(
  conversationId: string,
  role: string,
  content: string,
  tokenEstimate: number,
  adUnitId: string | null = null,
): Promise<number> {
  const inserted = await db
    .insert(messages)
    .values({ conversationId, role, content, tokenEstimate, adUnitId })
    .returning({ id: messages.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("insert failed");
  }
  return row.id;
}

test("the assembler omits the summary block when none exists and caches persona + memory", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ name: "Maya" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  await insertMessage(conversationId, "user", "hi", 1);
  await insertMessage(conversationId, "assistant", "hey!", 1);

  const view = await buildContextView(db, conversationId, { now: new Date("2026-07-03T12:00:00Z") });
  const ids = view.system.map((b) => b.id);
  expect(ids.filter((id) => id !== "guidance")).toEqual(["persona", "memory"]);
  // Persona + capability guidance form the static region; the cache breakpoint
  // sits on the last static block (guidance), not persona.
  expect(view.system.find((b) => b.id === "persona")?.cache).toBe(false);
  const guidance = view.system.filter((b) => b.id === "guidance");
  expect(guidance.at(-1)?.cache).toBe(true);
  expect(view.system.find((b) => b.id === "memory")?.cache).toBe(true);
  expect(view.messages).toEqual([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey!" },
  ]);
});

test("the assembler includes the summary block, excludes ads, and trims the tail to the watermark", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ name: "Maya" }).where(eq(users.id, userId));
  const conversationId = await createConversation(db, userId);
  const m1 = await insertMessage(conversationId, "user", "old one", 1);
  await insertMessage(conversationId, "assistant", "old reply", 1);
  await insertMessage(conversationId, "assistant", "sponsored", 1, "ad_123");
  const m4 = await insertMessage(conversationId, "user", "new one", 1);

  await db.insert(conversationSummaries).values({
    conversationId,
    coversToMessageId: m1 + 1,
    content: "RECENT ARC — you were catching up.",
    tokenEstimate: 10,
  });

  const view = await buildContextView(db, conversationId, { now: new Date("2026-07-03T12:00:00Z") });
  expect(view.system.map((b) => b.id).filter((id) => id !== "guidance")).toEqual([
    "persona",
    "memory",
    "summary",
  ]);
  expect(view.system.find((b) => b.id === "memory")?.cache).toBe(false);
  expect(view.system.find((b) => b.id === "summary")?.cache).toBe(true);
  expect(view.system.find((b) => b.id === "summary")?.text).toContain("EARLIER IN THIS CONVERSATION");
  expect(view.messages).toEqual([{ role: "user", content: "new one" }]);
  expect(m4).toBeGreaterThan(m1);
});

test("applyCompaction resolves a two-writer race: one insert wins, the loser discards", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const m1 = await insertMessage(conversationId, "user", "a", 1);
  const base = await db
    .insert(conversationSummaries)
    .values({ conversationId, coversToMessageId: m1, content: "base", tokenEstimate: 1 })
    .returning({ id: conversationSummaries.id });
  const baseId = base[0]?.id ?? null;

  const input = {
    conversationId,
    supersedesId: baseId,
    coversToMessageId: m1,
    extractionWatermark: m1 + 100,
    model: "mock",
    promptVersion: "compaction-v1",
  };
  const first = await applyCompaction(db, { ...input, content: "winner" });
  const second = await applyCompaction(db, { ...input, content: "loser" });

  expect(first).not.toBeNull();
  expect(second).toBeNull();
  const rows = await db
    .select()
    .from(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, conversationId));
  expect(rows).toHaveLength(2);
});

test("applyCompaction refuses a watermark past the extraction watermark", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  await expect(
    applyCompaction(db, {
      conversationId,
      supersedesId: null,
      coversToMessageId: 100,
      extractionWatermark: 50,
      content: "x",
      model: "mock",
      promptVersion: "compaction-v1",
    }),
  ).rejects.toThrow(/extraction watermark/);
});

test("runCompaction clamps the new summary to the extraction watermark", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) {
    ids.push(await insertMessage(conversationId, "user", `u${i}`, 3000));
    ids.push(await insertMessage(conversationId, "assistant", `a${i}`, 3000));
  }
  // Anchor the watermark to an actual message id in the *middle of this
  // conversation* — not `lastId / 2`, which assumes ids start near 1 and breaks
  // once earlier tests (shuffled) have advanced the shared sequence.
  const watermark = ids[Math.floor(ids.length / 2)]!;
  await db
    .update(conversations)
    .set({ lastExtractedMessageId: watermark })
    .where(eq(conversations.id, conversationId));

  const summary = await runCompaction(db, generateModel("RECENT ARC — recap."), conversationId);
  expect(summary).not.toBeNull();
  expect(summary?.coversToMessageId).toBeLessThanOrEqual(watermark);
});

test("runCompaction does nothing until extraction has run", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  for (let i = 0; i < 6; i++) {
    await insertMessage(conversationId, "user", `u${i}`, 3000);
    await insertMessage(conversationId, "assistant", `a${i}`, 3000);
  }
  const summary = await runCompaction(db, generateModel("recap"), conversationId);
  expect(summary).toBeNull();
});
