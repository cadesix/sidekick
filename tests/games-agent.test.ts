import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { type Database, gameMatches, messages } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { type CupPongState, cupPong, cupPongStateSchema } from "@sidekick/core";
import {
  type GamesContextView,
  type SidekickTool,
  allTools,
  gamesContext,
  renderGamesBlock,
} from "@sidekick/shared";
import { createConversation, createUser, generateModel, makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const CUP_FLICK = { x: 0, power: 0.5 };
const NOW = new Date("2026-07-17T12:00:00Z");
const YESTERDAY = new Date("2026-07-16T12:00:00Z");

function inviteGame(): SidekickTool {
  const tool = allTools.find((t) => t.name === "invite_game");
  if (!tool?.execute) throw new Error("invite_game tool not registered");
  return tool;
}

function cupUserWon(): CupPongState {
  return { ...cupPong.initialState("user"), cups: { user: cupPong.ALL_CUPS, sidekick: 0 }, winner: "user" };
}

test("renderGamesBlock: nothing to say renders no block", () => {
  const view: GamesContextView = { timezone: "UTC", active: null, lastMatch: null, record: [] };
  expect(renderGamesBlock(view, NOW)).toBe("");
});

test("renderGamesBlock: the active match is one line with the standing", () => {
  const view: GamesContextView = {
    timezone: "UTC",
    active: { gameType: "cup_pong", toMove: "user", scores: { user: 3, sidekick: 6 } },
    lastMatch: null,
    record: [],
  };
  expect(renderGamesBlock(view, NOW)).toBe(
    "=== GAMES ===\nactive: cup pong, user's move, sidekick leads 6 cups to 3",
  );
});

test("renderGamesBlock: last match + record, with a single highlight and relative day", () => {
  const view: GamesContextView = {
    timezone: "UTC",
    active: null,
    lastMatch: {
      gameType: "eight_ball",
      outcome: "user_won",
      completedAt: YESTERDAY,
      highlights: ["ran_3_plus"],
    },
    record: [
      { gameType: "eight_ball", user: 3, sidekick: 2 },
      { gameType: "cup_pong", user: 1, sidekick: 4 },
    ],
  };
  expect(renderGamesBlock(view, NOW)).toBe(
    "=== GAMES ===\n" +
      "last match: 8 ball, user won, yesterday (highlight: ran 3+ in a row)\n" +
      "record: 8 ball 3–2 user · cup pong 1–4 sidekick",
  );
});

test("renderGamesBlock: a resigned last match reads 'user resigned' with no highlights", () => {
  const view: GamesContextView = {
    timezone: "UTC",
    active: null,
    lastMatch: { gameType: "cup_pong", outcome: "user_resigned", completedAt: NOW, highlights: [] },
    record: [{ gameType: "cup_pong", user: 0, sidekick: 1 }],
  };
  expect(renderGamesBlock(view, NOW)).toBe(
    "=== GAMES ===\nlast match: cup pong, user resigned, today\nrecord: cup pong 0–1 sidekick",
  );
});

test("renderGamesBlock: at most two highlights surface", () => {
  const view: GamesContextView = {
    timezone: "UTC",
    active: null,
    lastMatch: {
      gameType: "eight_ball",
      outcome: "user_won",
      completedAt: NOW,
      highlights: ["clean_sweep", "ran_3_plus", "comeback_from_3_down"],
    },
    record: [],
  };
  expect(renderGamesBlock(view, NOW)).toContain("(highlights: clean sweep, ran 3+ in a row)");
});

test("gamesContext: null for a user who has never played", async () => {
  const userId = await createUser(db);
  expect(await gamesContext(db, userId)).toBeNull();
});

test("gamesContext: an active match becomes the active line; a win becomes last match + record", async () => {
  const userId = await createUser(db);
  const c = makeCaller(db, textModel("ok"), userId);
  const match = await c.games.create({ gameType: "cup_pong" });

  const active = await gamesContext(db, userId);
  expect(active?.active).toMatchObject({ gameType: "cup_pong", toMove: "user" });
  expect(active?.lastMatch).toBeNull();

  await c.games.turn({ matchId: match.matchId, turnNo: 2, shots: [CUP_FLICK], state: cupUserWon(), events: [] });

  const done = await gamesContext(db, userId);
  expect(done?.active).toBeNull();
  expect(done?.lastMatch?.outcome).toBe("user_won");
  expect(done?.record).toContainEqual({ gameType: "cup_pong", user: 1, sidekick: 0 });
});

test("invite_game: creates a sidekick-initiated match with a card, user to break", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const res = await inviteGame().execute!(
    { gameType: "cup_pong", prompted: true },
    { db, userId, conversationId },
  );
  expect(res).toMatchObject({ ok: true });

  const rows = await db.select().from(gameMatches).where(eq(gameMatches.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.initiator).toBe("sidekick");
  expect(rows[0]!.turnNo).toBe(0);
  expect(cupPongStateSchema.parse(rows[0]!.state).toMove).toBe("user");

  const cards = await db.select().from(messages).where(eq(messages.gameMatchId, rows[0]!.id));
  expect(cards).toHaveLength(1);
  expect(cards[0]!.role).toBe("assistant");
  expect(cards[0]!.content).toBe("");
});

test("invite_game: refuses when a match of that game is already active", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx = { db, userId, conversationId };
  await inviteGame().execute!({ gameType: "eight_ball", prompted: true }, ctx);

  const res = await inviteGame().execute!({ gameType: "eight_ball", prompted: false }, ctx);
  expect(res).toMatchObject({ ok: false });
});

