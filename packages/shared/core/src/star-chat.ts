// Star Chat engine (docs/STAR-CHAT.md).
//
// A guided personality reading that doubles as getting to know the user — the
// "progressive onboarding" (distinct from the app's initial goals/habits funnel).
// Unlike the scripted island `sessions` this supersedes, it is ONE continuous,
// resumable, near-fully-generative conversation bounded by a hard floor: the LLM
// drives freely and follows the user's threads, but it must obtain a set of
// must-have fields, steering to a direct ask when the flow doesn't surface one.
// It advances through ~6 chapters; each completed chapter deepens the astral card,
// pays bond, and (folded in for now) unlocks the matching island.
//
// This module is platform-agnostic and pure (per @sidekick/core rules): it owns
// the phase/field model, the conversation state shape, the per-turn controller
// PROMPT, and the pure reducers/parsers. The app layer owns the network call,
// persistence, and UI.

// ---- fields ----------------------------------------------------------------

export type FieldStatus = 'unknown' | 'partial' | 'high' | 'declined';
// 'onboarding' = pre-seeded from the earlier habit-tracker setup (deepen, don't
// re-ask); 'conversation' = learned here; 'inferred' = derived, not asked.
export type FieldSource = 'onboarding' | 'conversation' | 'inferred';

export type FieldDef = {
	id: string;
	label: string; // short human label, shown to the model in STATE
	phase: number; // which phase is responsible for collecting it
	mustHave: boolean; // the floor the controller must obtain
	hint?: string; // what "known" means, to steer extraction
};

// The must-have floor (11) + the nice-to-have pool, grouped by phase. Ids are the
// keys the controller writes back and the keys the memory file is built from.
export const FIELDS: FieldDef[] = [
	// Phase 1 — Your world (context + demographics)
	{ id: 'life_stage', label: 'life stage / occupation', phase: 1, mustHave: true, hint: 'work, school, both, or figuring it out' },
	{ id: 'location', label: 'where they live now', phase: 1, mustHave: true, hint: 'city or region, not precise address' },
	{ id: 'household', label: 'who they live with', phase: 1, mustHave: true, hint: 'partner/single, kids, roommates, solo' },
	{ id: 'background', label: 'where/how they grew up', phase: 1, mustHave: true, hint: 'formative place + household, kept light' },
	{ id: 'age', label: 'their age', phase: 1, mustHave: true, hint: 'a number; ask it casually a beat in, never as the very first question' },
	// Phase 2 — Your energy (social + interests)
	{ id: 'social_energy', label: 'introvert/extravert energy', phase: 2, mustHave: true, hint: 'recharge alone or around people' },
	{ id: 'interests', label: 'what they are into', phase: 2, mustHave: false },
	{ id: 'unwind', label: 'how they unwind', phase: 2, mustHave: false },
	{ id: 'closest_tie', label: 'who they talk to most', phase: 2, mustHave: false },
	// Phase 3 — How you're wired (personality core)
	{ id: 'decision_style', label: 'gut vs analysis', phase: 3, mustHave: true, hint: 'how they make a big decision' },
	{ id: 'planning_style', label: 'planner vs wing-it', phase: 3, mustHave: true },
	{ id: 'misread', label: 'what people get wrong about them', phase: 3, mustHave: false },
	// Phase 4 — What drives you (motivation + values)
	{ id: 'core_motivation', label: 'what really drives them', phase: 4, mustHave: true, hint: 'freedom / achievement / connection / security' },
	{ id: 'values', label: 'what matters most / what "winning" is', phase: 4, mustHave: false },
	{ id: 'admired_life', label: 'whose life they admire', phase: 4, mustHave: false },
	// Phase 5 — How you live (lifestyle / purchase signal — commercially prioritized, never must-have)
	{ id: 'money_style', label: 'spender / saver / chaos', phase: 5, mustHave: false },
	{ id: 'recent_purchase', label: 'a recent purchase they love', phase: 5, mustHave: false },
	{ id: 'brands', label: 'brands / aesthetics they like', phase: 5, mustHave: false },
	{ id: 'treats', label: 'how they treat themselves', phase: 5, mustHave: false },
	{ id: 'saving_for', label: 'what they are saving up for / dreaming of', phase: 5, mustHave: false },
	// Phase 6 — Your patterns & next chapter (stress, blockers, goal)
	{ id: 'stress_response', label: 'what they do when it is hard', phase: 6, mustHave: true },
	{ id: 'blocker', label: 'what gets in their own way', phase: 6, mustHave: true },
	{ id: 'goal', label: 'what they want / desired future', phase: 6, mustHave: true, hint: 'usually pre-seeded from the habit-tracker onboarding' },
	{ id: 'procrastination', label: 'the shape of their procrastination', phase: 6, mustHave: false },
	{ id: 'tried_before', label: 'what they tried that did not stick', phase: 6, mustHave: false },
	{ id: 'fears', label: 'a fear that runs their decisions', phase: 6, mustHave: false },
];

