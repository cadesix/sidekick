// Cup Pong engine (plans/21-games.md): no physics stepping — a throw is a
// pure linear map from the flick to a landing point, tested against cup-mouth
// circles with a rim-tolerance band for near-miss wobbles. 10 cups in a
// 4-3-2-1 triangle (bitmask per side), re-racks at 6 and 3, 2 balls per turn
// with balls-back, first to clear 10 wins. No bounce shots, no redemption.

import { DIFFICULTY, gaussian, type CupPongDifficulty, type Rng } from './ai';
import type {
	CupPongEvent,
	CupPongFlick,
	CupPongPreTurn,
	CupPongState,
	GameActor,
	SidekickTurn,
} from './types';

export const CUP_R = 0.048;
export const RIM_TOL = 0.02;
export const CUP_SPACING = 0.1;
export const RACK_BACK_Y = 1.9;
const ROW_DY = CUP_SPACING * (Math.sqrt(3) / 2);

// Flick → landing point mapping (the scene's parabola lands here too).
export const LAND_X_MAX = 0.6;
export const LAND_Y_MIN = 1.0;
export const LAND_Y_MAX = 2.4;

export const ALL_CUPS = 1023;

function rowsFor(rack: 10 | 6 | 3): number[] {
	if (rack === 10) return [4, 3, 2, 1];
	if (rack === 6) return [3, 2, 1];
	return [2, 1];
}

function buildLayout(rack: 10 | 6 | 3): { x: number; y: number }[] {
	const out: { x: number; y: number }[] = [];
	rowsFor(rack).forEach((count, row) => {
		for (let i = 0; i < count; i++) {
			out.push({ x: (i - (count - 1) / 2) * CUP_SPACING, y: RACK_BACK_Y - row * ROW_DY });
		}
	});
	return out;
}

const LAYOUTS: Record<10 | 6 | 3, { x: number; y: number }[]> = {
	10: buildLayout(10),
	6: buildLayout(6),
	3: buildLayout(3),
};

export function cupCount(mask: number): number {
	let n = 0;
	for (let bit = 0; bit < 10; bit++) {
		if (mask & (1 << bit)) n++;
	}
	return n;
}

// Slot positions for the rack tier a given count implies (re-racks happen at
// exactly 6 and 3 remaining, so the tier is derivable from the count alone).
export function cupLayout(count: number): { x: number; y: number }[] {
	if (count >= 7) return LAYOUTS[10];
	if (count >= 4) return LAYOUTS[6];
	return LAYOUTS[3];
}

// Standing cups of a mask, with their slot index and position.
export function cupPositions(mask: number): { slot: number; x: number; y: number }[] {
	const layout = cupLayout(cupCount(mask));
	const out: { slot: number; x: number; y: number }[] = [];
	for (let slot = 0; slot < layout.length; slot++) {
		const cup = layout[slot]!;
		if (mask & (1 << slot)) out.push({ slot, x: cup.x, y: cup.y });
	}
	return out;
}

export function initialState(toMove: GameActor = 'sidekick'): CupPongState {
	return {
		version: 1,
		cups: { user: ALL_CUPS, sidekick: ALL_CUPS },
		toMove,
		turnBalls: 2,
		turnHits: 0,
		winner: null,
		lastTurn: null,
	};
}

// The pre-turn snapshot stamped into `lastTurn.pre`, and its inverse — the
// settled state a replay simulates from (a turn always starts on a fresh set).
export function preTurnSnapshot(state: CupPongState): CupPongPreTurn {
	return { cups: state.cups };
}

export function stateFromPre(pre: CupPongPreTurn, actor: GameActor): CupPongState {
	return {
		version: 1,
		cups: pre.cups,
		toMove: actor,
		turnBalls: 2,
		turnHits: 0,
		winner: null,
		lastTurn: null,
	};
}

export function landingPoint(flick: CupPongFlick): { x: number; y: number } {
	return {
		x: flick.x * LAND_X_MAX,
		y: LAND_Y_MIN + flick.power * (LAND_Y_MAX - LAND_Y_MIN),
	};
}

// Inverse of landingPoint (clamped) — used by the AI and by input mapping.
export function flickForLanding(p: { x: number; y: number }): CupPongFlick {
	return {
		x: Math.min(Math.max(p.x / LAND_X_MAX, -1), 1),
		power: Math.min(Math.max((p.y - LAND_Y_MIN) / (LAND_Y_MAX - LAND_Y_MIN), 0), 1),
	};
}

