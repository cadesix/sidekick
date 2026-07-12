import { STEPS } from "./manifest";
import type { BigFiveTrait } from "./types";

// Scores the 20 Big Five (OCEAN) answers, then maps the profile to one of our own
// branded "sidekick" archetypes. The Big Five math is the grounding; the names and
// language are ours (no MBTI codes/terminology surfaced). Illustrative, not clinical.

const TRAITS: BigFiveTrait[] = ["O", "C", "E", "A", "N"];

const ITEMS = STEPS.flatMap((s) => (s.type === "personality" ? [s.question] : []));

export type TraitScores = Record<BigFiveTrait, number>; // 1..5

export function scoreTraits(answers?: Record<string, string>): TraitScores {
	const a = answers ?? {};
	const buckets: Record<BigFiveTrait, number[]> = { O: [], C: [], E: [], A: [], N: [] };
	for (const item of ITEMS) {
		const raw = Number(a[item.id]);
		const v = Number.isFinite(raw) && raw >= 1 && raw <= 5 ? (item.reverse ? 6 - raw : raw) : 3;
		buckets[item.trait].push(v);
	}
	const out = {} as TraitScores;
	for (const t of TRAITS) {
		const arr = buckets[t];
		out[t] = arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 3;
	}
	return out;
}

const pct = (score: number) => Math.round(((score - 1) / 4) * 100);

type Archetype = { name: string; tagline: string; blurb: string };

// Internal 4-axis key (from the Big Five) → our own archetype. The key is never shown.
const ARCHETYPES: Record<string, Archetype> = {
	// reserved / imaginative / logical / structured
	INTJ: {
		name: "The Strategist",
		tagline: "Independent, far-sighted, built to plan.",
		blurb:
			"You see the system behind everything and love a plan you can optimize. You'll thrive on goals you can refine over time — just remember that steady progress beats waiting for the perfect approach.",
	},
	INTP: {
		name: "The Tinkerer",
		tagline: "Curious, analytical, endlessly inquisitive.",
		blurb:
			"You want to understand how things work before you commit. Your habits stick best when they leave room to experiment, question, and learn as you go.",
	},
	ENTJ: {
		name: "The Driver",
		tagline: "Decisive, ambitious, ready to lead.",
		blurb:
			"You turn ambition into action and naturally take charge. You move fast — building in recovery time is what keeps your momentum sustainable.",
	},
	ENTP: {
		name: "The Maverick",
		tagline: "Inventive, quick, energized by ideas.",
		blurb:
			"You chase the ideas that excite you and love a fresh angle. Variety and a little friendly challenge are what keep you on track.",
	},
	INFJ: {
		name: "The Guide",
		tagline: "Insightful, principled, quietly determined.",
		blurb:
			"You commit deeply to goals that match your values. Tie your habits to something meaningful and you'll go the distance.",
	},
	INFP: {
		name: "The Dreamer",
		tagline: "Imaginative, values-led, deeply felt.",
		blurb:
			"You're moved by personal meaning more than metrics. Gentle, values-based goals will carry you further than rigid streaks ever could.",
	},
	ENFJ: {
		name: "The Inspirer",
		tagline: "Warm, motivating, people-powered.",
		blurb:
			"You grow fastest when your goals connect you to other people. Accountability and a little encouragement are your superpowers.",
	},
	ENFP: {
		name: "The Free Spirit",
		tagline: "Enthusiastic, imaginative, up for anything.",
		blurb:
			"You run on novelty, inspiration, and connection. Keep things playful and flexible and your energy will do the rest.",
	},
	ISTJ: {
		name: "The Backbone",
		tagline: "Dependable, thorough, steady as they come.",
		blurb:
			"You build change through consistency and clear routines. Once a system clicks for you, you'll stick to it like clockwork.",
	},
	ISFJ: {
		name: "The Caretaker",
		tagline: "Caring, reliable, quietly devoted.",
		blurb:
			"You show up steadily, especially for the people you love. Practical, supportive routines suit you best.",
	},
	ESTJ: {
		name: "The Captain",
		tagline: "Organized, driven, great at execution.",
		blurb:
			"You like structure, clear targets, and getting things done. Concrete milestones are what keep you motivated.",
	},
	ESFJ: {
		name: "The Connector",
		tagline: "Sociable, supportive, team-first.",
		blurb:
			"You flourish with shared goals and a sense of contribution. Community and routine keep you consistent.",
	},
	ISTP: {
		name: "The Maker",
		tagline: "Practical, hands-on, adaptable.",
		blurb:
			"You learn by doing and prefer flexibility over rigid plans. Hands-on, low-friction habits work best for you.",
	},
	ISFP: {
		name: "The Wanderer",
		tagline: "Gentle, spontaneous, led by feel.",
		blurb:
			"You follow what feels right in the moment. Keep your goals flexible and a little sensory-rich and they'll stick.",
	},
	ESTP: {
		name: "The Go-Getter",
		tagline: "Bold, action-first, thrives on a challenge.",
		blurb:
			"You love a challenge and immediate results. Fast feedback and a bit of competition are what keep you going.",
	},
	ESFP: {
		name: "The Spark",
		tagline: "Spontaneous, playful, lives in the moment.",
		blurb:
			"You thrive on fun, people, and the present moment. Make your habits enjoyable and social and you'll keep at them.",
	},
};

export type Personality = {
	name: string;
	tagline: string;
	blurb: string;
	traits: TraitScores;
	percents: Record<BigFiveTrait, number>;
};

export function computePersonality(answers?: Record<string, string>): Personality {
	const t = scoreTraits(answers);
	// Internal key from the Big Five poles (mirrors the classic 4-axis split, but the
	// key is only used to look up our own archetype — it is never displayed).
	const key =
		(t.E >= 3 ? "E" : "I") +
		(t.O >= 3 ? "N" : "S") +
		(t.A >= 3 ? "F" : "T") +
		(t.C >= 3 ? "J" : "P");
	const a = ARCHETYPES[key] ??
		ARCHETYPES.INFP ?? { name: "The Original", tagline: "One of a kind.", blurb: "A rare mix." };
	return {
		name: a.name,
		tagline: a.tagline,
		blurb: a.blurb,
		traits: t,
		percents: { O: pct(t.O), C: pct(t.C), E: pct(t.E), A: pct(t.A), N: pct(t.N) },
	};
}
