import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type LanguageModel } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { type Database, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { createUser, makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

/**
 * The Star Chat LLM seam (docs/STAR-CHAT.md): the client posts conversation
 * STATE and the server builds every prompt from core's builders, so these tests
 * capture the prompt to prove the client never supplies prompt text — and that a
 * model failure surfaces as null rather than fabricated text (the runner's
 * scripted fallbacks depend on it).
 */
function capturingModel(reply: string): { model: LanguageModel; prompts: string[] } {
  const prompts: string[] = [];
  const model = new MockLanguageModelV2({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        content: [{ type: "text", text: reply }],
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

function failingModel(): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: async () => {
      throw new Error("model unavailable");
    },
  });
}

function caller(userId: string, sessionModel?: LanguageModel) {
  return makeCaller(db, textModel("ok"), userId, { sessionModel });
}

const STATE = {
  phase: 1,
  turnsInPhase: 1,
  fields: {
    life_stage: {
      status: "high" as const,
      value: "rocket engineer",
      evidence: ["i design rockets"],
    },
  },
};

const CARD = {
  archetype: "the midnight builder",
  reading: "you come alive when the world quiets down.",
  traits: ["curious", "driven"],
};

test("controller builds the prompt from core and renders the transcript server-side", async () => {
  const userId = await createUser(db);
  const { model, prompts } = capturingModel(JSON.stringify({ message: "love that", phaseComplete: false }));

  const result = await caller(userId, model).starChat.controller({
    state: STATE,
    messages: [
      { role: "bot", text: "so what do you do day to day?" },
      { role: "user", text: "i design rockets" },
    ],
  });
  expect(result.text).toContain("love that");

  expect(prompts).toHaveLength(1);
  // core's controller prompt, with the state block rendered from what we posted
  expect(prompts[0]).toContain("STATE, what you already know");
  expect(prompts[0]).toContain("life_stage: high (rocket engineer)");
  expect(prompts[0]).toContain("CURRENT CHAPTER");
  // and the transcript the server rendered itself, role-labelled
  expect(prompts[0]).toContain("user: i design rockets");
  expect(prompts[0]).toContain("sidekick: so what do you do day to day?");
});

test("card feeds the prior astral from the database, not the payload", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ astral: CARD }).where(eq(users.id, userId));
  const { model, prompts } = capturingModel(JSON.stringify(CARD));

  const result = await caller(userId, model).starChat.card({ state: STATE });
  expect(result.text).toContain("the midnight builder");

  expect(prompts[0]).toContain("This is an UPDATE");
  expect(prompts[0]).toContain("archetype: the midnight builder");
  // the digest is built from the posted state's evidence
  expect(prompts[0]).toContain("life stage / occupation: rocket engineer");
});

test("card treats a user with no stored astral as a first card", async () => {
  const userId = await createUser(db);
  const { model, prompts } = capturingModel(JSON.stringify(CARD));
  await caller(userId, model).starChat.card({ state: STATE });
  expect(prompts[0]).not.toContain("This is an UPDATE");
  expect(prompts[0]).toContain("Build it from what they");
});

test("artifact asks for the evidence-cited insights payload", async () => {
  const userId = await createUser(db);
  const { model, prompts } = capturingModel(JSON.stringify({ ...CARD, insights: [] }));
  const result = await caller(userId, model).starChat.artifact({ state: STATE });
  expect(result.text).toContain("the midnight builder");
  expect(prompts[0]).toContain("insights");
  expect(prompts[0]).toContain("It must feel EARNED");
});

test("every turn returns null text on model failure — never fabricated text", async () => {
  const userId = await createUser(db);
  const c = caller(userId, failingModel());
  expect(await c.starChat.controller({ state: STATE, messages: [{ role: "user", text: "hi" }] })).toEqual({
    text: null,
  });
  expect(await c.starChat.card({ state: STATE })).toEqual({ text: null });
  expect(await c.starChat.artifact({ state: STATE })).toEqual({ text: null });
});

test("the procedures are authenticated — a signed-out caller is refused", async () => {
  const c = makeCaller(db, textModel("ok"), null, {});
  await expect(c.starChat.controller({ state: STATE, messages: [] })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});
