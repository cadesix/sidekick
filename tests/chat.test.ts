import { afterAll, beforeAll, expect, test } from "vitest";
import { asc, eq } from "drizzle-orm";
import { type Database, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { PERSONA_PROMPT } from "@sidekick/shared";
import { createConversation, makeCaller, textModel, createUserSession } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("chat.send persists the user message and the scripted assistant reply", async () => {
  const { userId, token } = await createUserSession(db);
  expect(token).toBeTruthy();
  const conversationId = await createConversation(db, userId);
  const caller = makeCaller(db, textModel("hey! glad you texted 💛"), userId);

  const outcome = await caller.chat.send({ conversationId, text: "hi sidekick" });

  expect(outcome.message.role).toBe("assistant");
  expect(outcome.message.content).toBe("hey! glad you texted 💛");
  expect(outcome.message.promptVersion).toBe(PERSONA_PROMPT.version);
  expect(outcome.message.model).toBe("mock-model-id");
  expect(outcome.message.tokensIn).toBe(10);
  expect(outcome.message.tokensOut).toBe(5);
  expect(outcome.deviceToolCalls).toEqual([]);

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
  expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  expect(rows[0]?.content).toBe("hi sidekick");
  expect(rows[0]?.tokenEstimate).toBeGreaterThan(0);
});
