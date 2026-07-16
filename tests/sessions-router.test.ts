import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type LanguageModel } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { type Database, guidedSessions, ledger, sessionNotes, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { SESSIONS, sessionFor } from "@sidekick/core";
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
 * The capturing fake for the session-LLM seam: replies with one fixed body and
 * records every prompt (JSON-encoded) so tests can assert the server built the
 * ask/answer/prior-profile context from ITS OWN storage, not client input.
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

/** A session model that always errors — the LLM-down path. */
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

async function userRow(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]!;
}

async function sessionLedgerRows(userId: string) {
  return db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.source, "session")));
}

const frostpeak = sessionFor("frostpeak")!;

const EXTRACTION_REPLY = {
  fields: { chronotype: "night owl", occupation: "rocket design" },
  notes: [{ tag: "weekday_note", text: "works from a garage lab" }],
  recap: "ok so you build rockets at night. locked in 🔒",
  analysis: {
    archetype: "the midnight builder",
    reading: "you come alive when the world quiets down.",
    traits: ["curious", "driven"],
  },
};

test("progress upserts the transcript and bumps the state version", async () => {
  const userId = await createUser(db);
  const c = caller(userId);

  const first = await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  const second = await c.sessions.progress({
    sessionId: "frostpeak",
    beat: 1,
    answers: ["night owl", "work"],
  });
  expect(second.stateVersion).toBeGreaterThan(first.stateVersion);

  const rows = await db
    .select()
    .from(guidedSessions)
    .where(and(eq(guidedSessions.userId, userId), eq(guidedSessions.sessionId, "frostpeak")));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.beat).toBe(1);
  expect(rows[0]!.answers).toEqual(["night owl", "work"]);
  expect(rows[0]!.done).toBe(false);
});

