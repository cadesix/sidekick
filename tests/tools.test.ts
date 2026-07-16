import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type Database, memories, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { defineTool, dispatchTool, type ToolContext } from "@sidekick/shared";
import { registerDevice } from "@sidekick/server";
import { createConversation, makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const serverTool = defineTool({
  name: "test_log_interest",
  description: "log an interest memory",
  execution: "server",
  parameters: z.object({ content: z.string() }),
  execute: async ({ content }, { db: toolDb, userId }: ToolContext) => {
    await toolDb.insert(memories).values({
      userId,
      kind: "interest",
      content,
      source: "extraction",
    });
    return { logged: true };
  },
});

const deviceTool = defineTool({
  name: "test_read_steps",
  description: "read step count on device",
  execution: "client",
  parameters: z.object({ rangeDays: z.number() }),
});

test("a server tool executes against Postgres and returns its result", async () => {
  const { userId } = await registerDevice(db, { deviceId: "tool-device-1" });
  const conversationId = await createConversation(db, userId);
  const ctx: ToolContext = { db, userId, conversationId };

  const dispatched = await dispatchTool(serverTool, { content: "into matcha" }, ctx);
  expect(dispatched).toEqual({ status: "done", result: { logged: true } });

  const rows = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.content).toBe("into matcha");
});

test("a client tool has no server execution and round-trips via deviceToolResult", async () => {
  const { userId } = await registerDevice(db, { deviceId: "tool-device-2" });
  const conversationId = await createConversation(db, userId);
  const ctx: ToolContext = { db, userId, conversationId };

  const dispatched = await dispatchTool(deviceTool, { rangeDays: 7 }, ctx);
  expect(dispatched).toEqual({ status: "pending_device" });

  const caller = makeCaller(db, textModel("noted"), userId);
  const ack = await caller.chat.deviceToolResult({
    conversationId,
    toolCallId: "call_1",
    toolName: "test_read_steps",
    result: { steps: 11204 },
  });
  expect(ack.ok).toBe(true);

  const toolRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  const toolMessage = toolRows.find((r) => r.role === "tool");
  expect(toolMessage?.content).toBe(JSON.stringify({ steps: 11204 }));
});
