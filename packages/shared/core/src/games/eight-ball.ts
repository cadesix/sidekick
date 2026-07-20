// 8 Ball engine (plans/21-games.md): 2D top-down physics under the 3D
// dressing. Circles + segment cushions + capture-circle pockets, elastic
// equal-mass collisions (swap normal components), cushion restitution, spin as
// post-impact velocity adjustment (follow/draw) and modified cushion rebound
// (english). Fixed 120Hz timestep and no trig/log/exp anywhere in the sim, so
// a stored shot replays byte-identically on every runtime (server computes
// sidekick turns, client replays them — they must agree).

import { DIFFICULTY, gaussian, mulberry32, type EightBallDifficulty, type Rng } from './ai';
import type {
	EightBallBall,
	EightBallEvent,
	EightBallPreTurn,
	EightBallShot,
	EightBallState,
	GameActor,
	SidekickTurn,
} from './types';

export const TABLE_W = 1;
export const TABLE_L = 2;
export const BALL_R = 0.026;
export const POCKET_R = 0.058;

// Pocket capture centers sit just outside the play field so a ball rolling
// along a rail past a side pocket is not swallowed.
export const POCKETS: readonly { x: number; y: number }[] = [
	{ x: -0.025, y: -0.025 },
	{ x: 1.025, y: -0.025 },
	{ x: -0.035, y: 1 },
	{ x: 1.035, y: 1 },
	{ x: -0.025, y: 2.025 },
	{ x: 1.025, y: 2.025 },
];

const CORNER_GAP = 0.07;
const SIDE_GAP = 0.06;

// Cushion segments (with pocket gaps), exported for the 3D scene's dressing.
export const CUSHIONS: readonly { x1: number; y1: number; x2: number; y2: number }[] = [
	{ x1: 0, y1: CORNER_GAP, x2: 0, y2: 1 - SIDE_GAP },
	{ x1: 0, y1: 1 + SIDE_GAP, x2: 0, y2: TABLE_L - CORNER_GAP },
	{ x1: TABLE_W, y1: CORNER_GAP, x2: TABLE_W, y2: 1 - SIDE_GAP },
	{ x1: TABLE_W, y1: 1 + SIDE_GAP, x2: TABLE_W, y2: TABLE_L - CORNER_GAP },
	{ x1: CORNER_GAP, y1: 0, x2: TABLE_W - CORNER_GAP, y2: 0 },
	{ x1: CORNER_GAP, y1: TABLE_L, x2: TABLE_W - CORNER_GAP, y2: TABLE_L },
];

export const SIM_DT = 1 / 120;
const MAX_SHOT_SPEED = 3;
const STEP_DAMPING = 0.991;
const STOP_SPEED = 0.02;
const MAX_STEPS = 1800;
const CUSHION_RESTITUTION = 0.75;
const FOLLOW_GAIN = 0.4;
const ENGLISH_GAIN = 0.3;
const ENGLISH_DECAY = 0.6;

export const HEAD_SPOT = { x: 0.5, y: 0.5 };
export const FOOT_SPOT = { x: 0.5, y: 1.5 };

export type BallGroup = 'solids' | 'stripes';

export function groupOf(ballId: number): BallGroup | null {
	if (ballId >= 1 && ballId <= 7) return 'solids';
	if (ballId >= 9 && ballId <= 15) return 'stripes';
	return null;
}

function otherActor(a: GameActor): GameActor {
	if (a === 'user') return 'sidekick';
	return 'user';
}

function otherGroup(g: BallGroup): BallGroup {
	if (g === 'solids') return 'stripes';
	return 'solids';
}

export function actorGroup(state: EightBallState, actor: GameActor): BallGroup | null {
	if (state.userGroup === null) return null;
	if (actor === 'user') return state.userGroup;
	return otherGroup(state.userGroup);
}

function dist(ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	return Math.sqrt(dx * dx + dy * dy);
}

const RACK_SPACING = BALL_R * 2 + 0.0005;
const RACK_ROW_DY = RACK_SPACING * (Math.sqrt(3) / 2);

