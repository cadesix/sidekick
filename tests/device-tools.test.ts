import { afterAll, beforeAll, expect, test } from "vitest";
import { asc, eq } from "drizzle-orm";
import { type LanguageModel, simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2StreamPart } from "@ai-sdk/provider";
import { type Database, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  DEVICE_TOOL_PREFIX,
  STREAM_META_DELIMITER,
  buildContextView,
  decodeDeviceToolCalls,
} from "@sidekick/shared";
import { beginTurn, continueTurn, recordDeviceToolResult, registerDevice } from "@sidekick/server";
import { createConversation, testStorage } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function textParts(text: string): LanguageModelV2StreamPart[] {
  return [
    { type: "text-start", id: "0" },
    { type: "text-delta", id: "0", delta: text },
    { type: "text-end", id: "0" },
  ];
}

const USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

/** A client (device) tool-call the model emits — no `providerExecuted`, no result. */
function deviceCall(id: string, toolName: string, input: unknown = {}): LanguageModelV2StreamPart {
  return { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) };
}

function finish(reason: "stop" | "tool-calls"): LanguageModelV2StreamPart {
  return { type: "finish", finishReason: reason, usage: USAGE };
}

/** A mock model that streams a scripted sequence of parts per `doStream` call. */
function scriptedStreamModel(scripts: LanguageModelV2StreamPart[][]): LanguageModel {
  let call = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      const chunks = scripts[Math.min(call, scripts.length - 1)] ?? [];
      call += 1;
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

async function makeUser(deviceId: string): Promise<string> {
  const { userId } = await registerDevice(db, { deviceId });
  await db.update(users).set({ name: "Maya", sidekickName: "Kick" }).where(eq(users.id, userId));
  return userId;
}

function services(userId: string, model: LanguageModel) {
  return { db, model, flags: { suggested_replies: false }, userId, storage: testStorage() };
}

async function drain(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of gen) {
    out += chunk;
  }
  return out;
}

async function conversationMessages(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
}

test("device-tool round-trip: frame surfaced, result drives continuation, valid persisted sequence", async () => {
  const userId = await makeUser("dt-happy");
  const conversationId = await createConversation(db, userId);
  const model = scriptedStreamModel([
    [deviceCall("d1", "focus_block_now"), finish("tool-calls")],
    [...textParts("locked in — crush it 🔒"), finish("stop")],
  ]);

  const first = await beginTurn(services(userId, model), {
    conversationId,
    text: "lock me out, i'm studying",
  });
  const streamed = await drain(first.textStream);
  const outcome = await first.done;

  // the device-tool frame is surfaced on the stream, decodable, with no visible prose
  expect(streamed).toContain(DEVICE_TOOL_PREFIX);
  const body = streamed.slice(streamed.indexOf(DEVICE_TOOL_PREFIX) + DEVICE_TOOL_PREFIX.length);
  const decoded = decodeDeviceToolCalls(body.slice(0, body.indexOf(STREAM_META_DELIMITER)));
  expect(decoded).toEqual([{ toolCallId: "d1", toolName: "focus_block_now", input: {} }]);
  expect(outcome.deviceToolCalls).toEqual([
    { toolCallId: "d1", toolName: "focus_block_now", input: {} },
  ]);
  expect(outcome.finishReason).toBe("tool-calls");

  // the app posts the native result, then the client re-opens the stream to continue
  await recordDeviceToolResult(db, userId, {
    conversationId,
    toolCallId: "d1",
    toolName: "focus_block_now",
    result: { ok: true },
  });
  const cont = await continueTurn(services(userId, model), { conversationId });
  const contText = await drain(cont.textStream);
  await cont.done;
  expect(contText).toContain("locked in");

  // persisted as assistant-toolcall → tool-result → assistant-text
  const rows = await conversationMessages(conversationId);
  expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  expect(JSON.stringify(rows[1]!.toolCalls)).toContain("focus_block_now");
  expect(JSON.parse(rows[2]!.content)).toEqual({ ok: true });
  expect(rows[3]!.content).toContain("locked in");

  // buildContextView reconstructs the pair into paired ModelMessages
  const view = await buildContextView(db, conversationId, {});
  const assistantWithCall = view.messages.find(
    (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p) => p.type === "tool-call"),
  );
  expect(assistantWithCall).toBeDefined();
  const toolMessage = view.messages.find((m) => m.role === "tool");
  expect(toolMessage).toBeDefined();
  if (toolMessage && Array.isArray(toolMessage.content)) {
    const part = toolMessage.content.find((p) => p.type === "tool-result");
    expect(part?.type === "tool-result" && part.toolCallId).toBe("d1");
  }
});

test("no client result → continuation carries device_unavailable so the model can say so", async () => {
  const userId = await makeUser("dt-unavailable");
  const conversationId = await createConversation(db, userId);
  const model = scriptedStreamModel([
    [deviceCall("u1", "focus_start_session", { minutes: 45 }), finish("tool-calls")],
    [...textParts("hmm, i can't peek at that right now"), finish("stop")],
  ]);

  const first = await beginTurn(services(userId, model), { conversationId, text: "how am i doing?" });
  await drain(first.textStream);
  await first.done;

  // the app timed out / focus wasn't available → posts the device_unavailable sentinel
  await recordDeviceToolResult(db, userId, {
    conversationId,
    toolCallId: "u1",
    toolName: "focus_start_session",
    result: { error: "device_unavailable" },
  });

  const view = await buildContextView(db, conversationId, {});
  const toolMessage = view.messages.find((m) => m.role === "tool");
  expect(toolMessage).toBeDefined();
  if (toolMessage && Array.isArray(toolMessage.content)) {
    const part = toolMessage.content.find((p) => p.type === "tool-result");
    if (part?.type === "tool-result" && part.output.type === "json") {
      expect(part.output.value).toEqual({ error: "device_unavailable" });
    }
  }

  const cont = await continueTurn(services(userId, model), { conversationId });
  const contText = await drain(cont.textStream);
  await cont.done;
  expect(contText).toContain("can't peek");
});

test("device-tool result posts are idempotent (dedupe by toolCallId)", async () => {
  const userId = await makeUser("dt-idempotent");
  const conversationId = await createConversation(db, userId);
  const model = scriptedStreamModel([
    [deviceCall("i1", "focus_unblock", { minutes: 10 }), finish("tool-calls")],
  ]);

  const first = await beginTurn(services(userId, model), { conversationId, text: "gimme 10 min" });
  await drain(first.textStream);
  await first.done;

  const a = await recordDeviceToolResult(db, userId, {
    conversationId,
    toolCallId: "i1",
    toolName: "focus_unblock",
    result: { ok: true, minutes: 10 },
  });
  const b = await recordDeviceToolResult(db, userId, {
    conversationId,
    toolCallId: "i1",
    toolName: "focus_unblock",
    result: { ok: true, minutes: 10 },
  });
  expect(b.messageId).toBe(a.messageId);

  const toolRows = (await conversationMessages(conversationId)).filter((r) => r.role === "tool");
  expect(toolRows).toHaveLength(1);
});