test("progress rejects an unknown session and an out-of-range beat", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await expect(
    c.sessions.progress({ sessionId: "atlantis", beat: 0, answers: [] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    c.sessions.progress({ sessionId: "frostpeak", beat: frostpeak.beats.length, answers: [] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("progress after complete is rejected — a completed transcript is immutable", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: { fields: {}, notes: [] },
  });
  await expect(
    c.sessions.progress({ sessionId: "frostpeak", beat: 1, answers: ["night owl", "more"] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test("progress merges per index: a force-quit's empty-string prefix never wipes stored answers", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  // three real answers land before the force-quit
  await c.sessions.progress({
    sessionId: "frostpeak",
    beat: 3,
    answers: ["night owl", "rockets", "big city"],
  });
  // on relaunch the client no longer holds the earlier beats, so it replays them
  // as empty strings alongside the new answer — those blanks must not overwrite
  await c.sessions.progress({
    sessionId: "frostpeak",
    beat: 3,
    answers: ["", "", "", "roommates"],
  });

  const rows = await db
    .select()
    .from(guidedSessions)
    .where(and(eq(guidedSessions.userId, userId), eq(guidedSessions.sessionId, "frostpeak")));
  expect(rows[0]!.answers).toEqual(["night owl", "rockets", "big city", "roommates"]);
});

test("progress lets a genuine non-empty edit overwrite the stored answer at that index", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 1, answers: ["night owl", "rockets"] });
  await c.sessions.progress({ sessionId: "frostpeak", beat: 1, answers: ["morning person", "rockets"] });

  const rows = await db
    .select()
    .from(guidedSessions)
    .where(and(eq(guidedSessions.userId, userId), eq(guidedSessions.sessionId, "frostpeak")));
  expect(rows[0]!.answers).toEqual(["morning person", "rockets"]);
});

test("ack builds its context from the STORED beat's scripted ask, not client text", async () => {
  const userId = await createUser(db);
  const { model, prompts } = capturingModel("oh a rocket person, love that");
  const c = caller(userId, model);

  await c.sessions.progress({
    sessionId: "frostpeak",
    beat: 2,
    answers: ["night owl", "work", "i design rockets"],
  });
  const ack = await c.sessions.ack({
    sessionId: "frostpeak",
    answer: "i design rockets",
    probe: true,
  });
  expect(ack).toEqual({ text: "oh a rocket person, love that" });

  expect(prompts).toHaveLength(1);
  // the ask is beat 2's scripted lines from core, joined — the client never sent them
  expect(prompts[0]).toContain("so what do you do? and like, what do you actually DO day to day");
  expect(prompts[0]).toContain("they answered: i design rockets");
  // beat 2 allows a probe and frostpeak isn't sensitive, so the probe survives
  expect(prompts[0]).toContain("then ask ONE short follow-up question about it");
});

test("ack clamps the probe by the script's rules and softens sensitive sessions", async () => {
  const userId = await createUser(db);
  const noProbe = capturingModel("nice");
  await caller(userId, noProbe.model).sessions.progress({
    sessionId: "frostpeak",
    beat: 0,
    answers: ["night owl"],
  });
  // beat 0 has no probe flag — a client-requested probe is ignored
  await caller(userId, noProbe.model).sessions.ack({
    sessionId: "frostpeak",
    answer: "night owl",
    probe: true,
  });
  expect(noProbe.prompts[0]).toContain("do NOT ask a question");

  const sensitive = capturingModel("that sounds like home");
  await caller(userId, sensitive.model).sessions.progress({
    sessionId: "blossom",
    beat: 0,
    answers: ["small town ohio"],
  });
  await caller(userId, sensitive.model).sessions.ack({
    sessionId: "blossom",
    answer: "small town ohio",
    probe: true,
  });
  expect(sensitive.prompts[0]).toContain("the topic is personal: be gentle");
  expect(sensitive.prompts[0]).toContain("do NOT ask a question");
});

test("ack returns null text on LLM failure and rejects without stored progress", async () => {
  const userId = await createUser(db);
  const c = caller(userId, failingModel());
  await expect(
    c.sessions.ack({ sessionId: "frostpeak", answer: "hello" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });

  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  const ack = await c.sessions.ack({ sessionId: "frostpeak", answer: "night owl" });
  expect(ack).toEqual({ text: null });
});

test("extract runs over server-stored answers — a forged client can't inject transcript", async () => {
  const userId = await createUser(db);
  const { model, prompts } = capturingModel(JSON.stringify(EXTRACTION_REPLY));
  const c = caller(userId, model);

  await c.sessions.progress({
    sessionId: "frostpeak",
    beat: 1,
    answers: ["definitely a night owl", "work mostly"],
  });
  const result = await c.sessions.extract({ sessionId: "frostpeak" });
  expect(result).toEqual({
    fields: EXTRACTION_REPLY.fields,
    notes: EXTRACTION_REPLY.notes,
    recap: EXTRACTION_REPLY.recap,
    analysis: EXTRACTION_REPLY.analysis,
  });

  // the transcript pairs core's scripted asks with the STORED answers
  expect(prompts[0]).toContain("q: morning person or night owl? be honest");
  expect(prompts[0]).toContain("a: definitely a night owl");
  expect(prompts[0]).toContain("a: work mostly");
  // the schema lines come from core's catalog for this session
  expect(prompts[0]).toContain("chronotype, occupation_type, occupation");
});

test("extract re-runs with recap corrections appended to the transcript", async () => {
  const userId = await createUser(db);
  const { model, prompts } = capturingModel(JSON.stringify(EXTRACTION_REPLY));
  const c = caller(userId, model);

  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  await c.sessions.extract({
    sessionId: "frostpeak",
    corrections: ["actually i said morning person"],
  });
  expect(prompts[0]).toContain(
    "correction from the user about your summary: actually i said morning person",
  );
});

test("extract feeds the prior profile digest from the database, not the client", async () => {
  const userId = await createUser(db);
  const first = capturingModel(JSON.stringify(EXTRACTION_REPLY));
  const c = caller(userId, first.model);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: {
      fields: { chronotype: "night owl" },
      notes: [{ tag: "weekday_note", text: "garage lab" }],
      astral: EXTRACTION_REPLY.analysis,
    },
  });

  const second = capturingModel(JSON.stringify(EXTRACTION_REPLY));
  const c2 = caller(userId, second.model);
  await c2.sessions.progress({ sessionId: "pinewood", beat: 0, answers: ["lofi and factorio"] });
  await c2.sessions.extract({ sessionId: "pinewood" });

  expect(second.prompts[0]).toContain("what you ALREADY know about them from earlier star chats");
  expect(second.prompts[0]).toContain("chronotype: night owl");
  expect(second.prompts[0]).toContain("weekday_note: garage lab");
  expect(second.prompts[0]).toContain("archetype: the midnight builder");
  // and marks the astral card as an update over the existing one
  expect(second.prompts[0]).toContain("this is an UPDATE");
});

test("extract sanitizes the analysis: archetype capped on a word boundary, traits cleaned", async () => {
  const userId = await createUser(db);
  const reply = {
    ...EXTRACTION_REPLY,
    analysis: {
      archetype: "the perpetually overthinking midnight cartographer of everything",
      reading: "",
      traits: [" curious ", "", "open", "driven", "warm", "extra"],
    },
  };
  const { model } = capturingModel(JSON.stringify(reply));
  const c = caller(userId, model);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  const result = await c.sessions.extract({ sessionId: "frostpeak" });
  expect(result?.analysis).toEqual({
    archetype: "the perpetually overthinking midnight",
    // a blank reading falls back, the card itself survives
    reading:
      "i'm still learning your constellation, but i can already tell there's a lot up there worth mapping. the more we talk, the brighter it all gets. ✦",
    traits: ["curious", "open", "driven", "warm"],
  });
});

test("extract returns null analysis when the model omits the archetype", async () => {
  const userId = await createUser(db);
  const reply = { ...EXTRACTION_REPLY, analysis: { reading: "hm", traits: ["nice"] } };
  const { model } = capturingModel(JSON.stringify(reply));
  const c = caller(userId, model);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  const result = await c.sessions.extract({ sessionId: "frostpeak" });
  expect(result?.analysis).toBeNull();
});

test("extract returns null when the model fails — the client shows its scripted recap", async () => {
  const userId = await createUser(db);
  const c = caller(userId, failingModel());
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  const result = await c.sessions.extract({ sessionId: "frostpeak" });
  expect(result).toBeNull();
});

test("complete persists the extraction and pays bond + coins from core's catalog", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.sessions.progress({
    sessionId: "frostpeak",
    beat: 5,
    answers: ["night owl", "work", "rockets", "big city", "roommates", "coffee then chaos"],
  });

  const before = await userRow(userId);
  const result = await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: {
      fields: { chronotype: "night owl", occupation: "rocket design" },
      notes: [{ tag: "weekday_note", text: "coffee then chaos" }],
      astral: EXTRACTION_REPLY.analysis,
    },
  });

  expect(result.coins).toBe(before.coins + frostpeak.coins);
  expect(result.bond).toBe(before.bond + frostpeak.bond);
  expect(result.astral).toEqual(EXTRACTION_REPLY.analysis);
  expect(result.stateVersion).toBeGreaterThan(before.stateVersion);

  const rows = await sessionLedgerRows(userId);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.dedupeKey).toBe("session:frostpeak");
  expect(rows[0]!.coins).toBe(frostpeak.coins);

  const session = await db
    .select()
    .from(guidedSessions)
    .where(and(eq(guidedSessions.userId, userId), eq(guidedSessions.sessionId, "frostpeak")));
  expect(session[0]!.done).toBe(true);
  expect(session[0]!.beat).toBe(frostpeak.beats.length);
  expect(session[0]!.completedAt).not.toBeNull();
  // the transcript survives completion untouched
  expect(session[0]!.answers).toEqual([
    "night owl",
    "work",
    "rockets",
    "big city",
    "roommates",
    "coffee then chaos",
  ]);

  const profile = await c.sessions.profile();
  expect(profile.fields).toEqual({ chronotype: "night owl", occupation: "rocket design" });
  expect(profile.notes).toHaveLength(1);
  expect(profile.notes[0]).toMatchObject({
    tag: "weekday_note",
    text: "coffee then chaos",
    session: "frostpeak",
  });
  expect(profile.astral).toEqual(EXTRACTION_REPLY.analysis);
});

