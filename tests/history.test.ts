import { afterAll, beforeAll, expect, test } from "vitest";
import { type Database, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { createConversation, makeCaller, textModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function insert(conversationId: string, content: string): Promise<number> {
  const rows = await db
    .insert(messages)
    .values({ conversationId, role: "user", content, tokenEstimate: content.length })
    .returning({ id: messages.id });
  return rows[0]?.id ?? 0;
}

test("chat.history keyset-paginates newest-first", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(await insert(conversationId, `message ${i}`));
  }
  const caller = makeCaller(db, textModel("x"), userId);

  const page1 = await caller.chat.history({ conversationId, limit: 2 });
  expect(page1.map((m) => m.id)).toEqual([ids[4], ids[3]]);

  const page2 = await caller.chat.history({ conversationId, cursor: ids[3], limit: 2 });
  expect(page2.map((m) => m.id)).toEqual([ids[2], ids[1]]);
});

test("chat.historyAround returns a centered chronological window", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(await insert(conversationId, `m${i}`));
  }
  const caller = makeCaller(db, textModel("x"), userId);

  const around = await caller.chat.historyAround({ conversationId, messageId: ids[2] ?? 0, span: 1 });
  expect(around.map((m) => m.id)).toEqual([ids[1], ids[2], ids[3]]);
});

test("chat read paths reject another user's conversation", async () => {
  const owner = await createUser(db);
  const conversationId = await createConversation(db, owner);
  const messageId = await insert(conversationId, "a private message");

  const attacker = await createUser(db);
  const caller = makeCaller(db, textModel("x"), attacker);

  await expect(caller.chat.history({ conversationId, limit: 10 })).rejects.toThrow(/not found/i);
  await expect(
    caller.chat.historyAround({ conversationId, messageId, span: 2 }),
  ).rejects.toThrow(/not found/i);
  await expect(caller.chat.search({ conversationId, query: "private" })).rejects.toThrow(
    /not found/i,
  );
});

test("chat.search finds messages via Postgres FTS with a bolded snippet", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  await insert(conversationId, "the quick brown fox runs fast");
  await insert(conversationId, "lazy dogs sleep all day");
  await insert(conversationId, "i went for a morning run by the river");
  const caller = makeCaller(db, textModel("x"), userId);

  const hits = await caller.chat.search({ conversationId, query: "run" });
  const contents = hits.map((h) => h.content);
  expect(contents).toContain("i went for a morning run by the river");
  expect(contents).toContain("the quick brown fox runs fast");
  expect(contents).not.toContain("lazy dogs sleep all day");
  expect(hits.some((h) => h.snippet.includes("<b>"))).toBe(true);
});
