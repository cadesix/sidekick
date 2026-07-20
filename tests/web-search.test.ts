import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { type LanguageModel, simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2StreamPart } from "@ai-sdk/provider";
import { type Database, checkIns, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { buildContextView } from "@sidekick/shared";
import { logger, sendChatTurn } from "@sidekick/server";
import { generateOpener } from "../packages/server/src/checkins/engine";
import { createConversation, testStorage, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

/**
 * An OpenAI `web_search` tool result: an opaque `{ action, sources }` object that
 * must survive verbatim in the persisted tool row (11/08). Only the compact
 * `url`s get lifted onto the assistant row for citation pills.
 */
const SEARCH_OUTPUT = {
  action: { type: "search", query: "is the marathon still on" },
  sources: [
    { type: "url", url: "https://www.nytimes.com/2026/07/07/marathon.html" },
    { type: "url", url: "https://www.espn.com/race/live" },
  ],
};

function textParts(text: string): LanguageModelV2StreamPart[] {
  return [
    { type: "text-start", id: "0" },
    { type: "text-delta", id: "0", delta: text },
    { type: "text-end", id: "0" },
  ];
}

function searchCall(id: string, query: string): LanguageModelV2StreamPart {
  return {
    type: "tool-call",
    toolCallId: id,
    toolName: "web_search",
    input: JSON.stringify({ query }),
    providerExecuted: true,
  };
}

function searchResult(id: string, output: unknown): LanguageModelV2StreamPart {
  return {
    type: "tool-result",
    toolCallId: id,
    toolName: "web_search",
    result: output,
    providerExecuted: true,
  };
}

function finish(): LanguageModelV2StreamPart {
  return {
    type: "finish",
    finishReason: "stop",
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  };
}

/**
 * A mock chat model that streams a scripted sequence of parts per call, so a
 * multi-attempt (pause_turn) turn can be driven deterministically. Records the
 * `tools` handed to it each call, to assert what the registry offered.
 */
function scriptedStreamModel(scripts: LanguageModelV2StreamPart[][]): {
  model: LanguageModel;
  seenTools: unknown[];
  callCount: () => number;
} {
  const seenTools: unknown[] = [];
  let call = 0;
  const model = new MockLanguageModelV2({
    doStream: async (options) => {
      seenTools.push(options.tools);
      const chunks = scripts[Math.min(call, scripts.length - 1)] ?? [];
      call += 1;
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  return { model, seenTools, callCount: () => call };
}

/** A mock opener model (generateText path) recording the tools it was offered. */
function scriptedOpenerModel(text: string): { model: LanguageModel; seenTools: unknown[] } {
  const seenTools: unknown[] = [];
  const model = new MockLanguageModelV2({
    doGenerate: async (options) => {
      seenTools.push(options.tools);
      return {
        content: [{ type: "text", text }],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        warnings: [],
      };
    },
  });
  return { model, seenTools };
}

async function makeUser(deviceId: string, timezone = "UTC"): Promise<typeof users.$inferSelect> {
  const userId = await createUser(db);
  const updated = await db
    .update(users)
    .set({ timezone, name: "Maya", sidekickName: "Kick" })
    .where(eq(users.id, userId))
    .returning();
  return updated[0]!;
}

test("web_search result round-trips encrypted_content byte-identical and logs usage", async () => {
  const user = await makeUser("ws-roundtrip");
  const conversationId = await createConversation(db, user.id);
  const { model } = scriptedStreamModel([
    [
      searchCall("s1", "is the marathon still on"),
      searchResult("s1", SEARCH_OUTPUT),
      ...textParts("ok so it says the marathon is still on sunday"),
      finish(),
    ],
  ]);

  const logs: unknown[] = [];
  const info = vi.spyOn(logger, "info").mockImplementation((first) => {
    logs.push(first);
  });
  const outcome = await sendChatTurn(
    { db, model, flags: {}, userId: user.id, storage: testStorage() },
    { conversationId, text: "is the marathon still on?" },
  );
  info.mockRestore();

  expect(outcome.message.content).toContain("marathon");

  const toolRows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "tool")));
  expect(toolRows).toHaveLength(1);
  expect(JSON.parse(toolRows[0]!.content)).toEqual(SEARCH_OUTPUT);

  // the assistant row carries only compact sources — never the full opaque output
  const assistantJson = JSON.stringify(outcome.message.toolCalls);
  expect(assistantJson).toContain("nytimes.com");
  expect(assistantJson).not.toContain("action");

  // derived-view reconstruction hands the model back the exact result
  const view = await buildContextView(db, conversationId, {});
  const toolMessage = view.messages.find((m) => m.role === "tool");
  expect(toolMessage).toBeDefined();
  const content = toolMessage!.content;
  expect(Array.isArray(content)).toBe(true);
  if (Array.isArray(content)) {
    const part = content.find((p) => p.type === "tool-result");
    expect(part).toBeDefined();
    if (part && part.type === "tool-result" && part.output.type === "json") {
      expect(part.output.value).toEqual(SEARCH_OUTPUT);
    }
  }

  const logged = logs.find(
    (entry) => typeof entry === "object" && entry !== null && "webSearchRequests" in entry,
  );
  expect(logged).toMatchObject({ event: "chat.turn.search", webSearchRequests: 1 });
});

test("pause_turn resends the assistant turn unchanged until a real stop", async () => {
  const user = await makeUser("ws-pause");
  const conversationId = await createConversation(db, user.id);
  const { model, callCount } = scriptedStreamModel([
    [searchCall("s1", "latest news"), finish()],
    [searchResult("s1", SEARCH_OUTPUT), ...textParts("here's the scoop"), finish()],
  ]);

  const outcome = await sendChatTurn(
    { db, model, flags: {}, userId: user.id, storage: testStorage() },
    { conversationId, text: "anything new?" },
  );

  expect(callCount()).toBe(2);
  expect(outcome.message.content).toBe("here's the scoop");

  const toolRows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "tool")));
  expect(toolRows).toHaveLength(1);
  expect(JSON.parse(toolRows[0]!.content)).toEqual(SEARCH_OUTPUT);
});

