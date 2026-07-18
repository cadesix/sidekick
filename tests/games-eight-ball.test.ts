import { expect, test } from "vitest";
import {
  eightBall,
  eightBallStateSchema,
  mulberry32,
  type EightBallShot,
  type EightBallState,
} from "@sidekick/core";

const { BALL_R, POCKETS, HEAD_SPOT } = eightBall;

function shot(dirX: number, dirY: number, power: number, extra?: Partial<EightBallShot>): EightBallShot {
  return { dirX, dirY, power, spin: { x: 0, y: 0 }, cuePlace: null, ...extra };
}

/** Unit direction from a toward b. */
function aim(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return { x: dx / d, y: dy / d };
}

/** A state where only the listed balls are on the table, everything else pocketed. */
function makeState(opts: {
  cue?: { x: number; y: number };
  cuePocketed?: boolean;
  balls: Record<number, { x: number; y: number }>;
  userGroup?: "solids" | "stripes" | null;
  toMove?: "user" | "sidekick";
  ballInHand?: boolean;
}): EightBallState {
  const balls = Array.from({ length: 16 }, () => ({ x: 0, y: 0, pocketed: true }));
  balls[0] = opts.cuePocketed
    ? { x: 0, y: 0, pocketed: true }
    : { ...(opts.cue ?? HEAD_SPOT), pocketed: false };
  for (const [id, pos] of Object.entries(opts.balls)) {
    balls[Number(id)] = { ...pos, pocketed: false };
  }
  return {
    version: 1,
    balls,
    userGroup: opts.userGroup ?? null,
    toMove: opts.toMove ?? "user",
    ballInHand: opts.ballInHand ?? false,
    winner: null,
    lastTurn: null,
  };
}

test("initialRack: cue on the head spot, 8 in the rack center, no overlaps, seed shuffles ids", () => {
  const a = eightBall.initialRack(1);
  expect(a.balls).toHaveLength(16);
  expect(a.balls.every((b) => !b.pocketed)).toBe(true);
  expect(a.balls[0]).toEqual({ ...HEAD_SPOT, pocketed: false });
  expect(a.userGroup).toBeNull();
  expect(a.winner).toBeNull();
  for (let i = 1; i < 16; i++) {
    const bi = a.balls[i]!;
    for (let j = i + 1; j < 16; j++) {
      const bj = a.balls[j]!;
      const dx = bi.x - bj.x;
      const dy = bi.y - bj.y;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(BALL_R * 2 - 1e-9);
    }
    expect(bi.x).toBeGreaterThan(BALL_R);
    expect(bi.x).toBeLessThan(eightBall.TABLE_W - BALL_R);
    expect(bi.y).toBeGreaterThan(1);
    expect(bi.y).toBeLessThan(eightBall.TABLE_L - BALL_R);
  }

  const b = eightBall.initialRack(2);
  // rack positions are fixed; the 8 always sits on the same (center) slot
  expect(b.balls[8]).toEqual(a.balls[8]);
  const key = (s: EightBallState) => s.balls.map((x) => `${x.x},${x.y}`).sort();
  expect(key(b)).toEqual(key(a));
  // …but the other ids land on different slots for a different seed
  expect(b.balls).not.toEqual(a.balls);
  // same seed → identical rack
  expect(eightBall.initialRack(7)).toEqual(eightBall.initialRack(7));
});

test("break shot is deterministic: same state + shot → identical result, twice", () => {
  const state = eightBall.initialRack(3, "user");
  const s = shot(0, 1, 1);
  const a = eightBall.simulateShot(state, s);
  const b = eightBall.simulateShot(state, s);
  expect(a.finalState).toEqual(b.finalState);
  expect(a.events).toEqual(b.events);
  expect(a.events).toContain("break");
  expect(() => eightBallStateSchema.parse(a.finalState)).not.toThrow();
});

test("createShotSim stepped frame-by-frame reaches the same result as simulateShot", () => {
  const state = eightBall.initialRack(11, "sidekick");
  const s = shot(0.05, 0.99874921777190895, 0.9);
  const sim = eightBall.createShotSim(state, s);
  let steps = 0;
  while (sim.step()) steps++;
  expect(steps).toBeGreaterThan(10);
  expect(sim.result()).toEqual(eightBall.simulateShot(state, s));
});

