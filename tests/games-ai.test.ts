import { expect, test } from "vitest";
import {
  DIFFICULTY,
  cupPong,
  cupPongFlickSchema,
  cupPongStateSchema,
  eightBall,
  eightBallShotSchema,
  eightBallStateSchema,
  gaussian,
  mulberry32,
  type EightBallShot,
  type EightBallState,
  type GameActor,
  type Rng,
} from "@sidekick/core";

const { BALL_R, TABLE_W, TABLE_L } = eightBall;

/** A seeded mid-game state: random non-overlapping positions, random pocketed subsets. */
function randomEightBallState(seed: number): EightBallState {
  const rng = mulberry32(seed);
  const placed: { x: number; y: number }[] = [];
  const roll = (): { x: number; y: number } => {
    for (;;) {
      const p = { x: 0.08 + rng() * (TABLE_W - 0.16), y: 0.08 + rng() * (TABLE_L - 0.16) };
      if (placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= BALL_R * 2 + 0.002)) {
        placed.push(p);
        return p;
      }
    }
  };
  const balls = Array.from({ length: 16 }, () => ({ x: 0, y: 0, pocketed: true }));
  let potsSeen = 0;
  for (let id = 1; id < 16; id++) {
    if (id !== 8 && rng() < 0.4) {
      potsSeen++;
      continue;
    }
    balls[id] = { ...roll(), pocketed: false };
  }
  const ballInHand = rng() < 0.25;
  const cuePocketed = ballInHand && rng() < 0.5;
  if (!cuePocketed) balls[0] = { ...roll(), pocketed: false };
  let userGroup: EightBallState["userGroup"] = null;
  if (potsSeen > 0) {
    userGroup = rng() < 0.5 ? "solids" : "stripes";
  }
  return {
    version: 1,
    balls,
    userGroup,
    toMove: "sidekick",
    ballInHand,
    winner: null,
    lastTurn: null,
  };
}

test("eight ball: chooseShot returns legal shots across 100 seeded states", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const state = randomEightBallState(seed);
    const shot = eightBall.chooseShot(state, mulberry32(seed * 31));
    expect(() => eightBallShotSchema.parse(shot)).not.toThrow();
    if (state.ballInHand) {
      expect(shot.cuePlace).not.toBeNull();
      expect(eightBall.isLegalCuePlacement(state, shot.cuePlace!)).toBe(true);
    }
    const res = eightBall.simulateShot(state, shot);
    expect(() => eightBallStateSchema.parse(res.finalState)).not.toThrow();
  }
});

test("eight ball: runSidekickTurn is deterministic for the same state + seed", () => {
  const state = eightBall.initialRack(5, "sidekick");
  const a = eightBall.runSidekickTurn(state, mulberry32(9));
  const b = eightBall.runSidekickTurn(state, mulberry32(9));
  expect(a.shots).toEqual(b.shots);
  expect(a.events).toEqual(b.events);
  expect(a.finalState).toEqual(b.finalState);
});

/** A valid in-play mask: `count` cups standing within the rack tier that count implies. */
function randomMask(rng: Rng): number {
  const count = 1 + Math.floor(rng() * 10);
  let width = 3;
  if (count >= 7) width = 10;
  else if (count >= 4) width = 6;
  const bits = Array.from({ length: width }, (_, i) => i);
  for (let i = bits.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = bits[i]!;
    bits[i] = bits[j]!;
    bits[j] = t;
  }
  let mask = 0;
  for (const bit of bits.slice(0, count)) mask |= 1 << bit;
  return mask;
}

test("cup pong: chooseThrow returns schema-legal flicks across 100 seeded states", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = mulberry32(seed);
    const state = {
      ...cupPong.initialState("sidekick"),
      cups: { user: randomMask(rng), sidekick: randomMask(rng) },
    };
    const flick = cupPong.chooseThrow(state, rng);
    expect(() => cupPongFlickSchema.parse(flick)).not.toThrow();
    const res = cupPong.throwOutcome(state, flick);
    expect(() => cupPongStateSchema.parse(res.finalState)).not.toThrow();
  }
});

test("cup pong: runSidekickTurn is deterministic for the same state + seed", () => {
  const state = cupPong.initialState("sidekick");
  expect(cupPong.runSidekickTurn(state, mulberry32(4))).toEqual(
    cupPong.runSidekickTurn(state, mulberry32(4)),
  );
});

/**
 * Scripted 8-ball baseline: ghost-ball aim at the (target, pocket) pair with
 * the shortest pot line, fixed power, fixed gaussian noise. No search.
 */
