import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  type Reaction,
  type SidekickTool,
  type TailMessage,
  type ToolContext,
  allTools,
  assembleTail,
} from "@sidekick/shared";
import { createConversation, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function reactTool(): SidekickTool {
  const tool = allTools.find((t) => t.name === "react_to_message");
  if (!tool?.execute) {
    throw new Error("react_to_message tool is not registered with an executor");
  }
  return tool;
}

async function insertMessage(
  conversationId: string,
  role: string,
  content: string,
  reactions: Reaction[] = [],
): Promise<number> {
  const rows = await db
    .insert(messages)
    .values({ conversationId, role, content, tokenEstimate: content.length, reactions })
    .returning({ id: messages.id });
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("failed to insert message");
  }
  return id;
}

async function reactionsOf(messageId: number): Promise<Reaction[]> {
  const rows = await db
    .select({ reactions: messages.reactions })
    .from(messages)
    .where(eq(messages.id, messageId));
  return rows[0]?.reactions ?? [];
}

test("react_to_message tapbacks the latest user message as the sidekick", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx: ToolContext = { db, userId, conversationId };
  const older = await insertMessage(conversationId, "user", "first");
  const latest = await insertMessage(conversationId, "user", "just ran my first 5k!!");

  await expect(reactTool().execute?.({ type: "heart" }, ctx)).resolves.toEqual({ ok: true });

  expect(await reactionsOf(latest)).toEqual([{ type: "heart", from: "them" }]);
  expect(await reactionsOf(older)).toEqual([]);
});

test("react_to_message replaces a prior sidekick reaction, one per sender", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx: ToolContext = { db, userId, conversationId };
  const messageId = await insertMessage(conversationId, "user", "nailed it", [
    { type: "thumbsUp", from: "them" },
  ]);

  await expect(reactTool().execute?.({ type: "heart" }, ctx)).resolves.toEqual({ ok: true });

  expect(await reactionsOf(messageId)).toEqual([{ type: "heart", from: "them" }]);
});

test("react_to_message preserves the user's own reaction", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx: ToolContext = { db, userId, conversationId };
  const messageId = await insertMessage(conversationId, "user", "big news", [
    { type: "heart", from: "me" },
  ]);

  await expect(reactTool().execute?.({ type: "thumbsUp" }, ctx)).resolves.toEqual({ ok: true });

  expect(await reactionsOf(messageId)).toEqual([
    { type: "heart", from: "me" },
    { type: "thumbsUp", from: "them" },
  ]);
});

test("react_to_message returns ok:false when there is no user message to react to", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx: ToolContext = { db, userId, conversationId };
  const assistantId = await insertMessage(conversationId, "assistant", "hey there");

  await expect(reactTool().execute?.({ type: "heart" }, ctx)).resolves.toEqual({
    ok: false,
    reason: "no user message to react to",
  });
  expect(await reactionsOf(assistantId)).toEqual([]);
});

test("react_to_message rejects an invalid reaction type at the zod boundary", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx: ToolContext = { db, userId, conversationId };
  await insertMessage(conversationId, "user", "react to me");

  const tool = reactTool();
  expect(() => tool.execute?.({ type: "shrug" }, ctx)).toThrow(/invalid reaction type/);
});

function tailRow(overrides: Partial<TailMessage>): TailMessage {
  return {
    id: overrides.id ?? 1,
    role: overrides.role ?? "user",
    content: overrides.content ?? "",
    tokenEstimate: overrides.tokenEstimate ?? 0,
    isCheckinOpener: overrides.isCheckinOpener ?? false,
    toolCalls: overrides.toolCalls ?? null,
    attachments: overrides.attachments ?? [],
    reactions: overrides.reactions ?? [],
  };
}

const identityUrl = (key: string): string => key;

test("assembleTail annotates a reacted user row with a trailing [you reacted …] part", () => {
  const view = assembleTail(
    [
      tailRow({
        role: "user",
        content: "just ran my first 5k!!",
        reactions: [{ type: "heart", from: "them" }],
      }),
    ],
    identityUrl,
  );
  expect(view).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: "just ran my first 5k!!" },
        { type: "text", text: "[you reacted ❤️]" },
      ],
    },
  ]);
});

test("assembleTail annotates a reacted assistant row with a [user reacted …] suffix line", () => {
  const view = assembleTail(
    [tailRow({ role: "assistant", content: "nice work", reactions: [{ type: "heart", from: "me" }] })],
    identityUrl,
  );
  expect(view).toEqual([{ role: "assistant", content: "nice work\n[user reacted ❤️]" }]);
});

test("assembleTail renders a custom emoji reaction as the raw glyph", () => {
  const view = assembleTail(
    [tailRow({ role: "assistant", content: "let's go", reactions: [{ type: "emoji:🔥", from: "me" }] })],
    identityUrl,
  );
  expect(view).toEqual([{ role: "assistant", content: "let's go\n[user reacted 🔥]" }]);
});

test("assembleTail renders an unreacted tail byte-identically to the pre-reactions output", () => {
  const rows = [
    tailRow({ id: 1, role: "user", content: "hi" }),
    tailRow({ id: 2, role: "assistant", content: "hey!" }),
  ];
  // A message with an empty `reactions` field must render exactly as it did
  // before tapbacks existed, or every historical row would shift the prefix cache.
  expect(assembleTail(rows, identityUrl)).toEqual([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey!" },
  ]);
});
