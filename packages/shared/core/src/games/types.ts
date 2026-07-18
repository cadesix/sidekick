// Chat mini-games (plans/21-games.md): shared match/state/shot types + zod
// schemas. The server validates client-submitted jsonb with these, so every
// schema is strict (unknown keys rejected) and size-bounded (fixed-length ball
// arrays, bounded numbers, capped shot lists).

import { z } from 'zod';

export const gameTypeSchema = z.enum(['eight_ball', 'cup_pong']);
export type GameType = z.infer<typeof gameTypeSchema>;

export const gameActorSchema = z.enum(['user', 'sidekick']);
export type GameActor = z.infer<typeof gameActorSchema>;

// Engine event tags ('pot:5', 'scratch', 'balls_back', …). Kept as bounded
// strings at the validation boundary; the engines emit the typed unions below.
export const gameEventSchema = z.string().min(1).max(32);
export const gameEventsSchema = z.array(gameEventSchema).max(64);

export type EightBallEvent =
	| 'break'
	| `pot:${number}`
	| 'scratch'
	| 'cue_off_table'
	| 'foul_wrong_group'
	| 'group_assigned:solids'
	| 'group_assigned:stripes'
	| 'early_8'
	| 'scratch_on_8'
	| 'win'
	| 'loss';

export type CupPongEvent =
	| `cup:${number}`
	| 'rim_miss'
	| 'miss'
	| 'balls_back'
	| 'rerack:6'
	| 'rerack:3'
	| 'win';

const coord = z.number().finite().min(-1).max(3);
const unit = z.number().finite().min(-1).max(1);

// Aim is a unit direction vector, not an angle: the engines never call trig,
// so a stored shot replays byte-identically on every runtime.
export const eightBallShotSchema = z
	.object({
		dirX: unit,
		dirY: unit,
		power: z.number().finite().gt(0).max(1),
		spin: z.object({ x: unit, y: unit }).strict(),
		// ball-in-hand placement for this shot; null when shooting from where the cue lies
		cuePlace: z.object({ x: coord, y: coord }).strict().nullable(),
	})
	.strict()
	.refine((s) => {
		const m = s.dirX * s.dirX + s.dirY * s.dirY;
		return m > 0.81 && m < 1.21;
	}, 'dir must be a unit vector');
export type EightBallShot = z.infer<typeof eightBallShotSchema>;

// Persisted states are always settled, so balls carry no velocities.
export const eightBallBallSchema = z.object({ x: coord, y: coord, pocketed: z.boolean() }).strict();
export type EightBallBall = z.infer<typeof eightBallBallSchema>;

// The settled snapshot a turn started from — the minimal data the client needs
// to replay the stored shots through the engine (continuous ball positions make
// reconstruction from the final state impossible, so it travels with the turn).
export const eightBallPreTurnSchema = z
	.object({
		balls: z.array(eightBallBallSchema).length(16),
		ballInHand: z.boolean(),
		userGroup: z.enum(['solids', 'stripes']).nullable(),
	})
	.strict();
export type EightBallPreTurn = z.infer<typeof eightBallPreTurnSchema>;

export const eightBallLastTurnSchema = z
	.object({ actor: gameActorSchema, shots: z.array(eightBallShotSchema).max(24), pre: eightBallPreTurnSchema })
	.strict();

export const eightBallStateSchema = z
	.object({
		version: z.literal(1),
		// index 0 is the cue ball; 1..15 are the numbered balls
		balls: z.array(eightBallBallSchema).length(16),
		// null while the table is open; the sidekick always has the other group
		userGroup: z.enum(['solids', 'stripes']).nullable(),
		toMove: gameActorSchema,
		ballInHand: z.boolean(),
		winner: gameActorSchema.nullable(),
		// the most recent completed turn, for replaying in the next card
		lastTurn: eightBallLastTurnSchema.nullable(),
	})
	.strict();
export type EightBallState = z.infer<typeof eightBallStateSchema>;

// A cup-pong throw: lateral aim + power, both normalized. Landing point is a
// pure linear map of this (see cup-pong.ts), so a stored flick replays exactly.
export const cupPongFlickSchema = z
	.object({
		x: unit,
		power: z.number().finite().min(0).max(1),
	})
	.strict();
export type CupPongFlick = z.infer<typeof cupPongFlickSchema>;

// Re-racks at 6 and 3 normalize a side's mask onto the smaller rack's low
// bits, so bits outside the count's rack tier are invalid states.
function isNormalizedCupMask(mask: number): boolean {
	let count = 0;
	for (let bit = 0; bit < 10; bit++) {
		if (mask & (1 << bit)) count++;
	}
	if (count >= 7) return true;
	if (count >= 4) return mask < 64;
	return mask < 8;
}

const cupMask = z.number().int().min(0).max(1023).refine(isNormalizedCupMask, 'unnormalized cup mask');

// A turn always starts on a fresh 2-ball set, so the cup masks alone replay it.
export const cupPongPreTurnSchema = z
	.object({ cups: z.object({ user: cupMask, sidekick: cupMask }).strict() })
	.strict();
export type CupPongPreTurn = z.infer<typeof cupPongPreTurnSchema>;

export const cupPongLastTurnSchema = z
	.object({ actor: gameActorSchema, shots: z.array(cupPongFlickSchema).max(40), pre: cupPongPreTurnSchema })
	.strict();

export const cupPongStateSchema = z
	.object({
		version: z.literal(1),
		// bitmask of standing cup slots per OWNER side (the opponent shoots at them)
		cups: z.object({ user: cupMask, sidekick: cupMask }).strict(),
		toMove: gameActorSchema,
		// throws left in the current 2-ball set / hits so far in it (balls-back).
		// 0 is valid in a terminal (won) state: the winning cup can fall on the
		// second ball of a set, ending the game before the set resets.
		turnBalls: z.number().int().min(0).max(2),
		turnHits: z.number().int().min(0).max(1),
		winner: gameActorSchema.nullable(),
		lastTurn: cupPongLastTurnSchema.nullable(),
	})
	.strict();
export type CupPongState = z.infer<typeof cupPongStateSchema>;

export type SidekickTurn<State, Shot, Event> = {
	shots: Shot[];
	events: Event[];
	finalState: State;
};
