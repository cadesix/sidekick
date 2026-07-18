import { expect, test } from "vitest";
import { cupPong, cupPongStateSchema, mulberry32, type CupPongState } from "@sidekick/core";

const { CUP_R, RIM_TOL, ALL_CUPS } = cupPong;

/** A flick that lands dead-center on the given cup slot of the given mask. */
function flickAtSlot(mask: number, slot: number) {
  const cup = cupPong.cupPositions(mask).find((c) => c.slot === slot)!;
  return cupPong.flickForLanding({ x: cup.x, y: cup.y });
}

function makeState(overrides: Partial<CupPongState>): CupPongState {
  return { ...cupPong.initialState("user"), ...overrides };
}

test("rack layouts: 4-3-2-1, 3-2-1, and 2-1 triangles with no overlapping cups", () => {
  const racks: { count: number; rows: number[] }[] = [
    { count: 10, rows: [4, 3, 2, 1] },
    { count: 6, rows: [3, 2, 1] },
    { count: 3, rows: [2, 1] },
  ];
  for (const { count, rows } of racks) {
    const layout = cupPong.cupLayout(count);
    expect(layout).toHaveLength(count);
    const byRow = new Map<number, number>();
    for (const cup of layout) byRow.set(cup.y, (byRow.get(cup.y) ?? 0) + 1);
    expect([...byRow.values()]).toEqual(rows);
    for (let i = 0; i < layout.length; i++) {
      const a = layout[i]!;
      for (let j = i + 1; j < layout.length; j++) {
        const b = layout[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(CUP_R * 2);
      }
    }
  }
  // the same tier serves counts between re-racks
  expect(cupPong.cupLayout(8)).toBe(cupPong.cupLayout(10));
  expect(cupPong.cupLayout(4)).toBe(cupPong.cupLayout(6));
  expect(cupPong.cupLayout(1)).toBe(cupPong.cupLayout(3));
});

test("initial state: 10 cups a side, 2 balls, no winner", () => {
  const s = cupPong.initialState("user");
  expect(s).toEqual({
    version: 1,
    cups: { user: ALL_CUPS, sidekick: ALL_CUPS },
    toMove: "user",
    turnBalls: 2,
    turnHits: 0,
    winner: null,
    lastTurn: null,
  });
  expect(cupPong.cupCount(ALL_CUPS)).toBe(10);
});

test("a dead-center landing sinks the cup; a rim-band landing wobbles out", () => {
  const state = makeState({});
  const hit = cupPong.throwOutcome(state, flickAtSlot(ALL_CUPS, 9));
  expect(hit.cupSlot).toBe(9);
  expect(hit.events).toContain("cup:9");
  expect(hit.finalState.cups.sidekick).toBe(ALL_CUPS & ~(1 << 9));
  expect(hit.finalState.turnBalls).toBe(1);
  expect(hit.finalState.turnHits).toBe(1);
  expect(hit.finalState.toMove).toBe("user");

  const apex = cupPong.cupPositions(ALL_CUPS).find((c) => c.slot === 9)!;
  const rim = cupPong.throwOutcome(
    state,
    cupPong.flickForLanding({ x: apex.x, y: apex.y - (CUP_R + RIM_TOL / 2) }),
  );
  expect(rim.cupSlot).toBeNull();
  expect(rim.rimNearMiss).toBe(true);
  expect(rim.events).toContain("rim_miss");
  expect(rim.finalState.cups.sidekick).toBe(ALL_CUPS);
});

test("two misses pass the turn and reset the ball count", () => {
  const state = makeState({});
  const miss = cupPong.flickForLanding({ x: 0.5, y: 1.0 });
  const first = cupPong.throwOutcome(state, miss);
  expect(first.events).toContain("miss");
  expect(first.finalState.toMove).toBe("user");
  expect(first.finalState.turnBalls).toBe(1);
  const second = cupPong.throwOutcome(first.finalState, miss);
  expect(second.finalState.toMove).toBe("sidekick");
  expect(second.finalState.turnBalls).toBe(2);
  expect(second.finalState.turnHits).toBe(0);
});

test("making both balls gives balls back and the same turn continues", () => {
  const state = makeState({});
  const first = cupPong.throwOutcome(state, flickAtSlot(ALL_CUPS, 9));
  const second = cupPong.throwOutcome(first.finalState, flickAtSlot(first.finalState.cups.sidekick, 8));
  expect(second.events).toContain("balls_back");
  expect(second.finalState.toMove).toBe("user");
  expect(second.finalState.turnBalls).toBe(2);
  expect(second.finalState.turnHits).toBe(0);
});

test("re-rack at 6: the seventh make resets the mask to a fresh 3-2-1 rack", () => {
  const seven = 0b1111111;
  const state = makeState({ cups: { user: ALL_CUPS, sidekick: seven } });
  const res = cupPong.throwOutcome(state, flickAtSlot(seven, 0));
  expect(res.events).toContain("rerack:6");
  expect(res.finalState.cups.sidekick).toBe(0b111111);
  expect(cupPong.cupPositions(res.finalState.cups.sidekick)).toHaveLength(6);
});

test("re-rack at 3: dropping to three cups resets to a 2-1 rack", () => {
  const four = 0b1111;
  const state = makeState({ cups: { user: ALL_CUPS, sidekick: four } });
  const res = cupPong.throwOutcome(state, flickAtSlot(four, 0));
  expect(res.events).toContain("rerack:3");
  expect(res.finalState.cups.sidekick).toBe(0b111);
});

test("clearing the last cup wins immediately, even on the first ball of a turn", () => {
  const state = makeState({ cups: { user: ALL_CUPS, sidekick: 0b1 } });
  const res = cupPong.throwOutcome(state, flickAtSlot(0b1, 0));
  expect(res.events).toContain("win");
  expect(res.finalState.winner).toBe("user");
  expect(res.finalState.toMove).toBe("user");
});

test("winning on the second ball of a set yields a schema-valid terminal state", () => {
  const state = makeState({ cups: { user: ALL_CUPS, sidekick: 0b1 }, turnBalls: 1 });
  const res = cupPong.throwOutcome(state, flickAtSlot(0b1, 0));
  expect(res.events).toContain("win");
  expect(res.finalState.winner).toBe("user");
  expect(res.finalState.turnBalls).toBe(0);
  // The server parses persisted state with this schema when building the view;
  // a terminal turnBalls of 0 must validate (regression: it used to 500).
  expect(() => cupPongStateSchema.parse(res.finalState)).not.toThrow();
});

test("throwOutcome and the flight parabola are deterministic pure maps of the flick", () => {
  const flick = { x: 0.21, power: 0.66 };
  expect(cupPong.landingPoint(flick)).toEqual(cupPong.landingPoint(flick));
  expect(cupPong.throwFlight(flick)).toEqual(cupPong.throwFlight(flick));
  const state = makeState({ toMove: "sidekick" });
  expect(cupPong.throwOutcome(state, flick)).toEqual(cupPong.throwOutcome(state, flick));
});

test("runSidekickTurn: same state + seed → identical shot list, and the replay matches", () => {
  const state = cupPong.initialState("sidekick");
  const a = cupPong.runSidekickTurn(state, mulberry32(77));
  const b = cupPong.runSidekickTurn(state, mulberry32(77));
  expect(a).toEqual(b);
  expect(a.shots.length).toBeGreaterThan(0);
  expect(a.finalState.lastTurn).toEqual({
    actor: "sidekick",
    shots: a.shots,
    pre: { cups: state.cups },
  });
  expect(() => cupPongStateSchema.parse(a.finalState)).not.toThrow();

  let replay = state;
  for (const flick of a.shots) replay = cupPong.throwOutcome(replay, flick).finalState;
  expect({ ...replay, lastTurn: a.finalState.lastTurn }).toEqual(a.finalState);
});