test("re-complete is a safe no-op: no double coins, bond, notes, or version bump", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  const first = await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: {
      fields: { chronotype: "night owl" },
      notes: [{ tag: "weekday_note", text: "chaos" }],
      astral: EXTRACTION_REPLY.analysis,
    },
  });
  const replay = await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: {
      fields: { chronotype: "morning person" },
      notes: [{ tag: "weekday_note", text: "forged" }],
      astral: { archetype: "the forger", reading: "nope", traits: ["fake"] },
    },
  });
  expect(replay).toEqual(first);

  const rows = await sessionLedgerRows(userId);
  expect(rows).toHaveLength(1);
  const notes = await db.select().from(sessionNotes).where(eq(sessionNotes.userId, userId));
  expect(notes).toHaveLength(1);
  expect(notes[0]!.text).toBe("chaos");
  const profile = await c.sessions.profile();
  expect(profile.fields.chronotype).toBe("night owl");
  expect(profile.astral?.archetype).toBe("the midnight builder");
});

test("rewards come from the catalog even when the payload smuggles inflated values", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  // the input schema carries no reward fields; extra keys are stripped, not obeyed
  const forged = {
    sessionId: "frostpeak",
    extraction: { fields: {}, notes: [] },
    coins: 999999,
    bond: 100,
  };
  const before = await userRow(userId);
  const result = await c.sessions.complete(forged);
  expect(result.coins).toBe(before.coins + frostpeak.coins);
  expect(result.bond).toBe(before.bond + frostpeak.bond);
  const rows = await sessionLedgerRows(userId);
  expect(rows[0]!.coins).toBe(frostpeak.coins);
});