// Racked positions: apex on the foot spot, rows extending toward the far end.
function rackSlot(slot: number): { x: number; y: number } {
	let row = 0;
	let firstOfRow = 0;
	while (firstOfRow + row + 1 <= slot) {
		firstOfRow += row + 1;
		row++;
	}
	const col = slot - firstOfRow;
	return {
		x: FOOT_SPOT.x + (col - row / 2) * RACK_SPACING,
		y: FOOT_SPOT.y + row * RACK_ROW_DY,
	};
}

// The 8 sits at the rack's center (slot 4); the other 14 shuffle by seed.
export function initialRack(seed: number, toMove: GameActor = 'sidekick'): EightBallState {
	const rng = mulberry32(seed >>> 0);
	const order = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const t = order[i]!;
		order[i] = order[j]!;
		order[j] = t;
	}
	const balls: EightBallBall[] = [];
	balls[0] = { x: HEAD_SPOT.x, y: HEAD_SPOT.y, pocketed: false };
	let next = 0;
	for (let slot = 0; slot < 15; slot++) {
		const pos = rackSlot(slot);
		let id = 8;
		if (slot !== 4) {
			id = order[next]!;
			next++;
		}
		balls[id] = { x: pos.x, y: pos.y, pocketed: false };
	}
	return {
		version: 1,
		balls,
		userGroup: null,
		toMove,
		ballInHand: false,
		winner: null,
		lastTurn: null,
	};
}

// The pre-turn snapshot stamped into `lastTurn.pre` — enough to replay the
// turn's shots — and its inverse, the settled state a replay simulates from.
export function preTurnSnapshot(state: EightBallState): EightBallPreTurn {
	return { balls: state.balls, ballInHand: state.ballInHand, userGroup: state.userGroup };
}

export function stateFromPre(pre: EightBallPreTurn, actor: GameActor): EightBallState {
	return {
		version: 1,
		balls: pre.balls,
		userGroup: pre.userGroup,
		toMove: actor,
		ballInHand: pre.ballInHand,
		winner: null,
		lastTurn: null,
	};
}

export function isLegalCuePlacement(state: EightBallState, p: { x: number; y: number }): boolean {
	if (p.x < BALL_R || p.x > TABLE_W - BALL_R || p.y < BALL_R || p.y > TABLE_L - BALL_R) return false;
	for (const pocket of POCKETS) {
		if (dist(p.x, p.y, pocket.x, pocket.y) < POCKET_R + BALL_R) return false;
	}
	for (let id = 1; id < 16; id++) {
		const b = state.balls[id]!;
		if (!b.pocketed && dist(p.x, p.y, b.x, b.y) < BALL_R * 2) return false;
	}
	return true;
}

// Deterministic fallback spot for a pocketed cue with no placement: the legal
// lattice point nearest the head spot.
export function findCueSpot(state: EightBallState): { x: number; y: number } {
	const points: { x: number; y: number; d: number }[] = [];
	for (let gy = 2; gy <= 38; gy++) {
		for (let gx = 2; gx <= 18; gx++) {
			const x = gx * 0.05;
			const y = gy * 0.05;
			const dx = x - HEAD_SPOT.x;
			const dy = y - HEAD_SPOT.y;
			points.push({ x, y, d: dx * dx + dy * dy });
		}
	}
	points.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
	for (const p of points) {
		if (isLegalCuePlacement(state, p)) return { x: p.x, y: p.y };
	}
	return { x: HEAD_SPOT.x, y: HEAD_SPOT.y };
}

export type EightBallSimBall = {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	pocketed: boolean;
};

export type EightBallShotResult = { events: EightBallEvent[]; finalState: EightBallState };

export type EightBallShotSim = {
	// live ball array (index = ball id) the scene reads each frame
	balls: readonly EightBallSimBall[];
	// advance one fixed 120Hz step; true while anything is still moving
	step: () => boolean;
	// fast-forwards any remaining motion, then applies the rules
	result: () => EightBallShotResult;
};

