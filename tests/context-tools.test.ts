import { afterAll, beforeAll, expect, test } from "vitest";
import type { ModelMessage } from "ai";
import { type Database, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { buildContextView } from "@sidekick/shared";
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

async function insert(
  conversationId: string,
  role: string,
  content: string,
  toolCalls?: unknown,
): Promise<void> {
  await db.insert(messages).values({
    conversationId,
    role,
    content,
    tokenEstimate: 1,
    toolCalls: toolCalls ?? null,
  });
}

test("assistant tool-calls and tool results round-trip into paired ModelMessages", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ctx-tool-1" });
  const conversationId = await createConversation(db, userId);

  await insert(conversationId, "user", "what's the weather in chicago?");
  await insert(conversationId, "assistant", "", [
    { type: "tool-call", toolCallId: "call_1", toolName: "get_weather", input: { city: "chicago" } },
  ]);
  await insert(
    conversationId,
    "tool",
    JSON.stringify({ tempF: 72, encrypted_content: "OPAQUE_BLOB==" }),
    [{ toolCallId: "call_1", toolName: "get_weather" }],
  );
  await insert(conversationId, "assistant", "it's 72 and sunny ☀️");

  const view = await buildContextView(db, conversationId, { storageUrl: (k) => k });
  const roles = view.messages.map((m) => m.role);
  expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

  const assistantCall = view.messages[1] as Extract<ModelMessage, { role: "assistant" }>;
  expect(Array.isArray(assistantCall.content)).toBe(true);
  const callPart = Array.isArray(assistantCall.content)
    ? assistantCall.content.find((p) => p.type === "tool-call")
    : undefined;
  expect(callPart).toEqual({
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "get_weather",
    input: { city: "chicago" },
  });

  const toolMessage = view.messages[2] as Extract<ModelMessage, { role: "tool" }>;
  expect(toolMessage.content).toEqual([
    {
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "get_weather",
      // Opaque passthrough: the whole result (encrypted_content included) survives verbatim.
      output: { type: "json", value: { tempF: 72, encrypted_content: "OPAQUE_BLOB==" } },
    },
  ]);
});

test("an assistant tool-call with no matching result row is dropped to text-only", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ctx-tool-2" });
  const conversationId = await createConversation(db, userId);

  await insert(conversationId, "user", "log my run");
  // A server tool that resolved inside its own turn: toolCalls persisted, no tool row.
  await insert(conversationId, "assistant", "nice, logged it silently", [
    { type: "tool-call", toolCallId: "srv_1", toolName: "log_checkin", input: { result: "hit" } },
  ]);

  const view = await buildContextView(db, conversationId, { storageUrl: (k) => k });
  expect(view.messages).toEqual([
    { role: "user", content: "log my run" },
    { role: "assistant", content: "nice, logged it silently" },
  ]);
});

test("an orphan tool result (its call summarized away) is dropped", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ctx-tool-3" });
  const conversationId = await createConversation(db, userId);

  // No preceding assistant tool-call in the tail — the result is an orphan.
  await insert(conversationId, "tool", JSON.stringify({ ok: true }), [
    { toolCallId: "gone", toolName: "get_weather" },
  ]);
  await insert(conversationId, "user", "thanks");

  const view = await buildContextView(db, conversationId, { storageUrl: (k) => k });
  expect(view.messages).toEqual([{ role: "user", content: "thanks" }]);
});
