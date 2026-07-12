import type { StepConfig } from "./types";

// The Northstar funnel — stripped to basics. Each step is a named `StepConfig`
// const composed into VARIANT_STEPS.default. FunnelHog reads both, so keep the
// `const NAME: StepConfig = {...}` shape and the `default: [...]` array intact.

const WELCOME: StepConfig = {
	id: "welcome",
	type: "welcome",
	role: "landing",
	title: "Ready to meet your Sidekick?",
	cta: "Yes!",
};

// Demographics — quick onboarding questions before goals.
const NAME: StepConfig = {
	id: "name",
	type: "name",
	role: "question",
	title: "What should we call you?",
	placeholder: "Your name",
};

const AGE: StepConfig = {
	id: "age",
	type: "choice",
	role: "question",
	key: "age",
	title: "How old are you?",
	options: [
		{ value: "under-18", label: "Under 18" },
		{ value: "18-24", label: "18–24" },
		{ value: "25-34", label: "25–34" },
		{ value: "35-44", label: "35–44" },
		{ value: "45-54", label: "45–54" },
		{ value: "55-plus", label: "55+" },
	],
};

const GENDER: StepConfig = {
	id: "gender",
	type: "choice",
	role: "question",
	key: "gender",
	title: "Which best describes you?",
	options: [
		{ value: "female", label: "Female" },
		{ value: "male", label: "Male" },
		{ value: "non-binary", label: "Non-binary" },
		{ value: "prefer-not", label: "Prefer not to say" },
	],
};

const GOALS: StepConfig = {
	id: "goals",
	type: "goals",
	role: "question",
	question: {
		id: "goals",
		title: "What are your goals?",
		subtitle: "Pick all that apply.",
		minSelections: 1,
		options: [
			{ value: "get-fit", label: "Get Fit", icon: "/icons-macos9/get-fit.webp" },
			{ value: "sleep-better", label: "Sleep Better", icon: "/icons-macos9/sleep-better.webp" },
			{ value: "stop-procrastinating", label: "Stop Procrastinating", icon: "/icons-macos9/stop-procrastinating.webp" },
			{ value: "stop-doomscrolling", label: "Stop Doomscrolling", icon: "/icons-macos9/stop-doomscrolling.webp" },
			{ value: "social-skills", label: "Improve Social Skills", icon: "/icons-macos9/social-skills.webp" },
			{ value: "manage-stress", label: "Manage Stress", icon: "/icons-macos9/manage-stress.webp" },
			{ value: "read-more", label: "Read More", icon: "/icons-macos9/read-more.webp" },
			{ value: "be-productive", label: "Be More Productive", icon: "/icons-macos9/be-productive.webp" },
		],
	},
};

const TRANSITION: StepConfig = {
	id: "transition",
	type: "transition",
	role: "interstitial",
	title: "With a sidekick, you're 87% more likely to reach your goals.",
};

const QUIZ_INTRO: StepConfig = {
	id: "quiz-intro",
	type: "quiz-intro",
	role: "interstitial",
	title: "Let's train your sidekick to get to know you.",
};

const QUIZ_PROMPT: StepConfig = {
	id: "quiz-prompt",
	type: "statement",
	role: "interstitial",
	image: "/quiz-prompt.webp",
	title: "We're going to ask you a few questions\n\nso we can match you to the best Sidekick for YOU.",
};