test("past the daily search cap, web_search is omitted", async () => {
  const user = await makeUser("ws-capped");
  const conversationId = await createConversation(db, user.id);
  for (let i = 0; i < 20; i += 1) {
    await db.insert(messages).values({
      conversationId,
      role: "assistant",
      content: "past search",
      tokenEstimate: 1,
      toolCalls: [{ toolCallId: `h${i}`, toolName: "web_search" }],
    });
  }
  const { model, seenTools } = scriptedStreamModel([[...textParts("from what i know"), finish()]]);
  await sendChatTurn(
    { db, model, flags: {}, userId: user.id, storage: testStorage() },
    { conversationId, text: "news?" },
  );

  expect(JSON.stringify(seenTools[0])).not.toContain("web_search");
});

test("under the daily cap, web_search is offered", async () => {
  const user = await makeUser("ws-uncapped");
  const conversationId = await createConversation(db, user.id);
  const { model, seenTools } = scriptedStreamModel([[...textParts("sure"), finish()]]);
  await sendChatTurn(
    { db, model, flags: {}, userId: user.id, storage: testStorage() },
    { conversationId, text: "what's the score?" },
  );
  expect(JSON.stringify(seenTools[0])).toContain("web_search");
});

test("web_search disabled by feature flag is never offered", async () => {
  const user = await makeUser("ws-flagged");
  const conversationId = await createConversation(db, user.id);
  const { model, seenTools } = scriptedStreamModel([[...textParts("ok"), finish()]]);
  await sendChatTurn(
    { db, model, flags: { web_search: false }, userId: user.id, storage: testStorage() },
    { conversationId, text: "score?" },
  );
  expect(JSON.stringify(seenTools[0])).not.toContain("web_search");
});

test("opener offers web search when under the weekly cap", async () => {
  const user = await makeUser("op-under");
  const { model, seenTools } = scriptedOpenerModel("morning! ☀️");
  await generateOpener({ db, model }, user, new Date("2026-07-07T09:00:00Z"));
  expect(JSON.stringify(seenTools[0] ?? [])).toContain("web_search");
});

test("opener withholds web search after two searched openers this week", async () => {
  const user = await makeUser("op-capped");
  const conversationId = await createConversation(db, user.id);
  for (const date of ["2026-07-06", "2026-07-05"]) {
    const inserted = await db
      .insert(messages)
      .values({
        conversationId,
        role: "assistant",
        content: "earlier opener",
        tokenEstimate: 1,
        toolCalls: [{ toolCallId: `o-${date}`, toolName: "web_search" }],
      })
      .returning({ id: messages.id });
    await db
      .insert(checkIns)
      .values({ userId: user.id, date, status: "opened", openerMessageId: inserted[0]!.id });
  }

  const { model, seenTools } = scriptedOpenerModel("hey you");
  await generateOpener({ db, model }, user, new Date("2026-07-07T09:00:00Z"));
  expect(JSON.stringify(seenTools[0] ?? [])).not.toContain("web_search");
});

