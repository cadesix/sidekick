import { INTEREST_OPTIONS } from "./interests";
import type { StepConfig } from "./types";

/**
 * The funnel manifest, ported from `web/src/components/funnel/manifest.ts`. Same
 * order, copy, and branching; adds the `interests` step before RESULT (02 §4).
 * Asset-free (images referenced by key) so it and `navigation.ts` are unit-tested
 * from the root suite. Personality scenes resolve by item id (`q1`..`q20`).
 */

const WELCOME: StepConfig = { id: "welcome", type: "welcome", role: "landing", title: "Ready to meet your Sidekick?", cta: "Yes!" };

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
      "get-fit",
      "sleep-better",
      "stop-procrastinating",
      "stop-doomscrolling",
      "social-skills",
      "manage-stress",
      "read-more",
      "be-productive",
    ],
  },
};

const TRANSITION: StepConfig = { id: "transition", type: "transition", role: "interstitial", title: "With a sidekick, you're 87% more likely to reach your goals." };
const QUIZ_INTRO: StepConfig = { id: "quiz-intro", type: "quiz-intro", role: "interstitial", title: "Let's train your sidekick to get to know you.", imageKey: "quiz-intro" };
const QUIZ_PROMPT: StepConfig = { id: "quiz-prompt", type: "statement", role: "interstitial", imageKey: "quiz-prompt", title: "We're going to ask you a few questions\n\nso we can match you to the best Sidekick for YOU." };

const personality = (id: string, trait: "O" | "C" | "E" | "A" | "N", text: string, reverse?: boolean): StepConfig => ({
  id,
  type: "personality",
  role: "question",
  question: { id, trait, text, reverse },
});

const Q1 = personality("q1", "O", "I love trying things I've never done before.");
const Q2 = personality("q2", "O", "I often get lost in my imagination or daydreams.");
const Q3 = personality("q3", "O", "Abstract or philosophical ideas excite me.");
const Q4 = personality("q4", "O", "I'd rather stick to routine than shake things up.", true);
const Q5 = personality("q5", "C", "I finish what I start, even when it gets boring.");
const Q6 = personality("q6", "C", "I like to keep my space organized and tidy.");
const Q7 = personality("q7", "C", "I often leave things until the last minute.", true);
const Q8 = personality("q8", "C", "I think carefully before I make a decision.");
const Q9 = personality("q9", "E", "Meeting new people energizes me.");
const Q10 = personality("q10", "E", "I'm usually the one who starts conversations.");
const Q11 = personality("q11", "E", "I need a lot of quiet time alone to recharge.", true);
const Q12 = personality("q12", "E", "I feel comfortable being the center of attention.");
const Q13 = personality("q13", "A", "I genuinely enjoy helping others succeed.");
const Q14 = personality("q14", "A", "I find it easy to trust people.");
const Q15 = personality("q15", "A", "I can be blunt, even if it stings a little.", true);
const Q16 = personality("q16", "A", "I try hard to see things from other people's point of view.");
const Q17 = personality("q17", "N", "I worry about things more than most people do.");
const Q18 = personality("q18", "N", "My mood can shift quickly.");
const Q19 = personality("q19", "N", "I stay calm under pressure.", true);
const Q20 = personality("q20", "N", "I bounce back quickly after a setback.", true);

const FACT: StepConfig = { id: "fact", type: "fact", role: "interstitial", title: "Sidekicks are 8× more effective at helping because they're trained for your exact personality type." };

const NAME: StepConfig = { id: "name", type: "name", role: "question", title: "What should we call you?", placeholder: "Your name" };

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

const INTERESTS: StepConfig = {
  id: "interests",
  type: "interests",
  role: "question",
  question: {
    id: "interests",
    title: "What are you into?",
    subtitle: "Pick a few — it helps me get you.",
    minSelections: 1,
    options: INTEREST_OPTIONS,
  },
};

const RESULT: StepConfig = { id: "result", type: "result", role: "success", title: "Your personality type" };
const REVEAL: StepConfig = { id: "reveal", type: "reveal", role: "success", title: "Look!", subtitle: "Your Sidekick is Ready to Meet you!", cta: "Meet My Sidekick!" };
const MEET: StepConfig = { id: "meet", type: "meet", role: "success", title: "Meet your sidekick", cta: "Let's go!" };
const CHOOSE_COLOR: StepConfig = { id: "choose-color", type: "choose-color", role: "success", title: "Choose your Sidekick's color" };
const NAME_SIDEKICK: StepConfig = { id: "name-sidekick", type: "name-sidekick", role: "success", title: "Name your Sidekick" };
const ONBOARDING_CHAT: StepConfig = { id: "onboarding-chat", type: "onboarding-chat", role: "success", title: "Let's set up your plan" };

export const STEPS: StepConfig[] = [
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
  INTERESTS,
  RESULT,
  REVEAL,
  MEET,
  CHOOSE_COLOR,
  NAME_SIDEKICK,
  ONBOARDING_CHAT,
];