export function createShotSim(state: EightBallState, shot: EightBallShot): EightBallShotSim {
	const balls: EightBallSimBall[] = state.balls.map((b, id) => ({
		id,
		x: b.x,
		y: b.y,
		vx: 0,
		vy: 0,
		pocketed: b.pocketed,
	}));
	const cue = balls[0]!;
	if (state.ballInHand) {
		if (shot.cuePlace && isLegalCuePlacement(state, shot.cuePlace)) {
			cue.x = shot.cuePlace.x;
			cue.y = shot.cuePlace.y;
			cue.pocketed = false;
		} else if (cue.pocketed) {
			const spot = findCueSpot(state);
			cue.x = spot.x;
			cue.y = spot.y;
			cue.pocketed = false;
		}
	}

	const dirLen = Math.sqrt(shot.dirX * shot.dirX + shot.dirY * shot.dirY);
	const aimX = shot.dirX / dirLen;
	const aimY = shot.dirY / dirLen;
	const power = Math.min(Math.max(shot.power, 0.05), 1);
	const speed0 = power * MAX_SHOT_SPEED;
	cue.vx = aimX * speed0;
	cue.vy = aimY * speed0;

	let english = shot.spin.x;
	let followPending = shot.spin.y * FOLLOW_GAIN * speed0;
	let firstContact = -1;
	const potted: number[] = [];
	let cueOffTable = false;
	let steps = 0;
	let done = false;

	const isBreak = state.userGroup === null && state.balls.every((b, id) => id === 0 || !b.pocketed);

	function collideWalls(b: EightBallSimBall): void {
		const leftSpan = (y: number) =>
			(y >= CORNER_GAP && y <= 1 - SIDE_GAP) || (y >= 1 + SIDE_GAP && y <= TABLE_L - CORNER_GAP);
		const endSpan = (x: number) => x >= CORNER_GAP && x <= TABLE_W - CORNER_GAP;
		if (b.x < BALL_R && b.vx < 0 && leftSpan(b.y)) {
			const vn = -b.vx;
			b.x = BALL_R;
			b.vx = vn * CUSHION_RESTITUTION;
			if (b.id === 0 && english !== 0) {
				b.vy += english * ENGLISH_GAIN * vn;
				english *= ENGLISH_DECAY;
			}
		} else if (b.x > TABLE_W - BALL_R && b.vx > 0 && leftSpan(b.y)) {
			const vn = b.vx;
			b.x = TABLE_W - BALL_R;
			b.vx = -vn * CUSHION_RESTITUTION;
			if (b.id === 0 && english !== 0) {
				b.vy -= english * ENGLISH_GAIN * vn;
				english *= ENGLISH_DECAY;
			}
		}
		if (b.y < BALL_R && b.vy < 0 && endSpan(b.x)) {
			const vn = -b.vy;
			b.y = BALL_R;
			b.vy = vn * CUSHION_RESTITUTION;
			if (b.id === 0 && english !== 0) {
				b.vx -= english * ENGLISH_GAIN * vn;
				english *= ENGLISH_DECAY;
			}
		} else if (b.y > TABLE_L - BALL_R && b.vy > 0 && endSpan(b.x)) {
			const vn = b.vy;
			b.y = TABLE_L - BALL_R;
			b.vy = -vn * CUSHION_RESTITUTION;
			if (b.id === 0 && english !== 0) {
				b.vx += english * ENGLISH_GAIN * vn;
				english *= ENGLISH_DECAY;
			}
		}
	}

	function step(): boolean {
		if (done) return false;
		for (const b of balls) {
			if (b.pocketed) continue;
			b.x += b.vx * SIM_DT;
			b.y += b.vy * SIM_DT;
		}
		for (let i = 0; i < 16; i++) {
			const a = balls[i]!;
			if (a.pocketed) continue;
			for (let j = i + 1; j < 16; j++) {
				const b = balls[j]!;
				if (b.pocketed) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d2 = dx * dx + dy * dy;
				const min = BALL_R * 2;
				if (d2 >= min * min || d2 === 0) continue;
				const d = Math.sqrt(d2);
				const nx = dx / d;
				const ny = dy / d;
				const van = a.vx * nx + a.vy * ny;
				const vbn = b.vx * nx + b.vy * ny;
				if (van - vbn <= 0) continue;
				a.vx += (vbn - van) * nx;
				a.vy += (vbn - van) * ny;
				b.vx += (van - vbn) * nx;
				b.vy += (van - vbn) * ny;
				const push = (min - d) / 2;
				a.x -= nx * push;
				a.y -= ny * push;
				b.x += nx * push;
				b.y += ny * push;
				if (i === 0) {
					if (firstContact === -1) firstContact = j;
					if (followPending !== 0) {
						a.vx += aimX * followPending;
						a.vy += aimY * followPending;
						followPending = 0;
					}
				}
			}
		}
		for (const b of balls) {
			if (!b.pocketed) collideWalls(b);
		}
		for (const b of balls) {
			if (b.pocketed) continue;
			for (const p of POCKETS) {
				const dx = b.x - p.x;
				const dy = b.y - p.y;
				if (dx * dx + dy * dy < POCKET_R * POCKET_R) {
					b.pocketed = true;
					b.x = p.x;
					b.y = p.y;
					b.vx = 0;
					b.vy = 0;
					potted.push(b.id);
					break;
				}
			}
			if (b.pocketed) continue;
			// past a rail plane through a pocket gap without hitting the capture
			// circle: off the felt — swallow into the nearest pocket (no dead zone
			// where a ball could rest unpottable)
			if (b.x < -BALL_R || b.x > TABLE_W + BALL_R || b.y < -BALL_R || b.y > TABLE_L + BALL_R) {
				let nearest = POCKETS[0]!;
				let best = Infinity;
				for (const p of POCKETS) {
					const d = dist(b.x, b.y, p.x, p.y);
					if (d < best) {
						best = d;
						nearest = p;
					}
				}
				b.pocketed = true;
				b.x = nearest.x;
				b.y = nearest.y;
				b.vx = 0;
				b.vy = 0;
				potted.push(b.id);
				if (b.id === 0) cueOffTable = true;
			}
		}
		let moving = false;
		for (const b of balls) {
			if (b.pocketed) continue;
			b.vx *= STEP_DAMPING;
			b.vy *= STEP_DAMPING;
			if (b.vx * b.vx + b.vy * b.vy < STOP_SPEED * STOP_SPEED) {
				b.vx = 0;
				b.vy = 0;
			} else {
				moving = true;
			}
		}
		steps++;
		if (steps >= MAX_STEPS) {
			for (const b of balls) {
				b.vx = 0;
				b.vy = 0;
			}
			moving = false;
		}
		done = !moving;
		return moving;
	}

	let cached: EightBallShotResult | null = null;

	function result(): EightBallShotResult {
		if (cached) return cached;
		while (step());

		const shooter = state.toMove;
		const opponent = otherActor(shooter);
		const events: EightBallEvent[] = [];
		if (isBreak) events.push('break');

		const cuePotted = balls[0]!.pocketed;
		const eightPotted = balls[8]!.pocketed && !state.balls[8]!.pocketed;
		for (const id of potted) {
			if (id !== 0) events.push(`pot:${id}`);
		}

		const shooterGroupPre = actorGroup(state, shooter);
		const clearedBefore =
			shooterGroupPre !== null &&
			state.balls.every((b, id) => groupOf(id) !== shooterGroupPre || b.pocketed);

		let userGroup = state.userGroup;
		if (userGroup === null) {
			const firstObj = potted.find((id) => id !== 0 && id !== 8);
			if (firstObj !== undefined) {
				const grp = groupOf(firstObj)!;
				events.push(`group_assigned:${grp}`);
				if (shooter === 'user') userGroup = grp;
				else userGroup = otherGroup(grp);
			}
		}

		let winner: GameActor | null = null;
		let toMove = shooter;
		let ballInHand = false;

		if (cuePotted) {
			if (cueOffTable) events.push('cue_off_table');
			else events.push('scratch');
		}

		if (eightPotted) {
			if (!clearedBefore) {
				winner = opponent;
				events.push('early_8', 'loss');
			} else if (cuePotted) {
				winner = opponent;
				events.push('scratch_on_8', 'loss');
			} else {
				winner = shooter;
				events.push('win');
			}
		} else {
			let wrongContact = false;
			if (firstContact !== -1 && shooterGroupPre !== null) {
				if (clearedBefore) wrongContact = firstContact !== 8;
				else wrongContact = groupOf(firstContact) !== shooterGroupPre;
			}
			if (wrongContact) events.push('foul_wrong_group');
			if (cuePotted || wrongContact) {
				toMove = opponent;
				ballInHand = true;
			} else {
				const shooterGroupPost = shooter === 'user' ? userGroup : userGroup && otherGroup(userGroup);
				const continueTurn = potted.some((id) => {
					if (id === 0 || id === 8) return false;
					if (shooterGroupPost === null) return true;
					return groupOf(id) === shooterGroupPost;
				});
				toMove = continueTurn ? shooter : opponent;
			}
		}

		cached = {
			events,
			finalState: {
				version: 1,
				balls: balls.map((b) => ({ x: b.x, y: b.y, pocketed: b.pocketed })),
				userGroup,
				toMove,
				ballInHand,
				winner,
				lastTurn: state.lastTurn,
			},
		};
		return cached;
	}

	return { balls, step, result };
}

