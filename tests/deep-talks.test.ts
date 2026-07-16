import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  type Database,
  ledger,
  memories,
  messages,
  users,
} from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  CONTEXT_SCORE_TABLE,
  DEEP_TALKS,
  activeDeepTalk,
  allTools,
  buildContextView,
  computeContextScore,
  contextBand,
  crossedBands,
  renderSystem,
} from "@sidekick/shared";
import {
  CONTEXT_BAND_REWARD_COINS,
  commitChatGptImport,
  completedDeepTalkSlugs,
  recomputeContextScore,
  settleDeepTalks,
  stageChatGptImport,
  startDeepTalk,
} from "@sidekick/server";
import { generateModel, makeCaller, objectModel, textModel, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

let deviceSeq = 0;
async function freshUser(): Promise<string> {
  deviceSeq += 1;
  const userId = await createUser(db);
  return userId;
}

async function seedMemories(userId: string, kind: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await db.insert(memories).values({
      userId,
      kind: kind as (typeof memories.kind.enumValues)[number],
      content: `${kind} fact ${i} for ${userId}`,
      source: "extraction",
    });
  }
}

test("catalog integrity: 8 talks, unique slugs, 4-6 beats, sane thresholds", () => {
  expect(DEEP_TALKS.length).toBe(8);
  const slugs = DEEP_TALKS.map((t) => t.slug);
  expect(new Set(slugs).size).toBe(slugs.length);

  const freeCount = DEEP_TALKS.filter((t) => t.unlockAtScore === 0).length;
  expect(freeCount).toBe(3);

  for (const talk of DEEP_TALKS) {
    expect(talk.beats.length).toBeGreaterThanOrEqual(4);
    expect(talk.beats.length).toBeLessThanOrEqual(6);
    expect(talk.beats.every((b) => b.trim().length > 0)).toBe(true);
    expect(talk.title.length).toBeGreaterThan(0);
    expect(talk.teaser.length).toBeGreaterThan(0);
    expect(talk.emoji.length).toBeGreaterThan(0);
    expect(talk.targetKinds.length).toBeGreaterThan(0);
    expect(talk.unlockAtScore).toBeGreaterThanOrEqual(0);
    expect(talk.unlockAtScore).toBeLessThanOrEqual(100);
  }
  // Thresholds only ever rise across the ladder.
  const thresholds = DEEP_TALKS.map((t) => t.unlockAtScore);
  const sorted = [...thresholds].sort((a, b) => a - b);
  expect(thresholds).toEqual(sorted);
});

test("score formula matches the plan table: weights sum to 1, empty=0, caps clamp, full=100", () => {
  const weightSum = Object.values(CONTEXT_SCORE_TABLE).reduce((s, e) => s + e.weight, 0);
  expect(weightSum).toBeCloseTo(1, 5);

  expect(computeContextScore({})).toBe(0);

  // One kind, partial: relationship 3 of cap 6 → 0.16 * 0.5 = 0.08 → 8.
  expect(computeContextScore({ relationship: 3 })).toBe(8);

  // Over the cap clamps to the cap's contribution (identity cap 4 → 0.14 → 14).
  expect(computeContextScore({ identity: 99 })).toBe(14);

  // Every kind at its cap → exactly 100.
  const full: Record<string, number> = {};
  for (const [kind, { cap }] of Object.entries(CONTEXT_SCORE_TABLE)) {
    full[kind] = cap;
  }
  expect(computeContextScore(full)).toBe(100);
});

test("crossedBands reports only newly-reached 25-pt bands, never backwards", () => {
  expect(crossedBands(0, 30)).toEqual([25]);
  expect(crossedBands(24, 76)).toEqual([25, 50, 75]);
  expect(crossedBands(50, 50)).toEqual([]);
  expect(crossedBands(80, 40)).toEqual([]);
});

test("contextBand lines key off the score band", () => {
  expect(contextBand(0).line).toContain("just getting started");
  expect(contextBand(30).line).toContain("getting somewhere");
  expect(contextBand(60).line).toContain("besties");
  expect(contextBand(90).line).toContain("scary");
});

test("recompute never decreases and grants the band coins on crossing 25", async () => {
  const userId = await freshUser();

  // identity(4)=14 + relationship(6)=16 => 30, crosses the 25 band.
  await seedMemories(userId, "identity", 4);
  await seedMemories(userId, "relationship", 6);
  const first = await recomputeContextScore(db, userId);
  expect(first.score).toBe(30);
  expect(first.unlockedBands).toEqual([25]);

  const bandReward = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, "context-band:25")));
  expect(bandReward).toHaveLength(1);
  expect(bandReward[0]).toMatchObject({
    source: "event",
    kind: "coins",
    coins: CONTEXT_BAND_REWARD_COINS,
  });
  const funded = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId));
  expect(funded[0]?.coins).toBe(CONTEXT_BAND_REWARD_COINS);

  // Delete every memory; the score must not fall (compaction-safe clamp).
  await db.update(memories).set({ status: "deleted" }).where(eq(memories.userId, userId));
  const second = await recomputeContextScore(db, userId);
  expect(second.score).toBe(30);
  expect(second.unlockedBands).toEqual([]);
});