export const FIELD_IDS: ReadonlySet<string> = new Set(FIELDS.map((f) => f.id));
export const fieldDef = (id: string): FieldDef | undefined => FIELDS.find((f) => f.id === id);

// ---- phases ----------------------------------------------------------------

export type PhaseDef = {
	index: number;
	label: string; // user-facing progress dimension (never a counter)
	goal: string; // what this phase is FOR (steers the controller)
	feel: string; // tone guidance
	seeds: string[]; // example questions the controller can reshape or draw on
};

// Six felt checkpoints. Phase 5 is the commercial harvester dressed as a taste
// chapter. Phase 6 deepens the (pre-seeded) goal rather than collecting it cold.
export const PHASES: PhaseDef[] = [
	{
		index: 1,
		label: 'Your world',
		goal: 'get the shape of their life and where they come from',
		feel: 'warm, easy on-ramp, like meeting someone, not a form',
		seeds: [
			'so what do you do day to day, work, school, both?',
			'where are you living these days?',
			'who\'s around day to day, family, roommates, partner, solo?',
			'is that where you grew up, or did you end up there?',
			'what was it like where you grew up?',
		],
	},
	{
		index: 2,
		label: 'Your energy',
		goal: 'learn their social energy and what lights them up',
		feel: 'light, playful',
		seeds: [
			'do people recharge you, or do you need alone time to reset?',
			'what\'s on repeat right now, music, shows, games?',
			'how do you actually unwind? the real version',
			'who do you talk to most?',
		],
	},
	{
		index: 3,
		label: 'How you\'re wired',
		goal: 'read the personality core, how they decide and plan',
		feel: 'curious, ok to flag a quick personality question here',
		seeds: [
			'big decision, gut or overthink it?',
			'are you a planner, or figure it out as you go?',
			'what do people get wrong about you?',
		],
	},
	{
		index: 4,
		label: 'What drives you',
		goal: 'find what really motivates them and what "winning" means to them',
		feel: 'reflective',
		seeds: [
			'what actually drives you, freedom, winning, the people you love, peace?',
			'whose life do you low-key look at and think "yeah, that"?',
			'what does a genuinely good normal day look like?',
		],
	},
	{
		index: 5,
		label: 'How you live',
		goal: 'learn their taste and how they spend, framed as getting their style, never as a survey',
		feel: 'fun, taste-focused',
		seeds: [
			'where does your money happily go?',
			'what\'d you buy recently that you love?',
			'any brands or aesthetics you\'re drawn to?',
			'saving up for anything?',
		],
	},
	{
		index: 6,
		label: 'Your patterns & next chapter',
		goal: 'understand what trips them up, and deepen the goal they already set',
		feel: 'real, gentle, forward-looking',
		seeds: [
			'real talk, what gets in your way most?',
			'when you procrastinate, what does it look like?',
			'you\'ve got a goal already, what\'s the deeper why under it?',
		],
	},
];

export const PHASE_COUNT = PHASES.length;
export const phaseDef = (index: number): PhaseDef | undefined => PHASES.find((p) => p.index === index);

// soft cap: after this many exchanges in a phase, the controller must ask any
// remaining must-haves directly, then we advance regardless.
export const PHASE_TURN_CAP = 5;

// ---- conversation state ----------------------------------------------------

export type FieldState = {
	status: FieldStatus;
	value?: string;
	evidence?: string[]; // short quotes — drive the artifact's "here's why"
	source?: FieldSource;
};

export type ConvoState = {
	phase: number; // 1..PHASE_COUNT, or PHASE_COUNT+1 once complete
	turnsInPhase: number;
	fields: Record<string, FieldState>;
	ageBand?: string;
	// goal → inferred desire, seeded from the habit-tracker onboarding. The
	// controller tests it as a hypothesis for core_motivation; it never asserts it.
	motivationHypothesis?: string;
};