export function simulateShot(state: EightBallState, shot: EightBallShot): EightBallShotResult {
	return createShotSim(state, shot).result();
}

// Balls the shooter may legally contact first (feeds the aim indicator too).
export function legalTargets(state: EightBallState): number[] {
	const grp = actorGroup(state, state.toMove);
	const out: number[] = [];
	for (let id = 1; id < 16; id++) {
		if (id === 8 || state.balls[id]!.pocketed) continue;
		if (grp === null || groupOf(id) === grp) out.push(id);
	}
	if (out.length === 0 && !state.balls[8]!.pocketed) out.push(8);
	return out;
}

type Candidate = { dirX: number; dirY: number; power: number };

function candidateShots(state: EightBallState, cue: { x: number; y: number }): Candidate[] {
	const targets = legalTargets(state);
	const pairs: { dirX: number; dirY: number; d1: number; d2: number; ease: number }[] = [];
	for (const id of targets) {
		const ball = state.balls[id]!;
		for (const pocket of POCKETS) {
			const toPocket = dist(ball.x, ball.y, pocket.x, pocket.y);
			if (toPocket === 0) continue;
			const px = (pocket.x - ball.x) / toPocket;
			const py = (pocket.y - ball.y) / toPocket;
			const ghostX = ball.x - px * BALL_R * 2;
			const ghostY = ball.y - py * BALL_R * 2;
			const toGhost = dist(cue.x, cue.y, ghostX, ghostY);
			if (toGhost === 0) continue;
			const dirX = (ghostX - cue.x) / toGhost;
			const dirY = (ghostY - cue.y) / toGhost;
			const cut = dirX * px + dirY * py;
			if (cut < 0.15) continue;
			pairs.push({ dirX, dirY, d1: toGhost, d2: toPocket, ease: cut / (0.3 + toGhost + toPocket) });
		}
	}
	pairs.sort((a, b) => b.ease - a.ease || a.dirX - b.dirX || a.dirY - b.dirY);
	const out: Candidate[] = [];
	for (const p of pairs.slice(0, 20)) {
		const base = Math.min(Math.max(0.32 + (0.5 * (p.d1 + p.d2)) / 2.2, 0.3), 1);
		out.push({ dirX: p.dirX, dirY: p.dirY, power: base });
		out.push({ dirX: p.dirX, dirY: p.dirY, power: Math.min(1, base + 0.22) });
	}
	if (out.length === 0 && targets.length > 0) {
		let nearest = targets[0]!;
		let best = Infinity;
		for (const id of targets) {
			const t = state.balls[id]!;
			const d = dist(cue.x, cue.y, t.x, t.y);
			if (d < best) {
				best = d;
				nearest = id;
			}
		}
		const b = state.balls[nearest]!;
		const d = dist(cue.x, cue.y, b.x, b.y);
		if (d > 0) out.push({ dirX: (b.x - cue.x) / d, dirY: (b.y - cue.y) / d, power: 0.5 });
	}
	return out;
}

