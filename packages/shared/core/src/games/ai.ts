// Shared AI plumbing for the chat mini-games: the seeded RNG (core's
// mulberry32) plus the static v1 difficulty profile — one execution-noise knob
// per game, tuned in tests/games-ai.test.ts to a ~45–55% win rate against a
// scripted baseline.

export { mulberry32 } from '../rng';

export type Rng = () => number;

// Irwin–Hall gaussian (sum of 12 uniforms − 6): only + and the rng, so it is
// deterministic on every runtime (Box–Muller's log/cos are not).
export function gaussian(rng: Rng): number {
	let s = 0;
	for (let i = 0; i < 12; i++) s += rng();
	return s - 6;
}

export type EightBallDifficulty = {
	// σ of the aim perturbation, in radians (applied as a small-angle rotation)
	aimSigma: number;
	// σ of the multiplicative power perturbation
	powerSigma: number;
};

export type CupPongDifficulty = {
	// σ of the 2D landing-point offset, in table units per axis
	sigma: number;
};

export type Difficulty = {
	eightBall: EightBallDifficulty;
	cupPong: CupPongDifficulty;
};

export const DIFFICULTY: Difficulty = {
	eightBall: { aimSigma: 0.04, powerSigma: 0.08 },
	cupPong: { sigma: 0.052 },
};