test("complete clamps bond at 100 and re-applies the archetype cap on forged cards", async () => {
  const userId = await createUser(db);
  await db.update(users).set({ bond: 98 }).where(eq(users.id, userId));
  const c = caller(userId);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  const result = await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: {
      fields: {},
      notes: [],
      astral: {
        archetype: "the perpetually overthinking midnight cartographer of everything",
        reading: "long story",
        traits: ["a", "b", "c", "d", "e", "f"],
      },
    },
  });
  expect(result.bond).toBe(100);
  expect(result.astral?.archetype).toBe("the perpetually overthinking midnight");
  expect(result.astral?.traits).toEqual(["a", "b", "c", "d"]);
});

test("complete without a new card leaves the earned astral untouched", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  await c.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["night owl"] });
  await c.sessions.complete({
    sessionId: "frostpeak",
    extraction: { fields: {}, notes: [], astral: EXTRACTION_REPLY.analysis },
  });
  await c.sessions.progress({ sessionId: "pinewood", beat: 0, answers: ["lofi"] });
  const result = await c.sessions.complete({
    sessionId: "pinewood",
    extraction: { fields: {}, notes: [] },
  });
  expect(result.astral).toEqual(EXTRACTION_REPLY.analysis);
});

test("every session's catalog payout lands in the 25-40 coin band from token-economy", () => {
  for (const def of SESSIONS) {
    expect(def.coins).toBeGreaterThanOrEqual(25);
    expect(def.coins).toBeLessThanOrEqual(40);
  }
  expect(sessionFor("frostpeak")!.coins).toBe(25);
  expect(sessionFor("ember")!.coins).toBe(40);
});

test("sessions are isolated per user — no cross-user reads or writes", async () => {
  const alice = await createUser(db);
  const bob = await createUser(db);
  const a = caller(alice);
  await a.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["secret answer"] });
  await a.sessions.complete({
    sessionId: "frostpeak",
    extraction: {
      fields: { chronotype: "night owl" },
      notes: [{ tag: "weekday_note", text: "private" }],
      astral: EXTRACTION_REPLY.analysis,
    },
  });

  const b = caller(bob, capturingModel(JSON.stringify(EXTRACTION_REPLY)).model);
  // bob has no frostpeak transcript — extract and ack have nothing to read
  await expect(b.sessions.extract({ sessionId: "frostpeak" })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    b.sessions.ack({ sessionId: "frostpeak", answer: "hi" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  // and bob can still run (and be paid for) his own frostpeak
  await b.sessions.progress({ sessionId: "frostpeak", beat: 0, answers: ["morning person"] });
  const bobResult = await b.sessions.complete({
    sessionId: "frostpeak",
    extraction: { fields: {}, notes: [] },
  });
  expect(bobResult.astral).toBeNull();

  const bobProfile = await b.sessions.profile();
  expect(bobProfile.fields).toEqual({});
  expect(bobProfile.notes).toEqual([]);
  expect(bobProfile.astral).toBeNull();

  const aliceProfile = await a.sessions.profile();
  expect(aliceProfile.fields).toEqual({ chronotype: "night owl" });
});