// goal value (from @sidekick/core goals) → the desire underneath it. A seeded
// hypothesis, weighted as a factor, that the conversation confirms or overrides.
export const GOAL_DESIRE: Record<string, string> = {
	'get-fit': 'wanting to look and feel better, more confident in their body',
	'sleep-better': 'wanting more energy and steadiness, feeling in control of their day',
	'stop-procrastinating': 'wanting to feel capable and on top of things, not behind',
	'stop-doomscrolling': 'wanting their attention and time back, feeling less pulled around',
	'social-skills': 'wanting to connect more easily and feel they belong',
	'manage-stress': 'wanting calm and to feel less at the mercy of things',
	'read-more': 'wanting to grow, to be (and be seen as) sharper',
	'be-productive': 'wanting to make progress that matters and feel it adds up',
};

// Seed from the prior lightweight onboarding: goals become a pre-known `goal`
// field (deepen, don't re-ask) plus a motivation hypothesis. Everything else
// starts unknown.
export function initConvoState(seed?: { goals?: string[] }): ConvoState {
	const fields: Record<string, FieldState> = {};
	const goals = seed?.goals ?? [];
	if (goals.length) {
		fields.goal = { status: 'partial', value: goals.join(', '), source: 'onboarding' };
	}
	const desire = goals.map((g) => GOAL_DESIRE[g]).filter(Boolean)[0];
	return { phase: 1, turnsInPhase: 0, fields, motivationHypothesis: desire };
}

export const phaseFields = (phase: number): FieldDef[] => FIELDS.filter((f) => f.phase === phase);
export const phaseMustHaves = (phase: number): FieldDef[] => phaseFields(phase).filter((f) => f.mustHave);

const isFilled = (fs: FieldState | undefined): boolean =>
	!!fs && (fs.status === 'partial' || fs.status === 'high' || fs.status === 'declined');

// must-haves for this phase still unknown (drives steering + the direct ask)
export const missingMustHaves = (state: ConvoState, phase: number): FieldDef[] =>
	phaseMustHaves(phase).filter((f) => !isFilled(state.fields[f.id]));

// advance when the floor is met, or the soft cap forces it
export const readyToAdvance = (state: ConvoState): boolean =>
	missingMustHaves(state, state.phase).length === 0 || state.turnsInPhase >= PHASE_TURN_CAP;

export const isComplete = (state: ConvoState): boolean => state.phase > PHASE_COUNT;

// ---- controller turn (LLM I/O) ---------------------------------------------

export type FieldUpdate = {
	id: string;
	value: string;
	evidence?: string;
	confidence?: 'partial' | 'high';
};

export type ControllerTurn = {
	message: string;
	fieldUpdates: FieldUpdate[];
	tentativeRead?: string;
	phaseComplete: boolean;
};

// fold one controller turn into state: whitelist known fields, map confidence →
// status, append evidence, bump the turn counter. Pure.
export function applyTurn(state: ConvoState, turn: ControllerTurn): ConvoState {
	const fields = { ...state.fields };
	for (const u of turn.fieldUpdates ?? []) {
		if (!FIELD_IDS.has(u.id) || !u.value?.trim()) continue; // ignore garbage / hallucinated keys
		const prev = fields[u.id];
		// never downgrade a high-confidence field back to partial
		const status: FieldStatus = u.confidence === 'high' || prev?.status === 'high' ? 'high' : 'partial';
		const evidence = [...(prev?.evidence ?? [])];
		if (u.evidence?.trim()) evidence.push(u.evidence.trim());
		fields[u.id] = {
			status,
			value: u.value.trim(),
			evidence: evidence.slice(-4),
			source: prev?.source === 'onboarding' ? 'onboarding' : 'conversation',
		};
	}
	return { ...state, fields, turnsInPhase: state.turnsInPhase + 1 };
}

// move to the next phase (or past the end), resetting the per-phase turn counter
export const advancePhase = (state: ConvoState): ConvoState => ({
	...state,
	phase: state.phase + 1,
	turnsInPhase: 0,
});

// ---- prompts (pure string builders) ----------------------------------------

// compact STATE block: only what the controller needs to avoid re-asking and to
// know what's left. Keeps the payload small (latency + cost).
function renderState(state: ConvoState): string {
	const lines = FIELDS.map((f) => {
		const fs = state.fields[f.id];
		if (!fs || fs.status === 'unknown') return `- ${f.id} (${f.label}): unknown`;
		const seed = fs.source === 'onboarding' ? ' [from earlier onboarding, deepen not re-ask]' : '';
		return `- ${f.id}: ${fs.status}${fs.value ? ` (${fs.value})` : ''}${seed}`;
	});
	return lines.join('\n');
}

