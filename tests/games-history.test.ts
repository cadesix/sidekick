import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, gameMatches } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { cupPong, eightBallStateSchema } from "@sidekick/core";
import { createUser, makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function caller(userId: string) {
  return makeCaller(db, textModel("ok"), userId);
}

const CUP_FLICK = { x: 0, power: 0.5 };

test("history: game turn rows carry the card payload, latest marked on the newest row", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const conversation = await c.chat.mainConversation();
  const match = await c.games.create({ gameType: "cup_pong" });
  await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK],
    state: cupPong.initialState("sidekick"),
    events: [],
  });

  const history = await c.chat.history({ conversationId: conversation.id, limit: 50 });
  const gameRows = history.filter((row) => row.game !== null);
  // three cards: the sidekick break, the user's turn, the sidekick's reply
  expect(gameRows).toHaveLength(3);

  for (const row of gameRows) {
    expect(row.game).toMatchObject({
      matchId: match.matchId,
      gameType: "cup_pong",
      status: "active",
      yourMove: true,
      winner: null,
    });
    expect(row.game?.summary.cupsLeft).toEqual({
      user: expect.any(Number),
      sidekick: expect.any(Number),
    });
  }

  // history is newest-first, so exactly the first (newest) row is the latest card
  const latestFlags = gameRows.map((row) => row.game?.latest);
  expect(latestFlags).toEqual([true, false, false]);
});

test("history: a finished match reports its winner and your-move false", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const conversation = await c.chat.mainConversation();
  const match = await c.games.create({ gameType: "cup_pong" });
  await c.games.turn({
    matchId: match.matchId,
    turnNo: 2,
    shots: [CUP_FLICK],
    state: { ...cupPong.initialState("sidekick"), cups: { user: cupPong.ALL_CUPS, sidekick: 0 }, winner: "user" },
    events: [],
  });

  const history = await c.chat.history({ conversationId: conversation.id, limit: 50 });
  const latest = history.find((row) => row.game?.latest);
  expect(latest?.game).toMatchObject({
    status: "complete",
    winner: "user",
    yourMove: false,
  });
});

test("history: an 8-ball card summary carries balls-left and the assigned group", async () => {
  const userId = await createUser(db);
  const c = caller(userId);
  const conversation = await c.chat.mainConversation();
  const match = await c.games.create({ gameType: "eight_ball" });

  // stamp the stored state with an assigned group + a pot so the summary is meaningful
  const stored = await db.select().from(gameMatches).where(eq(gameMatches.id, match.matchId)).limit(1);
  const state = eightBallStateSchema.parse(stored[0]!.state);
  state.userGroup = "solids";
  state.balls[1]!.pocketed = true;
  await db.update(gameMatches).set({ state }).where(eq(gameMatches.id, match.matchId));

  const history = await c.chat.history({ conversationId: conversation.id, limit: 50 });
  const card = history.find((row) => row.game?.latest);
  expect(card?.game?.gameType).toBe("eight_ball");
  expect(card?.game?.summary.group).toBe("solids");
  expect(card?.game?.summary.ballsLeft).toEqual({ user: 6, sidekick: 7 });
});