function baselineShot(state: EightBallState, rng: Rng): EightBallShot {
  let cuePlace: { x: number; y: number } | null = null;
  let cue = { x: state.balls[0]!.x, y: state.balls[0]!.y };
  if (state.ballInHand) {
    cuePlace = eightBall.findCueSpot(state);
    cue = cuePlace;
  }
  let best: { dirX: number; dirY: number; len: number } | null = null;
  for (const id of eightBall.legalTargets(state)) {
    const ball = state.balls[id]!;
    for (const pocket of eightBall.POCKETS) {
      const toPocket = Math.hypot(pocket.x - ball.x, pocket.y - ball.y);
      const px = (pocket.x - ball.x) / toPocket;
      const py = (pocket.y - ball.y) / toPocket;
      const ghost = { x: ball.x - px * BALL_R * 2, y: ball.y - py * BALL_R * 2 };
      const toGhost = Math.hypot(ghost.x - cue.x, ghost.y - cue.y);
      if (toGhost === 0) continue;
      const dirX = (ghost.x - cue.x) / toGhost;
      const dirY = (ghost.y - cue.y) / toGhost;
      if (dirX * px + dirY * py < 0.2) continue;
      if (best === null || toPocket + toGhost < best.len) {
        best = { dirX, dirY, len: toPocket + toGhost };
      }
    }
  }
  if (best === null) {
    const ball = state.balls[eightBall.legalTargets(state)[0]!]!;
    const d = Math.hypot(ball.x - cue.x, ball.y - cue.y);
    best = { dirX: (ball.x - cue.x) / d, dirY: (ball.y - cue.y) / d, len: d };
  }
  const noise = gaussian(rng) * 0.03;
  const nx = best.dirX - best.dirY * noise;
  const ny = best.dirY + best.dirX * noise;
  const len = Math.hypot(nx, ny);
  return { dirX: nx / len, dirY: ny / len, power: 0.65, spin: { x: 0, y: 0 }, cuePlace };
}

function playEightBallMatch(seed: number): GameActor | null {
  const rng = mulberry32(seed * 2654435761);
  let state = eightBall.initialRack(seed, seed % 2 === 0 ? "sidekick" : "user");
  for (let turn = 0; turn < 120 && state.winner === null; turn++) {
    if (state.toMove === "sidekick") {
      state = eightBall.runSidekickTurn(state, rng).finalState;
    } else {
      for (let s = 0; s < 12 && state.toMove === "user" && state.winner === null; s++) {
        state = eightBall.simulateShot(state, baselineShot(state, rng)).finalState;
      }
    }
  }
  return state.winner;
}

test("eight ball: sidekick AI lands in the 45-55% win band vs the scripted baseline", { timeout: 300_000 }, () => {
  let sidekick = 0;
  let decided = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const winner = playEightBallMatch(seed);
    if (winner === null) continue;
    decided++;
    if (winner === "sidekick") sidekick++;
  }
  expect(decided).toBeGreaterThanOrEqual(55);
  const rate = sidekick / decided;
  expect(rate).toBeGreaterThanOrEqual(0.45);
  expect(rate).toBeLessThanOrEqual(0.55);
});

/** Scripted cup-pong baseline: always the front-most cup, fixed gaussian spread. */
function baselineFlick(state: ReturnType<typeof cupPong.initialState>, rng: Rng) {
  const targetSide = state.toMove === "user" ? "sidekick" : "user";
  const cups = cupPong.cupPositions(state.cups[targetSide]);
  let target = cups[0]!;
  for (const cup of cups) {
    if (cup.y < target.y || (cup.y === target.y && Math.abs(cup.x) < Math.abs(target.x))) target = cup;
  }
  return cupPong.flickForLanding({
    x: target.x + gaussian(rng) * 0.052,
    y: target.y + gaussian(rng) * 0.052,
  });
}

function playCupPongMatch(seed: number): GameActor | null {
  const rng = mulberry32(seed * 2246822519);
  let state = cupPong.initialState(seed % 2 === 0 ? "sidekick" : "user");
  for (let turn = 0; turn < 400 && state.winner === null; turn++) {
    if (state.toMove === "sidekick") {
      state = cupPong.runSidekickTurn(state, rng).finalState;
    } else {
      for (let t = 0; t < 30 && state.toMove === "user" && state.winner === null; t++) {
        state = cupPong.throwOutcome(state, baselineFlick(state, rng)).finalState;
      }
    }
  }
  return state.winner;
}

test("cup pong: sidekick AI lands in the 45-55% win band vs the scripted baseline", () => {
  let sidekick = 0;
  let decided = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const winner = playCupPongMatch(seed);
    if (winner === null) continue;
    decided++;
    if (winner === "sidekick") sidekick++;
  }
  expect(decided).toBe(200);
  const rate = sidekick / decided;
  expect(rate).toBeGreaterThanOrEqual(0.45);
  expect(rate).toBeLessThanOrEqual(0.55);
});

test("difficulty profile stays the tuned v1 shape", () => {
  expect(DIFFICULTY.eightBall.aimSigma).toBeGreaterThan(0);
  expect(DIFFICULTY.eightBall.powerSigma).toBeGreaterThan(0);
  expect(DIFFICULTY.cupPong.sigma).toBeGreaterThan(0);
});
