import { afterAll, beforeAll, expect, test } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { type LanguageModel, simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2StreamPart } from "@ai-sdk/provider";
import { type Database, actionItems, conversations, goals, memories, messages, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  buildContextView,
  decodeStreamMeta,
  dispatchTool,
  onboardingChatState,
  onboardingTools,
  renderSystem,
  STREAM_META_PREFIX,
  type ToolContext,
} from "@sidekick/shared";
import { beginTurn, registerDevice, startOnboardingChat } from "@sidekick/server";
import { generateModel, makeCaller, testStorage, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function onboardingTool(name: string) {
  const found = onboardingTools.find((t) => t.name === name);
  if (!found) {
    throw new Error(`missing onboarding tool ${name}`);
  }
  return found;
}

async function seedProfile(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      name: "Maya",
      sidekickName: "Pip",
      personality: { archetype: "The Spark", tagline: "Spontaneous, playful, lives in the moment." },
    })
    .where(eq(users.id, userId));
}

/** A model that answers each step from a script: tool-call steps then a text step. */
function toolCallModel(parts: LanguageModelV2StreamPart[][]): LanguageModel {
  let call = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      const chunk = parts[Math.min(call, parts.length - 1)] ?? [];
      call += 1;
      return {
        stream: simulateReadableStream({
          chunks: [
            ...chunk,
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            },
          ],
        }),
      };
    },
  });
}

const text = (t: string): LanguageModelV2StreamPart[] => [
  { type: "text-start", id: "0" },
  { type: "text-delta", id: "0", delta: t },
  { type: "text-end", id: "0" },
];

test("startOnboardingChat seeds the conversation, planless goals, and an LLM intro — idempotently", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ob-chat-start" });
  await seedProfile(userId);

  const first = await startOnboardingChat(db, generateModel("hey maya! a spark — i love that for us."), userId, [
    "get-fit",
    "sleep-better",
  ]);

  const convo = await db
    .select({ kind: conversations.kind })
    .from(conversations)
    .where(eq(conversations.id, first.conversationId));
  expect(convo[0]?.kind).toBe("onboarding");

  const goalRows = await db.select().from(goals).where(eq(goals.userId, userId));
  expect(goalRows.map((g) => g.slug).sort()).toEqual(["get-fit", "sleep-better"]);
  const items = await db.select().from(actionItems);
  expect(items.filter((i) => goalRows.some((g) => g.id === i.goalId))).toHaveLength(0);

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, first.conversationId))
    .orderBy(asc(messages.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.role).toBe("assistant");
  expect(rows[0]?.content).toBe("hey maya! a spark — i love that for us.");
  expect(rows[0]?.promptVersion).toBe("onboarding-chat-v1");

  const again = await startOnboardingChat(db, generateModel("something else"), userId, ["get-fit"]);
  expect(again.conversationId).toBe(first.conversationId);
  const rowsAfter = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, first.conversationId));
  expect(rowsAfter).toHaveLength(1);
});

test("the onboarding context view is persona + setup block, no memory or guidance", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ob-chat-view" });
  await seedProfile(userId);
  const { conversationId } = await startOnboardingChat(db, generateModel("hi!"), userId, [
    "get-fit",
    "sleep-better",
  ]);

  const view = await buildContextView(db, conversationId);
  expect(view.system.map((b) => b.id)).toEqual(["persona", "onboarding"]);
  expect(view.promptVersion).toBe("onboarding-chat-v1");

  const block = view.system[1]!.text;
  expect(block).toContain("get fit — not planned yet");
  expect(block).toContain("sleep better — not planned yet");
  expect(block).toContain('action_slug "gym"');
  expect(block).toContain("The Spark");
  expect(renderSystem(view.system)).not.toContain("WHAT YOU KNOW ABOUT");
});