test("scratch: potting the cue is a foul → ball-in-hand for the opponent", () => {
  const state = makeState({
    cue: { x: 0.5, y: 0.5 },
    balls: { 1: { x: 0.8, y: 1.8 }, 9: { x: 0.2, y: 1.8 }, 8: { x: 0.5, y: 1.9 } },
    userGroup: "solids",
    toMove: "user",
  });
  const d = aim({ x: 0.5, y: 0.5 }, POCKETS[0]!);
  const res = eightBall.simulateShot(state, shot(d.x, d.y, 0.8));
  expect(res.events).toContain("scratch");
  expect(res.finalState.balls[0]!.pocketed).toBe(true);
  expect(res.finalState.ballInHand).toBe(true);
  expect(res.finalState.toMove).toBe("sidekick");
  expect(res.finalState.winner).toBeNull();
});

test("ball-in-hand: a legal cuePlace is used, an illegal one falls back to a legal spot", () => {
  const state = makeState({
    cuePocketed: true,
    balls: { 1: { x: 0.5, y: 1.2 }, 8: { x: 0.5, y: 1.9 } },
    userGroup: "solids",
    toMove: "user",
    ballInHand: true,
  });
  const placed = eightBall.simulateShot(state, shot(0, 1, 0.3, { cuePlace: { x: 0.5, y: 0.7 } }));
  expect(placed.finalState.balls[0]!.pocketed).toBe(false);
  expect(placed.events.some((e) => e.startsWith("pot:"))).toBe(false);

  // placement on top of ball 1 is illegal → deterministic fallback spot
  const fallback = eightBall.simulateShot(state, shot(0, 1, 0.2, { cuePlace: { x: 0.5, y: 1.2 } }));
  expect(fallback.finalState.balls[0]!.pocketed).toBe(false);
  expect(eightBall.isLegalCuePlacement(state, { x: 0.5, y: 1.2 })).toBe(false);
});

test("wrong-group first contact is a foul → ball-in-hand", () => {
  const state = makeState({
    cue: { x: 0.5, y: 0.5 },
    balls: { 9: { x: 0.5, y: 0.8 }, 1: { x: 0.15, y: 1.8 }, 8: { x: 0.85, y: 1.8 } },
    userGroup: "solids",
    toMove: "user",
  });
  const res = eightBall.simulateShot(state, shot(0, 1, 0.4));
  expect(res.events).toContain("foul_wrong_group");
  expect(res.finalState.ballInHand).toBe(true);
  expect(res.finalState.toMove).toBe("sidekick");
});

test("no contact at all just passes the turn without a foul", () => {
  const state = makeState({
    cue: { x: 0.5, y: 0.5 },
    balls: { 1: { x: 0.15, y: 1.8 }, 9: { x: 0.85, y: 1.8 }, 8: { x: 0.5, y: 1.9 } },
    userGroup: "solids",
    toMove: "user",
  });
  const res = eightBall.simulateShot(state, shot(0, -1, 0.2));
  expect(res.events).toEqual([]);
  expect(res.finalState.ballInHand).toBe(false);
  expect(res.finalState.toMove).toBe("sidekick");
});

test("potting your own ball keeps the turn; potting only an opponent ball passes it", () => {
  const pocket = POCKETS[0]!;
  const cue = { x: 0.5, y: 0.5 };
  const d = aim(cue, pocket);
  const own = { x: cue.x + d.x * 0.25, y: cue.y + d.y * 0.25 };
  const state = makeState({
    cue,
    balls: { 1: own, 2: { x: 0.8, y: 1.8 }, 9: { x: 0.2, y: 1.8 }, 8: { x: 0.5, y: 1.9 } },
    userGroup: "solids",
    toMove: "user",
  });
  const res = eightBall.simulateShot(state, shot(d.x, d.y, 0.7));
  expect(res.events).toContain("pot:1");
  expect(res.finalState.toMove).toBe("user");
  expect(res.finalState.ballInHand).toBe(false);

  const oppState: EightBallState = { ...state, userGroup: "stripes" };
  const oppRes = eightBall.simulateShot(oppState, shot(d.x, d.y, 0.7));
  expect(oppRes.events).toContain("pot:1");
  expect(oppRes.events).toContain("foul_wrong_group");
});

test("first pot on an open table assigns groups to the shooter", () => {
  const pocket = POCKETS[0]!;
  const cue = { x: 0.5, y: 0.5 };
  const d = aim(cue, pocket);
  const own = { x: cue.x + d.x * 0.25, y: cue.y + d.y * 0.25 };
  const base = makeState({
    cue,
    balls: { 1: own, 9: { x: 0.8, y: 1.8 }, 8: { x: 0.5, y: 1.9 } },
    userGroup: null,
    toMove: "user",
  });
  const res = eightBall.simulateShot(base, shot(d.x, d.y, 0.7));
  expect(res.events).toContain("group_assigned:solids");
  expect(res.finalState.userGroup).toBe("solids");
  expect(res.finalState.toMove).toBe("user");

  const sidekickShoots: EightBallState = { ...base, toMove: "sidekick" };
  const res2 = eightBall.simulateShot(sidekickShoots, shot(d.x, d.y, 0.7));
  expect(res2.events).toContain("group_assigned:solids");
  // the sidekick potted a solid, so the USER holds stripes
  expect(res2.finalState.userGroup).toBe("stripes");
});