function chooseCuePlacement(state: EightBallState): { x: number; y: number } {
	const targets = legalTargets(state);
	const pairs: { spot: { x: number; y: number }; d2: number }[] = [];
	for (const id of targets) {
		const ball = state.balls[id]!;
		for (const pocket of POCKETS) {
			const toPocket = dist(ball.x, ball.y, pocket.x, pocket.y);
			if (toPocket === 0) continue;
			const px = (pocket.x - ball.x) / toPocket;
			const py = (pocket.y - ball.y) / toPocket;
			const spot = { x: ball.x - px * 0.32, y: ball.y - py * 0.32 };
			pairs.push({ spot, d2: toPocket });
		}
	}
	pairs.sort((a, b) => a.d2 - b.d2 || a.spot.x - b.spot.x || a.spot.y - b.spot.y);
	for (const p of pairs) {
		if (isLegalCuePlacement(state, p.spot)) return p.spot;
	}
	return findCueSpot(state);
}

function scoreResult(state: EightBallState, res: EightBallShotResult): number {
	const shooter = state.toMove;
	const grpPost = actorGroup(res.finalState, shooter);
	if (res.finalState.winner === shooter) return 2000;
	if (res.finalState.winner !== null) return -2000;
	let score = 0;
	const fouled = res.events.some(
		(e) => e === 'scratch' || e === 'cue_off_table' || e === 'foul_wrong_group',
	);
	if (fouled) score -= 250;
	for (let id = 1; id < 16; id++) {
		if (id === 8 || !res.finalState.balls[id]!.pocketed || state.balls[id]!.pocketed) continue;
		if (grpPost === null || groupOf(id) === grpPost) score += 130;
		else score -= 70;
	}
	const cue = res.finalState.balls[0]!;
	if (!cue.pocketed) {
		let nearest = Infinity;
		for (let id = 1; id < 16; id++) {
			const b = res.finalState.balls[id]!;
			if (b.pocketed) continue;
			if (grpPost !== null && groupOf(id) !== grpPost && id !== 8) continue;
			const d = dist(cue.x, cue.y, b.x, b.y);
			if (d < nearest) nearest = d;
		}
		if (nearest < Infinity) score -= 5 * nearest;
	}
	return score;
}

