import { addBond } from "./sidekick-bond";
import { addCoins } from "./sidekick-economy";

// Guided sessions (docs/guided-sessions.md): every island is locked behind ONE
// session. Sessions are declarative — scripted asks with free-text answers, an
// LLM extraction pass at the end (fields + verbatim notes), and progress that
// persists per beat so the user can dive in and out. This module is the
// session catalog + the context store the whole product reads.

export type SessionBeat = {
	id: string;
	ask: string[]; // scripted bubbles, last one is the question
	probe?: boolean; // allow ONE LLM follow-up on a substantial answer
};

export type SessionDef = {
	id: string; // island id (map area id)
	title: string;
	tease: string; // one-line topic descriptor for the map's topic card
	topic: string; // spoken phrase: "chat with me about {topic} to unlock…"
	minutes: number;
	bond: number; // % gained on completion
	coins: number;
	// heavy topics: soft acknowledgments, never probe, skips respected silently
	sensitive?: boolean;
	intro: string[];
	beats: SessionBeat[];
	schema: { fields: string[]; notes: string[] };
};

// Session order = conversational-value order: collect the context that makes
// every future chat richer FIRST (who you are, what you're into, where you're
// from), then wiring, goals, and the deep stuff. Sessions run in sequence;
// each island unlocks when its session completes.
export const SESSIONS: SessionDef[] = [
	{
		id: "frostpeak",
		topic: "yourself",
		title: "About You",
		tease: "the basics of your life",
		minutes: 3,
		bond: 6,
		coins: 15,
		intro: [
			"i wanna actually get to know you 🩷 not the surface stuff, the real you",
			"we'll start super easy, promise. just paint me a little picture of your life right now",
		],
		beats: [
			{ id: "chronotype", ask: ["easy one first, are you a morning person or a total night owl?"] },
			{ id: "weekday", ask: ["what do your days mostly look like right now? work, kids, studying, a mix of everything?"] },
			{ id: "locale", ask: ["and where are you based? city girl, suburbs, small town?"] },
			{ id: "household", ask: ["who's in your everyday world? partner, kids, roommates, or just you and your peace?"] },
			{ id: "occupation", ask: ["what do you actually do?", "like if we met at a party and i asked, what would you say?"], probe: true },
			{ id: "tuesday", ask: ["okay last one, walk me through a normal day for you, start to finish, speedrun it"], probe: true },
		],
		schema: {
			fields: ["chronotype", "occupation_type", "occupation", "field", "locale_type", "household"],
			notes: ["weekday_note"],
		},
	},
	{
		id: "pinewood",
		topic: "what you're into",
		title: "Taste Check",
		tease: "what you love + who you love",
		minutes: 3,
		bond: 6,
		coins: 15,
		intro: [
			"okay let's talk about the fun stuff, what you're actually into",
			"this is how i learn what makes you *you*",
		],
		beats: [
			{ id: "media", ask: ["what are you watching, listening to, or reading right now? give me the current obsession"], probe: true },
			{ id: "unwind", ask: ["how do you actually recharge when you're running on empty? honest version, not the aspirational one"] },
			{ id: "apps", ask: ["what app do you open way too much? no judgment, i promise lol"] },
			{ id: "closest", ask: ["who's your person? the one you text literally everything to"], probe: true },
			{ id: "lovelang", ask: ["and how do you feel most loved? words, quality time, little gifts, a good hug?"] },
			{ id: "battery", ask: ["do people fill you up, or do you need alone time to feel like yourself again?"] },
		],
		schema: {
			fields: ["unwind", "screen_apps", "closest_tie", "love_language", "social_energy"],
			notes: ["media_note", "people_note"],
		},
	},
	{
		id: "blossom",
		topic: "where you're from",
		title: "Where You're From",
		tease: "your roots + what shaped you",
		minutes: 3,
		bond: 7,
		coins: 15,
		sensitive: true,
		intro: [
			"this one goes a little deeper, where you come from and what shaped you",
			"share whatever feels right. you can skip anything, always 🤍",
		],
		beats: [
			{ id: "hometown", ask: ["where'd you grow up?"] },
			{ id: "place", ask: ["what was it like there? the vibe, the feeling of the place"] },
			{ id: "house", ask: ["and home growing up, what was the energy? loud and full, quiet, strict, somewhere in between?"] },
			{ id: "shapes", ask: ["what's one thing from back then that still shapes who you are today?"] },
			{ id: "different", ask: ["anything you're doing really intentionally different from how you were raised?"] },
		],
		schema: { fields: ["hometown", "origin_type", "upbringing"], notes: ["roots_note"] },
	},
	{
		id: "dunes",
		topic: "how you're wired",
		title: "How You're Wired",
		tease: "your personality + your energy",
		minutes: 4,
		bond: 7,
		coins: 15,
		intro: [
			"okay now the good stuff, how you're actually wired",
			"personality, energy, all of it. this is my favorite kind of conversation",
		],
		beats: [
			{ id: "sign", ask: ["first, the important question 😌 what's your sign? ⭐️", "and be real, do you feel like a typical one?"], probe: true },
			{ id: "type", ask: ["do you know your enneagram or mbti? or even just the general vibe of your type?"] },
			{ id: "values", ask: ["what matters most to you deep down? feeling free, feeling connected, feeling secure, feeling seen?"] },
			{ id: "stress", ask: ["when you're overwhelmed, what do you actually do? go quiet, spiral, keep busy, shut down?"] },
			{ id: "misread", ask: ["what do people get wrong about you when they first meet you?"], probe: true },
			{ id: "greatday", ask: ["describe a day that just *feels* good to you", "not a big vacation, an ordinary day that fills you up"], probe: true },
		],
		schema: {
			fields: ["zodiac", "personality_type", "core_values", "stress_response"],
			notes: ["self_note", "great_day_note"],
		},
	},
	{
		id: "palmcove",
		topic: "your goals and dreams",
		title: "Goals & Dreams",
		tease: "where you're headed",
		minutes: 4,
		bond: 8,
		coins: 20,
		intro: [
			"let's dream a little, where you're headed and what you actually want",
			"i wanna know what you're working toward so i can help you get there",
		],
		beats: [
			{ id: "y1", ask: ["a year from now, what feels different in your life? what's changed?"], probe: true },
			{ id: "y5", ask: ["okay now go bigger. five years, no realism allowed. paint me the dream"], probe: true },
			{ id: "skill", ask: ["what's something you wish you could just… have or be amazing at overnight?"] },
			{ id: "money", ask: ["quick one, spender, saver, or beautiful chaos? 💸"] },
			{ id: "saving", ask: ["saving up for anything big right now?"] },
			{ id: "calling", ask: ["if money genuinely wasn't a thing, what would you spend your days doing?"], probe: true },
		],
		schema: {
			fields: ["skill_wants", "money_style", "saving_targets"],
			notes: ["goal_1yr_note", "dream_note", "calling_note"],
		},
	},
	{
		id: "ember",
		topic: "the deep stuff",
		title: "The Deep Stuff",
		tease: "the real, tender stuff",
		minutes: 4,
		bond: 8,
		coins: 20,
		sensitive: true,
		intro: [
			"okay. the real, tender stuff. only if you're up for it",
			"no judgment here, ever. and you can skip anything, no explanation needed 🤍",
		],
		beats: [
			{ id: "blocker", ask: ["what's the thing that tends to get in your way the most?"] },
			{ id: "procrastinate", ask: ["when you're avoiding something, what does that actually look like for you?"] },
			{ id: "pattern", ask: ["is there a pattern you catch yourself repeating? we all have one"] },
			{ id: "tried", ask: ["what's something you've really tried before that just didn't stick?", "and what almost worked?"] },
			{ id: "fear", ask: ["and gently, is there a fear that quietly drives more of your choices than you'd like to admit?"] },
		],
		schema: { fields: [], notes: ["blocker_note", "history_note", "fear_note"] },
	},
];