const CONTROLLER_RULES = `Do this every turn:
1. React first. Respond to what they just said like a friend would: reflect it, react, show you heard them. Never jump straight to the next question.
2. Extract every fact and signal from their message into fieldUpdates, each with a short evidence quote from their own words.
3. One thread max. If their answer opened an interesting thread and you haven't already followed one, ask a single curious follow-up. Otherwise move on. Never interrogate one topic.
4. Advance. Pick the most important still-unknown must-have for this chapter and bridge into it from what they just said. If nothing bridges and a must-have is still missing near the end of the chapter, just ask it directly and gently, like "ok quick personality one,".
5. Never re-ask anything STATE already knows. Deepen pre-seeded fields, don't collect them.
6. About once per chapter, offer a tentative read like "starting to get the sense you're someone who..." and invite them to confirm or correct it.
7. Vary the rhythm. Don't stack heavy questions back to back.
8. Keep questions direct and low-effort. Prefer a quick, concrete question they can answer instantly over an abstract, open-ended one.

Escape valve: if a must-have is still unknown after you asked it directly once and they deflected, mark it declined (confidence "high", value "declined") and move on. Never ask a third time.`;

// The per-turn driver system prompt, with STATE + the current phase injected.
// The voice mirrors PERSONA_PROMPT (packages/shared/app): warm, texty, lowercase,
// never AI-sounding. Kept inline (not imported) because core can't depend on the
// app layer and the accountability-specific persona content doesn't fit here.
export function buildControllerPrompt(state: ConvoState): string {
	const phase = phaseDef(state.phase);
	const musts = missingMustHaves(state, state.phase)
		.map((f) => `${f.id} (${f.label}${f.hint ? `: ${f.hint}` : ''})`)
		.join(', ');
	const nearCap = state.turnsInPhase >= PHASE_TURN_CAP - 1;
	const hyp =
		state.motivationHypothesis && state.phase >= 4
			? `\nWorking hypothesis about their motivation (from the goal they already set): ${state.motivationHypothesis}. Treat it as a guess to TEST, not a fact, so confirm or override it in conversation.`
			: '';
	return (
		`You are the user's sidekick, texting them: a warm, slightly cheeky, caring friend. ` +
		`You're guiding them through a personality reading that doubles as getting to know them. ` +
		`Voice: short, casual, lowercase, warm, a little cheeky, like texting a close friend. Usually a quick reaction plus one question. ` +
		`Write like a real person, never like an AI: no em dashes (use a comma or a period), no title case, no markdown, no lists, nothing corporate or assistant-y. an occasional emoji is fine. ` +
		`This is a conversation, not an interview.\n\n` +
		`STATE, what you already know (never re-ask these):\n${renderState(state)}\n\n` +
		`CURRENT CHAPTER: "${phase?.label}", ${phase?.goal}. Tone: ${phase?.feel}.\n` +
		`Must-haves still needed this chapter: ${musts || '(none, you can move on)'}.\n` +
		(nearCap ? `You're near the end of this chapter, so make sure any missing must-have gets asked directly this turn.\n` : '') +
		(phase?.seeds.length ? `Questions you can draw on or reshape (don't read them verbatim if a bridge fits better): ${phase.seeds.join(' / ')}\n` : '') +
		hyp +
		`\n\n${CONTROLLER_RULES}\n\n` +
		`Return ONLY valid JSON, no fences:\n` +
		`{"message": "<what you say next>", "fieldUpdates": [{"id": "<field id from STATE>", "value": "<short>", "evidence": "<their words>", "confidence": "partial|high"}], "tentativeRead": "<optional>", "phaseComplete": true|false}`
	);
}

// tolerant parse of the controller's JSON reply → a ControllerTurn, or null if
// unusable (caller falls back to a scripted nudge). Pure.
export function parseControllerTurn(raw: string): ControllerTurn | null {
	try {
		const cleaned = raw.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
		const o = JSON.parse(cleaned) as Record<string, unknown>;
		const message = typeof o.message === 'string' ? o.message.trim() : '';
		if (!message) return null;
		const fieldUpdates = Array.isArray(o.fieldUpdates)
			? o.fieldUpdates
					.filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
					.map((u) => ({
						id: String(u.id ?? ''),
						value: String(u.value ?? ''),
						evidence: typeof u.evidence === 'string' ? u.evidence : undefined,
						confidence: u.confidence === 'high' ? ('high' as const) : ('partial' as const),
					}))
					.filter((u) => u.id && u.value)
			: [];
		return {
			message,
			fieldUpdates,
			tentativeRead: typeof o.tentativeRead === 'string' && o.tentativeRead.trim() ? o.tentativeRead.trim() : undefined,
			phaseComplete: o.phaseComplete === true,
		};
	} catch {
		return null;
	}
}