// Personality test — each Big Five (OCEAN) item is its own funnel step so it shows
// as an individually-editable frame in FunnelHog. 4 items per trait, balanced with
// reverse-keyed items; `trait`/`reverse` drive scoring later. The shared Likert
// scale + "How much do you agree?" prompt live in personality-step.tsx.
// Openness
const Q1: StepConfig = { id: "q1", type: "personality", role: "question", question: { id: "q1", trait: "O", text: "I love trying things I've never done before.", image: "/scenes/q1.webp" } };
const Q2: StepConfig = { id: "q2", type: "personality", role: "question", question: { id: "q2", trait: "O", text: "I often get lost in my imagination or daydreams.", image: "/scenes/q2.webp" } };
const Q3: StepConfig = { id: "q3", type: "personality", role: "question", question: { id: "q3", trait: "O", text: "Abstract or philosophical ideas excite me.", image: "/scenes/q3.webp" } };
const Q4: StepConfig = { id: "q4", type: "personality", role: "question", question: { id: "q4", trait: "O", reverse: true, text: "I'd rather stick to routine than shake things up.", image: "/scenes/q4.webp" } };
// Conscientiousness
const Q5: StepConfig = { id: "q5", type: "personality", role: "question", question: { id: "q5", trait: "C", text: "I finish what I start, even when it gets boring.", image: "/scenes/q5.webp" } };
const Q6: StepConfig = { id: "q6", type: "personality", role: "question", question: { id: "q6", trait: "C", text: "I like to keep my space organized and tidy.", image: "/scenes/q6.webp" } };
const Q7: StepConfig = { id: "q7", type: "personality", role: "question", question: { id: "q7", trait: "C", reverse: true, text: "I often leave things until the last minute.", image: "/scenes/q7.webp" } };
const Q8: StepConfig = { id: "q8", type: "personality", role: "question", question: { id: "q8", trait: "C", text: "I think carefully before I make a decision.", image: "/scenes/q8.webp" } };
// Extraversion
const Q9: StepConfig = { id: "q9", type: "personality", role: "question", question: { id: "q9", trait: "E", text: "Meeting new people energizes me.", image: "/scenes/q9.webp" } };
const Q10: StepConfig = { id: "q10", type: "personality", role: "question", question: { id: "q10", trait: "E", text: "I'm usually the one who starts conversations.", image: "/scenes/q10.webp" } };
const Q11: StepConfig = { id: "q11", type: "personality", role: "question", question: { id: "q11", trait: "E", reverse: true, text: "I need a lot of quiet time alone to recharge.", image: "/scenes/q11.webp" } };
const Q12: StepConfig = { id: "q12", type: "personality", role: "question", question: { id: "q12", trait: "E", text: "I feel comfortable being the center of attention.", image: "/scenes/q12.webp" } };
// Agreeableness
const Q13: StepConfig = { id: "q13", type: "personality", role: "question", question: { id: "q13", trait: "A", text: "I genuinely enjoy helping others succeed.", image: "/scenes/q13.webp" } };
const Q14: StepConfig = { id: "q14", type: "personality", role: "question", question: { id: "q14", trait: "A", text: "I find it easy to trust people.", image: "/scenes/q14.webp" } };
const Q15: StepConfig = { id: "q15", type: "personality", role: "question", question: { id: "q15", trait: "A", reverse: true, text: "I can be blunt, even if it stings a little.", image: "/scenes/q15.webp" } };
const Q16: StepConfig = { id: "q16", type: "personality", role: "question", question: { id: "q16", trait: "A", text: "I try hard to see things from other people's point of view.", image: "/scenes/q16.webp" } };
// Neuroticism / Emotional stability
const Q17: StepConfig = { id: "q17", type: "personality", role: "question", question: { id: "q17", trait: "N", text: "I worry about things more than most people do.", image: "/scenes/q17.webp" } };
const Q18: StepConfig = { id: "q18", type: "personality", role: "question", question: { id: "q18", trait: "N", text: "My mood can shift quickly.", image: "/scenes/q18.webp" } };
const Q19: StepConfig = { id: "q19", type: "personality", role: "question", question: { id: "q19", trait: "N", reverse: true, text: "I stay calm under pressure.", image: "/scenes/q19.webp" } };
const Q20: StepConfig = { id: "q20", type: "personality", role: "question", question: { id: "q20", trait: "N", reverse: true, text: "I bounce back quickly after a setback.", image: "/scenes/q20.webp" } };

// Mid-quiz insight shown after the first 5 questions. NOTE: the "8×" is an
// illustrative figure — replace with a sourced stat before shipping.
const FACT: StepConfig = {
	id: "fact",
	type: "fact",
	role: "interstitial",
	title: "Sidekicks are 8× more effective at helping because they're trained for your exact personality type.",
};

// Final step — computes and reveals the user's personality type from their answers.
const RESULT: StepConfig = {
	id: "result",
	type: "result",
	role: "success",
	title: "Your personality type",
};

// Reveal — builds anticipation with the sidekick still in silhouette.
const REVEAL: StepConfig = {
	id: "reveal",
	type: "reveal",
	role: "success",
	title: "Look!",
	subtitle: "Your Sidekick is Ready to Meet you!",
	cta: "Meet My Sidekick!",
};

// Meet — the celebratory full-screen reveal of the sidekick.
const MEET: StepConfig = {
	id: "meet",
	type: "meet",
	role: "success",
	title: "Meet your sidekick",
	cta: "Let's go!",
};

// Customize the sidekick — color, then name (separate steps; stored as properties).
const CHOOSE_COLOR: StepConfig = {
	id: "choose-color",
	type: "choose-color",
	role: "success",
	title: "Choose your Sidekick's color",
};

const NAME_SIDEKICK: StepConfig = {
	id: "name-sidekick",
	type: "name-sidekick",
	role: "success",
	title: "Name your Sidekick",
};

// Onboarding chat — guided setup: turn each goal into an action item + cadence,
// pick a reminder cadence, and offer push notifications. The last onboarding step.
const ONBOARDING_CHAT: StepConfig = {
	id: "onboarding-chat",
	type: "onboarding-chat",
	role: "success",
	title: "Let's set up your plan",
};

// FunnelHog (relic preset) reads VARIANT_STEPS.default to build the step list.
const VARIANT_STEPS: Record<string, StepConfig[]> = {
	default: [
		WELCOME,
		GOALS,
		TRANSITION,
		QUIZ_INTRO,
		QUIZ_PROMPT,
		Q1, Q2, Q3, Q4, Q5,
		FACT,
		Q6, Q7, Q8, Q9, Q10,
		Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20,
		NAME,
		AGE,
		GENDER,
		RESULT,
		REVEAL,
		MEET,
		CHOOSE_COLOR,
		NAME_SIDEKICK,
		ONBOARDING_CHAT,
	],
};

export const STEPS: StepConfig[] = VARIANT_STEPS.default;