// Parabola parameters the scene animates for a flick (live or replayed).
export function throwFlight(flick: CupPongFlick): {
	start: { x: number; y: number };
	landing: { x: number; y: number };
	apexHeight: number;
	duration: number;
} {
	return {
		start: { x: 0, y: 0 },
		landing: landingPoint(flick),
		apexHeight: 0.35 + 0.2 * flick.power,
		duration: 0.9 + 0.4 * flick.power,
	};
}

export type CupPongThrowResult = {
	landing: { x: number; y: number };
	// slot index of the cup made, or null on a miss
	cupSlot: number | null;
	rimNearMiss: boolean;
	events: CupPongEvent[];
	finalState: CupPongState;
};

export function throwOutcome(state: CupPongState, flick: CupPongFlick): CupPongThrowResult {
	const thrower = state.toMove;
	const targetSide: GameActor = thrower === 'user' ? 'sidekick' : 'user';
	const landing = landingPoint(flick);
	const events: CupPongEvent[] = [];

	let mask = state.cups[targetSide];
	let cupSlot: number | null = null;
	let rimNearMiss = false;
	let nearest: { slot: number; d: number } | null = null;
	for (const cup of cupPositions(mask)) {
		const dx = landing.x - cup.x;
		const dy = landing.y - cup.y;
		const d = Math.sqrt(dx * dx + dy * dy);
		if (nearest === null || d < nearest.d) nearest = { slot: cup.slot, d };
	}
	if (nearest !== null && nearest.d <= CUP_R) {
		cupSlot = nearest.slot;
		mask &= ~(1 << nearest.slot);
		events.push(`cup:${nearest.slot}`);
		const left = cupCount(mask);
		if (left === 6) {
			mask = 0b111111;
			events.push('rerack:6');
		} else if (left === 3) {
			mask = 0b111;
			events.push('rerack:3');
		}
	} else if (nearest !== null && nearest.d <= CUP_R + RIM_TOL) {
		rimNearMiss = true;
		events.push('rim_miss');
	} else {
		events.push('miss');
	}

	let winner: GameActor | null = state.winner;
	let toMove = thrower;
	let turnBalls = state.turnBalls - 1;
	let turnHits = state.turnHits + (cupSlot === null ? 0 : 1);
	if (cupCount(mask) === 0) {
		winner = thrower;
		events.push('win');
	} else if (turnBalls === 0) {
		if (turnHits === 2) {
			events.push('balls_back');
		} else {
			toMove = targetSide;
		}
		turnBalls = 2;
		turnHits = 0;
	}

	const cups = { ...state.cups, [targetSide]: mask };
	return {
		landing,
		cupSlot,
		rimNearMiss,
		events,
		finalState: { ...state, cups, toMove, turnBalls, turnHits, winner },
	};
}

// Front-most-weighted target cup + a 2D gaussian landing sample (σ from the
// difficulty profile), inverted back into a flick.
export function chooseThrow(
	state: CupPongState,
	rng: Rng,
	difficulty: CupPongDifficulty = DIFFICULTY.cupPong,
): CupPongFlick {
	const targetSide: GameActor = state.toMove === 'user' ? 'sidekick' : 'user';
	const cups = cupPositions(state.cups[targetSide]);
	let target = cups[0]!;
	for (const cup of cups) {
		if (cup.y < target.y || (cup.y === target.y && Math.abs(cup.x) < Math.abs(target.x))) {
			target = cup;
		}
	}
	if (cups.length > 1 && rng() >= 0.6) {
		target = cups[Math.floor(rng() * cups.length)]!;
	}
	return flickForLanding({
		x: target.x + gaussian(rng) * difficulty.sigma,
		y: target.y + gaussian(rng) * difficulty.sigma,
	});
}

export function runSidekickTurn(
	state: CupPongState,
	rng: Rng,
	difficulty: CupPongDifficulty = DIFFICULTY.cupPong,
): SidekickTurn<CupPongState, CupPongFlick, CupPongEvent> {
	let cur = state;
	const shots: CupPongFlick[] = [];
	const events: CupPongEvent[] = [];
	while (cur.toMove === 'sidekick' && cur.winner === null && shots.length < 30) {
		const flick = chooseThrow(cur, rng, difficulty);
		const res = throwOutcome(cur, flick);
		shots.push(flick);
		events.push(...res.events);
		cur = res.finalState;
	}
	return {
		shots,
		events,
		finalState: { ...cur, lastTurn: { actor: 'sidekick', shots, pre: preTurnSnapshot(state) } },
	};
}