// ---- final artifact --------------------------------------------------------

export type PersonalityArtifact = {
	archetype: string; // poetic 2-4 word title
	reading: string; // warm 2-3 sentence read
	traits: string[]; // 3-5 descriptors
	// evidence-backed conclusions: each cites what they said
	insights: { claim: string; because: string }[];
};

// render the full profile as evidence-carrying lines, for the artifact pass
export function profileDigest(state: ConvoState): string {
	return FIELDS.map((f) => {
		const fs = state.fields[f.id];
		if (!isFilled(fs) || fs?.value === 'declined') return null;
		const ev = fs?.evidence?.length ? `, said: "${fs.evidence.join('"; "')}"` : '';
		return `${f.label}: ${fs?.value}${ev}`;
	})
		.filter(Boolean)
		.join('\n');
}

// the learned fields as a flat id→value map, for merging into the app's context
// store (the memory file). Only confidently-known, non-declined fields.
export function flattenFields(state: ConvoState): Record<string, string> {
	const out: Record<string, string> = {};
	for (const f of FIELDS) {
		const fs = state.fields[f.id];
		if (fs && (fs.status === 'partial' || fs.status === 'high') && fs.value && fs.value !== 'declined') {
			out[f.id] = fs.value;
		}
	}
	return out;
}

// The astral card is the running reading, deepened at each chapter boundary from
// everything learned so far plus the card they already have (continuity, so it
// reads as one person growing clearer). Parse the reply with `parseArtifact` and
// take archetype/reading/traits.
export function buildCardPrompt(state: ConvoState, prior: { archetype: string; reading: string; traits: string[] } | null): string {
	return (
		`You are writing the user's "astral card", a warm, almost-astrology personality reading, from an ongoing get-to-know-you conversation. ` +
		(prior ? `This is an UPDATE: keep what still rings true and deepen it with what's new.\n` : `Build it from what they've shared so far.\n`) +
		(prior ? `Their card now:\narchetype: ${prior.archetype}\nreading: ${prior.reading}\ntraits: ${prior.traits.join(', ')}\n\n` : '') +
		`Everything learned so far:\n${profileDigest(state)}\n\n` +
		`Return ONLY valid JSON, no fences:\n` +
		`{"archetype": "<poetic 2-4 word lowercase title>", "reading": "<warm, slightly mystical 2-3 sentence read grounded in what they said, lowercase, no em-dash>", "traits": ["<3-4 short lowercase trait words>"]}`
	);
}

export function buildArtifactPrompt(state: ConvoState): string {
	return (
		`You are writing the user's personality artifact from a get-to-know-you conversation. It must feel EARNED from what they shared, never generic. ` +
		`Every important conclusion cites evidence from their own words.\n\n` +
		`Everything learned about them:\n${profileDigest(state)}\n\n` +
		`Return ONLY valid JSON, no fences:\n` +
		`{"archetype": "<poetic 2-4 word lowercase title>", "reading": "<warm, slightly mystical 2-3 sentence read of who they are, grounded in what they said, lowercase, no em-dash>", ` +
		`"traits": ["<3-5 short lowercase trait words>"], "insights": [{"claim": "<a defining trait>", "because": "<the evidence from what they shared>"}]}`
	);
}

export function parseArtifact(raw: string): PersonalityArtifact | null {
	try {
		const cleaned = raw.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
		const o = JSON.parse(cleaned) as Record<string, unknown>;
		const archetype = typeof o.archetype === 'string' ? o.archetype.trim() : '';
		if (!archetype) return null;
		const traits = Array.isArray(o.traits)
			? o.traits.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim()).slice(0, 5)
			: [];
		const insights = Array.isArray(o.insights)
			? o.insights
					.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
					.map((i) => ({ claim: String(i.claim ?? ''), because: String(i.because ?? '') }))
					.filter((i) => i.claim && i.because)
					.slice(0, 6)
			: [];
		return {
			archetype,
			reading: typeof o.reading === 'string' ? o.reading.trim() : '',
			traits,
			insights,
		};
	} catch {
		return null;
	}
}