test("commit_onboarding_choice plans a goal and the derived beat advances", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ob-chat-commit" });
  await seedProfile(userId);
  const { conversationId } = await startOnboardingChat(db, generateModel("hi!"), userId, [
    "get-fit",
    "sleep-better",
  ]);
  const ctx: ToolContext = { db, userId, conversationId };

  const before = await onboardingChatState(db, userId);
  expect(before.beat).toEqual({ type: "plan_goal", slug: "get-fit" });

  const committed = await dispatchTool(
    onboardingTool("commit_onboarding_choice"),
    { goal_slug: "get-fit", action_slug: "run", cadence: { type: "weekly", target: 3 } },
    ctx,
  );
  expect(committed).toEqual({
    status: "done",
    result: { ok: true, goal: "Get Fit", plan: "Go for a run, 3× a week" },
  });

  const mid = await onboardingChatState(db, userId);
  expect(mid.beat).toEqual({ type: "plan_goal", slug: "sleep-better" });
  expect(mid.goals.find((g) => g.slug === "get-fit")?.planned).toBe(true);

  await dispatchTool(
    onboardingTool("commit_onboarding_choice"),
    { goal_slug: "sleep-better", action_slug: "sleep-by" },
    ctx,
  );
  const afterGoals = await onboardingChatState(db, userId);
  expect(afterGoals.beat).toEqual({ type: "reminder" });

  await dispatchTool(onboardingTool("set_reminder_time"), { time: "20:30" }, ctx);
  const done = await onboardingChatState(db, userId);
  expect(done.beat).toEqual({ type: "wrap_up" });
  expect(done.reminderTime).toBe("20:30");

  const userRow = await db.select({ r: users.reminderTime }).from(users).where(eq(users.id, userId));
  expect(userRow[0]?.r).toBe("20:30");
});

test("an onboarding turn executes the commit tool and streams a beat-carrying meta frame", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ob-chat-turn" });
  await seedProfile(userId);
  const { conversationId } = await startOnboardingChat(db, generateModel("hi!"), userId, ["get-fit"]);

  const model = toolCallModel([
    [
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "commit_onboarding_choice",
        input: JSON.stringify({
          goal_slug: "get-fit",
          action_slug: "gym",
          cadence: { type: "weekly", target: 3 },
        }),
      },
    ],
    text("locked in! when should i check in with you?"),
  ]);

  const { textStream, done } = await beginTurn(
    {
      db,
      model,
      flags: {},
      userId,
      storage: testStorage(),
      replyModel: generateModel('["9:00 am", "8:00 pm"]'),
    },
    { conversationId, text: "the gym, 3 times a week" },
  );
  const chunks: string[] = [];
  for await (const chunk of textStream) {
    chunks.push(chunk);
  }
  const outcome = await done;

  expect(outcome.message.content).toBe("locked in! when should i check in with you?");
  expect(outcome.suggestedReplies).toEqual(["9:00 am", "8:00 pm"]);

  const frame = chunks.find((c) => c.startsWith(STREAM_META_PREFIX));
  expect(frame).toBeDefined();
  const payload = frame!.slice(STREAM_META_PREFIX.length, -1);
  expect(decodeStreamMeta(payload)).toEqual({
    replies: ["9:00 am", "8:00 pm"],
    beat: "reminder",
  });

  const state = await onboardingChatState(db, userId);
  expect(state.goals[0]?.planned).toBe(true);
  expect(state.beat).toEqual({ type: "reminder" });
});

test("complete() keeps a chat-committed plan instead of double-adopting", async () => {
  const { userId } = await registerDevice(db, { deviceId: "ob-chat-complete" });
  await seedProfile(userId);
  const { conversationId } = await startOnboardingChat(db, generateModel("hi!"), userId, ["get-fit"]);
  const ctx: ToolContext = { db, userId, conversationId };
  await dispatchTool(
    onboardingTool("commit_onboarding_choice"),
    { goal_slug: "get-fit", action_slug: "run", cadence: { type: "weekly", target: 4 } },
    ctx,
  );
  await dispatchTool(onboardingTool("set_reminder_time"), { time: "08:15" }, ctx);

  const caller = makeCaller(db, textModel("ok"), userId);
  await caller.onboarding.complete({
    name: "Maya",
    ageBracket: "25-34",
    gender: "female",
    personality: {
      archetype: "The Spark",
      tagline: "Spontaneous, playful, lives in the moment.",
      blurb: "You thrive on fun.",
      percents: { O: 60, C: 40, E: 80, A: 70, N: 30 },
    },
    sidekickName: "Pip",
    sidekickColor: "yellow",
    timezone: "America/Chicago",
    goals: [{ slug: "get-fit" }],
  });

  const goalRows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, "active")));
  expect(goalRows).toHaveLength(1);
  const items = await db.select().from(actionItems).where(eq(actionItems.goalId, goalRows[0]!.id));
  expect(items).toHaveLength(1);
  expect(items[0]?.slug).toBe("run");
  expect(items[0]?.cadence).toEqual({ type: "weekly", target: 4 });

  const memoryRows = await db
    .select({ content: memories.content })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.kind, "goal_context")));
  expect(memoryRows.map((m) => m.content)).toEqual([
    "Maya chose get fit (go for a run, 4× a week).",
  ]);

  const me = await caller.users.me();
  expect(me.reminderTime).toBe("08:15");
  expect(me.onboardingComplete).toBe(true);
});