// 45° approach into the top-right corner pocket: threads the cushion gap cleanly.
const CORNER = POCKETS[5]!;
const DIAG = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
const onCornerLine = (back: number) => ({ x: CORNER.x - DIAG.x * back, y: CORNER.y - DIAG.y * back });

test("early 8 is an instant loss", () => {
  const cue = onCornerLine(0.5);
  const d = DIAG;
  const eight = onCornerLine(0.2);
  const state = makeState({
    cue,
    balls: { 8: eight, 1: { x: 0.15, y: 0.3 }, 9: { x: 0.85, y: 0.3 } },
    userGroup: "solids",
    toMove: "user",
  });
  const res = eightBall.simulateShot(state, shot(d.x, d.y, 0.8));
  expect(res.events).toContain("early_8");
  expect(res.events).toContain("loss");
  expect(res.finalState.winner).toBe("sidekick");
});

test("potting the 8 after clearing your group wins", () => {
  const cue = onCornerLine(0.5);
  const d = DIAG;
  const eight = onCornerLine(0.2);
  const state = makeState({
    cue,
    balls: { 8: eight, 9: { x: 0.85, y: 0.3 } },
    userGroup: "solids",
    toMove: "user",
  });
  const res = eightBall.simulateShot(state, shot(d.x, d.y, 0.8));
  expect(res.events).toContain("win");
  expect(res.finalState.winner).toBe("user");
});

test("scratching while potting the 8 loses even with your group cleared", () => {
  const eight = onCornerLine(0.12);
  const cue = onCornerLine(0.32);
  const d = DIAG;
  const state = makeState({
    cue,
    balls: { 8: eight, 9: { x: 0.85, y: 0.3 } },
    userGroup: "solids",
    toMove: "user",
  });
  // heavy follow spin chases the cue into the pocket behind the 8
  const res = eightBall.simulateShot(state, shot(d.x, d.y, 1, { spin: { x: 0, y: 1 } }));
  expect(res.events).toContain("scratch_on_8");
  expect(res.finalState.winner).toBe("sidekick");
});

test("after clearing your group the 8 is the only legal first contact", () => {
  const state = makeState({
    cue: { x: 0.5, y: 0.5 },
    balls: { 9: { x: 0.5, y: 0.8 }, 8: { x: 0.85, y: 1.8 } },
    userGroup: "solids",
    toMove: "user",
  });
  expect(eightBall.legalTargets(state)).toEqual([8]);
  const res = eightBall.simulateShot(state, shot(0, 1, 0.4));
  expect(res.events).toContain("foul_wrong_group");
});

test("english alters the cushion rebound deterministically", () => {
  const state = makeState({
    cue: { x: 0.5, y: 0.5 },
    balls: { 1: { x: 0.2, y: 1.8 }, 9: { x: 0.8, y: 1.8 }, 8: { x: 0.5, y: 1.9 } },
    userGroup: "solids",
    toMove: "user",
  });
  const plain = eightBall.simulateShot(state, shot(1, 0, 0.5));
  const spun = eightBall.simulateShot(state, shot(1, 0, 0.5, { spin: { x: 1, y: 0 } }));
  expect(plain.finalState.balls[0]!.y).not.toBe(spun.finalState.balls[0]!.y);
  expect(eightBall.simulateShot(state, shot(1, 0, 0.5, { spin: { x: 1, y: 0 } }))).toEqual(spun);
});

test("runSidekickTurn chains shots, stamps lastTurn, and replays identically on the client", () => {
  const state = eightBall.initialRack(21, "sidekick");
  const turn = eightBall.runSidekickTurn(state, mulberry32(21));
  expect(turn.shots.length).toBeGreaterThan(0);
  expect(turn.finalState.lastTurn).toEqual({
    actor: "sidekick",
    shots: turn.shots,
    pre: { balls: state.balls, ballInHand: false, userGroup: null },
  });
  expect(() => eightBallStateSchema.parse(turn.finalState)).not.toThrow();

  // replaying the stored shot list through the engine reproduces the state exactly
  let replay = state;
  for (const s of turn.shots) replay = eightBall.simulateShot(replay, s).finalState;
  expect({ ...replay, lastTurn: turn.finalState.lastTurn }).toEqual(turn.finalState);
});