test("invite_game: unprompted invites are capped at one per local day", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx = { db, userId, conversationId };

  const first = await inviteGame().execute!({ gameType: "cup_pong", prompted: false }, ctx);
  expect(first).toMatchObject({ ok: true });
  const second = await inviteGame().execute!({ gameType: "eight_ball", prompted: false }, ctx);
  expect(second).toMatchObject({ ok: false, reason: "already offered a game today" });
});

test("invite_game: an unanswered invite backs off future unprompted asks", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  await db.insert(gameMatches).values({
    userId,
    conversationId,
    gameType: "cup_pong",
    initiator: "sidekick",
    status: "expired",
    state: cupPong.initialState("user"),
    turnNo: 0,
    seed: 1,
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
  });

  const res = await inviteGame().execute!(
    { gameType: "eight_ball", prompted: false },
    { db, userId, conversationId },
  );
  expect(res).toMatchObject({ ok: false, reason: "last invite went unanswered" });
});

test("invite_game: a prompted invite bypasses the daily cap", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);
  const ctx = { db, userId, conversationId };

  await inviteGame().execute!({ gameType: "cup_pong", prompted: false }, ctx);
  const res = await inviteGame().execute!({ gameType: "eight_ball", prompted: true }, ctx);
  expect(res).toMatchObject({ ok: true });
});

test("reaction: completing a match inserts one non-empty assistant message into the conversation", async () => {
  const userId = await createUser(db);
  const c = makeCaller(db, generateModel("gg wp"), userId);
  const match = await c.games.create({ gameType: "cup_pong" });
  await c.games.turn({ matchId: match.matchId, turnNo: 2, shots: [CUP_FLICK], state: cupUserWon(), events: [] });

  const rows = await db
    .select({ conversationId: gameMatches.conversationId })
    .from(gameMatches)
    .where(eq(gameMatches.id, match.matchId))
    .limit(1);
  const conversationId = rows[0]!.conversationId;

  const assistantRows = await db
    .select({ content: messages.content, gameMatchId: messages.gameMatchId })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "assistant")));
  const reactions = assistantRows.filter((row) => row.content.length > 0);
  expect(reactions).toHaveLength(1);
  expect(reactions[0]!.content).toBe("gg wp");
  expect(reactions[0]!.gameMatchId).toBeNull();
});
