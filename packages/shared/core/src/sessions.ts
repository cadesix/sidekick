// Guided sessions (docs/guided-sessions.md): every island is locked behind ONE
// session. Sessions are declarative — scripted asks with free-text answers, an
// LLM extraction pass at the end (fields + verbatim notes), and progress that
// persists per beat so the user can dive in and out.
//
// This module is the platform-agnostic session CATALOG plus PURE ladder helpers
// that take the session-state map as an argument (they never read storage). The
// app layers own persistence: web keeps it in a localStorage context blob, the
// Expo app in a zustand + AsyncStorage store. Both compute identically from here.

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

// Per-session progress. The app stores a Record<sessionId, SessionState> and
// hands it to the helpers below. `beat` is the next beat to resume at.
export type SessionState = { beat: number; answers: string[]; done: boolean; completedAt?: number };
export type SessionsState = Record<string, SessionState>;

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
			"ok this one's easy mode. just the basics of your life",
			"answer as lazy as you want, i'll keep up",
		],
		beats: [
			{ id: "chronotype", ask: ["morning person or night owl? be honest"] },
			{ id: "weekday", ask: ["what's your weekday situation, school, work, both, figuring it out?"] },
			{ id: "occupation", ask: ["so what do you do?", "and like, what do you actually DO day to day"], probe: true },
			{ id: "locale", ask: ["where do you live, big city, suburbs, small town?"] },
			{ id: "household", ask: ["who's at home, roommates, family, partner, just you?"] },
			{ id: "tuesday", ask: ["last one. walk me through a random tuesday, speedrun version"], probe: true },
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
		tease: "what you're into + who you're around",
		minutes: 3,
		bond: 6,
		coins: 15,
		intro: ["this one's fun. what you're actually into", "zero wrong answers, only revealing ones"],
		beats: [
			{ id: "media", ask: ["what's on repeat right now, music, shows, games, whatever"], probe: true },
			{ id: "unwind", ask: ["how do you actually unwind, honest version"] },
			{ id: "apps", ask: ["any app you open way too much?"] },
			{ id: "closest", ask: ["who do you actually talk to most?"], probe: true },
			{ id: "battery", ask: ["does being around people fill you up or drain you?"] },
		],
		schema: {
			fields: ["unwind", "screen_apps", "closest_tie", "social_energy"],
			notes: ["media_note", "people_note"],
		},
	},
	{
		id: "blossom",
		topic: "where you're from",
		title: "Where You're From",
		tease: "your past + what shaped you",
		minutes: 3,
		bond: 7,
		coins: 15,
		sensitive: true,
		intro: [
			"ok this one goes a little deeper. where you come from",
			"share as much or as little as you want. skip is right there, no explanation needed",
		],
		beats: [
			{ id: "hometown", ask: ["where'd you grow up?"] },
			{ id: "place", ask: ["what kind of place was it?"] },
			{ id: "house", ask: ["and what kind of house, loud, quiet, strict, chill?"] },
			{ id: "shapes", ask: ["what's one thing from back home that still shapes you?"] },
			{ id: "different", ask: ["anything you're deliberately doing DIFFERENT from how you grew up?"] },
		],
		schema: { fields: ["hometown", "origin_type", "upbringing"], notes: ["roots_note"] },
	},
	{
		id: "dunes",
		topic: "how you're wired",
		title: "How You're Wired",
		tease: "personality + what drives you",
		minutes: 4,
		bond: 7,
		coins: 15,
		intro: ["this island's about how your brain works", "no wrong answers, just true ones"],
		beats: [
			{ id: "personality", ask: ["describe your personality in one line. whatever comes first"], probe: true },
			{ id: "planner", ask: ["planner or wing-it person?"] },
			{ id: "stress", ask: ["when you're stressed, what do you actually do? shut down, speed up, snap, doomscroll?"] },
			{ id: "misread", ask: ["what do people usually get wrong about you?"], probe: true },
			{ id: "drives", ask: ["what actually drives you, winning, freedom, people, security, peace?"] },
			{ id: "greatday", ask: ["describe a genuinely great day", "not a vacation day. a normal great day"], probe: true },
		],
		schema: {
			fields: ["personality", "planning_style", "stress_response", "core_drives"],
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
		intro: ["ok. the fun one", "goals, dreams, the whole future thing"],
		beats: [
			{ id: "y1", ask: ["one year from now, what's different?"], probe: true },
			{ id: "y5", ask: ["ok now the 5-year version. no realism allowed"], probe: true },
			{ id: "skill", ask: ["what skill do you wish you just… had?"] },
			{ id: "money", ask: ["are you a spender, a saver, or chaos?"] },
			{ id: "saving", ask: ["saving for anything big right now?"] },
			{ id: "calling", ask: ["what would you do if money wasn't a thing?"], probe: true },
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
		tease: "the real talk",
		minutes: 4,
		bond: 8,
		coins: 20,
		sensitive: true,
		intro: ["last island. the real stuff", "no judgment in here. ever"],
		beats: [
			{ id: "blocker", ask: ["real talk: what gets in your way the most?"] },
			{ id: "procrastinate", ask: ["when you procrastinate, what does it actually look like?"] },
			{ id: "pattern", ask: ["what's the pattern you keep repeating?"] },
			{ id: "tried", ask: ["what have you tried before that didn't stick?", "and what almost worked?"] },
			{ id: "fear", ask: ["what's a fear that drives more of your decisions than you'd like?"] },
		],
		schema: { fields: [], notes: ["blocker_note", "history_note", "fear_note"] },
	},
];

export const sessionFor = (id: string): SessionDef | undefined => SESSIONS.find((s) => s.id === id);

// ---- pure ladder helpers -----------------------------------------------------
// Each takes the session-state map (never reads storage) so both apps and any
// test compute the same answer.

const DEFAULT_STATE: SessionState = { beat: 0, answers: [], done: false };

export const sessionState = (sessions: SessionsState, id: string): SessionState => sessions[id] ?? DEFAULT_STATE;

export const isSessionDone = (sessions: SessionsState, id: string): boolean => sessionState(sessions, id).done;

// The first island is where you START — it's open from launch, and finishing its
// session opens nothing new. Every other island opens when its own session
// completes. Both facts were hardcoded as a bare 'frostpeak' literal at each
// call site; they live here so the ladder owns its own rule.
export const isIslandOpenAtStart = (id: string): boolean => SESSIONS[0]?.id === id;

// does an island become newly available when its session completes?
export const islandOpensWith = (id: string): boolean => !isIslandOpenAtStart(id);

export const isIslandUnlocked = (sessions: SessionsState, id: string): boolean =>
	isIslandOpenAtStart(id) || isSessionDone(sessions, id);

// ladder: startable once every session before it (in SESSIONS order) is done
export function isSessionStartable(sessions: SessionsState, id: string): boolean {
	for (const s of SESSIONS) {
		if (s.id === id) return true;
		if (!isSessionDone(sessions, s.id)) return false;
	}
	return false;
}

// the first not-done session in ladder order (undefined = all done)
export const nextSession = (sessions: SessionsState): SessionDef | undefined =>
	SESSIONS.find((s) => !isSessionDone(sessions, s.id));

// a session with answered beats but not finished — feeds the chat's continue card
export function sessionInProgress(sessions: SessionsState): { def: SessionDef; state: SessionState } | null {
	for (const def of SESSIONS) {
		const st = sessionState(sessions, def.id);
		if (!st.done && st.answers.some((a) => a && a.length)) return { def, state: st };
	}
	return null;
}