export const sessionFor = (id: string): SessionDef | undefined => SESSIONS.find((s) => s.id === id);

// ---- the context store -------------------------------------------------------

export const CONTEXT_KEY = "sidekick_context_v1";
export const CONTEXT_EVENT = "sidekick:context";

export type ContextNote = { tag: string; text: string; session: string; ts: number };
export type SessionState = { beat: number; answers: string[]; done: boolean; completedAt?: number };
export type SidekickContext = {
	fields: Record<string, string>;
	notes: ContextNote[];
	sessions: Record<string, SessionState>;
};

export function loadContext(): SidekickContext {
	try {
		const raw = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? "{}") ?? {};
		return { fields: raw.fields ?? {}, notes: raw.notes ?? [], sessions: raw.sessions ?? {} };
	} catch {
		return { fields: {}, notes: [], sessions: {} };
	}
}

function saveContext(ctx: SidekickContext): void {
	try {
		localStorage.setItem(CONTEXT_KEY, JSON.stringify(ctx));
	} catch {
		// storage blocked
	}
	window.dispatchEvent(new CustomEvent(CONTEXT_EVENT));
}

export function sessionState(id: string): SessionState {
	return loadContext().sessions[id] ?? { beat: 0, answers: [], done: false };
}

export function saveSessionProgress(id: string, beat: number, answers: string[]): void {
	const ctx = loadContext();
	ctx.sessions[id] = { ...(ctx.sessions[id] ?? { done: false }), beat, answers, done: false };
	saveContext(ctx);
}

// completion: merge extracted context, mark done, pay out bond + coins
export function completeSession(id: string, fields: Record<string, string>, notes: { tag: string; text: string }[]): void {
	const def = sessionFor(id);
	const ctx = loadContext();
	ctx.fields = { ...ctx.fields, ...fields };
	const ts = Date.now();
	for (const n of notes) ctx.notes.push({ ...n, session: id, ts });
	ctx.sessions[id] = { beat: def?.beats.length ?? 0, answers: ctx.sessions[id]?.answers ?? [], done: true, completedAt: ts };
	saveContext(ctx);
	if (def) {
		addBond(def.bond);
		addCoins(def.coins);
	}
}

export const isSessionDone = (id: string): boolean => sessionState(id).done;

// ladder: startable once every session before it is done
export function isSessionStartable(id: string): boolean {
	for (const s of SESSIONS) {
		if (s.id === id) return true;
		if (!isSessionDone(s.id)) return false;
	}
	return false;
}

// the first not-done session in ladder order (undefined = all done)
export const nextSession = (): SessionDef | undefined => SESSIONS.find((s) => !isSessionDone(s.id));

// a session with answered beats but not finished — feeds the chat's continue card
export function sessionInProgress(): { def: SessionDef; state: SessionState } | null {
	for (const def of SESSIONS) {
		const st = sessionState(def.id);
		if (!st.done && st.answers.some((a) => a && a.length)) return { def, state: st };
	}
	return null;
}