test("start injects beats into context; completing clears the session and pays out", async () => {
  const userId = await freshUser();
  const { conversationId } = await startDeepTalk(db, userId, "your-people");

  const beforeUser = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId));
  const coinsBefore = beforeUser[0]?.coins ?? 0;

  // The active deep talk's beats are injected in the dynamic region of the prompt.
  const active = await activeDeepTalk(db, conversationId);
  expect(active?.slug).toBe("your-people");
  const view = await buildContextView(db, conversationId, {});
  const rendered = renderSystem(view.system);
  expect(rendered).toContain("ACTIVE DEEP TALK: your people");
  expect(rendered).toContain("complete_deep_talk");
  expect(view.system.some((b) => b.id === "deep_talk")).toBe(true);

  // A user turn the extractor will later mine.
  await db.insert(messages).values({
    conversationId,
    role: "user",
    content: "my roommate priya and i have lived together for years",
    tokenEstimate: 12,
  });

  // The model completes the talk via the tool.
  const completeTool = allTools.find((t) => t.name === "complete_deep_talk");
  const toolResult = await completeTool?.execute?.(
    { slug: "your-people" },
    { db, userId, conversationId },
  );
  expect(toolResult).toMatchObject({ ok: true, slug: "your-people" });

  // Session is cleared immediately — the injected beats block is gone from context.
  expect(await activeDeepTalk(db, conversationId)).toBeNull();
  const clearedView = await buildContextView(db, conversationId, {});
  expect(clearedView.system.some((b) => b.id === "deep_talk")).toBe(false);
  expect(renderSystem(clearedView.system)).not.toContain("ACTIVE DEEP TALK: your people");

  // Settling runs the immediate extraction, recompute, and reward grant.
  const model = objectModel({
    ops: [{ op: "add", kind: "relationship", content: "lives with roommate priya", confidence: "stated" }],
  });
  const settled = await settleDeepTalks(db, model, conversationId, userId);
  expect(settled.applied).toBe(1);

  const mems = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")));
  expect(mems.some((m) => m.content === "lives with roommate priya")).toBe(true);

  const reward = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, "deep-talk:your-people")));
  expect(reward).toHaveLength(1);
  const afterUser = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId));
  expect((afterUser[0]?.coins ?? 0)).toBeGreaterThan(coinsBefore);

  // Idempotent: settling again grants nothing new.
  await settleDeepTalks(db, objectModel({ ops: [] }), conversationId, userId);
  const rewardAgain = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, "deep-talk:your-people")));
  expect(rewardAgain).toHaveLength(1);
});

test("completedDeepTalkSlugs reads slugs off a persisted assistant message", () => {
  expect(
    completedDeepTalkSlugs([
      { toolName: "log_checkin", input: { goal_id: "g" } },
      { toolName: "complete_deep_talk", input: { slug: "taste-check" } },
    ]),
  ).toEqual(["taste-check"]);
  expect(completedDeepTalkSlugs(null)).toEqual([]);
  expect(completedDeepTalkSlugs([{ toolName: "complete_deep_talk", input: {} }])).toEqual([]);
});

test("locked deep talks reject start and read as locked on the shelf", async () => {
  const userId = await freshUser();
  const caller = makeCaller(db, textModel("ok"), userId);

  const shelf = await caller.deepTalks.shelf();
  const dreamBig = shelf.talks.find((t) => t.slug === "dream-big");
  expect(dreamBig?.unlocked).toBe(false);
  const yourPeople = shelf.talks.find((t) => t.slug === "your-people");
  expect(yourPeople?.unlocked).toBe(true);

  await expect(startDeepTalk(db, userId, "dream-big")).rejects.toThrow(/locked/);
});

test("import stages candidates, commits only the checked subset, and reacts", async () => {
  const userId = await freshUser();

  const stageModel = objectModel({
    ops: [
      { op: "add", kind: "event", content: "ran the chicago marathon in 2023", confidence: "stated" },
      { op: "add", kind: "interest", content: "really into bouldering", confidence: "stated" },
      { op: "add", kind: "work_school", content: "works as a product designer", confidence: "stated" },
    ],
  });
  const candidates = await stageChatGptImport(db, stageModel, userId, "here is what i remember...");
  expect(candidates).toHaveLength(3);
  // Nothing is written at the staging step.
  const preCommit = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(preCommit).toHaveLength(0);

  // The user unchecks the middle one; commit writes only the two kept.
  const chosen = [candidates[0]!, candidates[2]!];
  const reactModel = generateModel("wait, a MARATHON?? we need to talk about this");
  const result = await commitChatGptImport(db, reactModel, userId, chosen);
  expect(result.added).toBe(2);
  expect(result.reaction).toContain("MARATHON");

  const stored = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")));
  expect(stored).toHaveLength(2);
  expect(stored.every((m) => m.source === "import")).toBe(true);
  expect(stored.some((m) => m.content.includes("bouldering"))).toBe(false);

  // The reaction landed as an assistant message in the thread.
  const assistantMsgs = await db
    .select()
    .from(messages)
    .where(eq(messages.role, "assistant"));
  expect(assistantMsgs.some((m) => m.content.includes("MARATHON"))).toBe(true);
});

test("import dedups a candidate that duplicates an existing memory on commit", async () => {
  const userId = await freshUser();
  await db.insert(memories).values({
    userId,
    kind: "interest",
    content: "loves matcha lattes",
    source: "extraction",
  });

  const dupeModel = objectModel({
    ops: [
      { op: "add", kind: "interest", content: "Loves  matcha  lattes", confidence: "stated" },
      { op: "add", kind: "interest", content: "collects vinyl records", confidence: "stated" },
    ],
  });
  const candidates = await stageChatGptImport(db, dupeModel, userId, "text");
  // Staging already drops the duplicate of an active memory.
  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.content).toContain("vinyl");

  const result = await commitChatGptImport(db, generateModel("nice"), userId, candidates);
  expect(result.added).toBe(1);
});