// Deterministic-seeded search: sample candidate shots biased toward pocket
// lines, simulate each with the real engine, score (legal pot > safety >
// position), then apply gaussian execution noise from the difficulty profile.
export function chooseShot(
	state: EightBallState,
	rng: Rng,
	difficulty: EightBallDifficulty = DIFFICULTY.eightBall,
): EightBallShot {
	let cuePlace: { x: number; y: number } | null = null;
	let cue = { x: state.balls[0]!.x, y: state.balls[0]!.y };
	if (state.ballInHand) {
		cuePlace = chooseCuePlacement(state);
		cue = cuePlace;
	}
	const candidates = candidateShots(state, cue);
	let best: Candidate = candidates[0] ?? { dirX: 0, dirY: 1, power: 0.5 };
	let bestScore = -Infinity;
	for (const cand of candidates) {
		const res = simulateShot(state, {
			dirX: cand.dirX,
			dirY: cand.dirY,
			power: cand.power,
			spin: { x: 0, y: 0 },
			cuePlace,
		});
		const score = scoreResult(state, res);
		if (score > bestScore) {
			bestScore = score;
			best = cand;
		}
	}
	const angleNoise = gaussian(rng) * difficulty.aimSigma;
	const nx = best.dirX - best.dirY * angleNoise;
	const ny = best.dirY + best.dirX * angleNoise;
	const len = Math.sqrt(nx * nx + ny * ny);
	const power = Math.min(Math.max(best.power * (1 + gaussian(rng) * difficulty.powerSigma), 0.12), 1);
	return { dirX: nx / len, dirY: ny / len, power, spin: { x: 0, y: 0 }, cuePlace };
}

// The server-side sidekick turn: chain AI shots until the turn passes or the
// match ends. The stored shot list replays identically on the client.
export function runSidekickTurn(
	state: EightBallState,
	rng: Rng,
	difficulty: EightBallDifficulty = DIFFICULTY.eightBall,
): SidekickTurn<EightBallState, EightBallShot, EightBallEvent> {
	let cur = state;
	const shots: EightBallShot[] = [];
	const events: EightBallEvent[] = [];
	while (cur.toMove === 'sidekick' && cur.winner === null && shots.length < 12) {
		const shot = chooseShot(cur, rng, difficulty);
		const res = simulateShot(cur, shot);
		shots.push(shot);
		events.push(...res.events);
		cur = res.finalState;
	}
	return {
		shots,
		events,
		finalState: { ...cur, lastTurn: { actor: 'sidekick', shots, pre: preTurnSnapshot(state) } },
	};
}
