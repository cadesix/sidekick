import { type Cadence, getGoalDefinition } from "@sidekick/shared";

/**
 * The scripted onboarding-chat plan (02 §onboarding chat). Ported from the web
 * funnel's quick-reply flow: for each chosen goal the sidekick asks a "how" beat
 * (action item) and, for count-based goals, a "how often" beat (cadence). Every
 * option carries a structured patch, so the collected answers assemble directly
 * into `onboarding.complete`'s `{ slug, actionSlug, cadence }` goal inputs — no
 * LLM mapping needed for the scripted path.
 */

const weekly = (target: number): Cadence => ({ type: "weekly", target });
const daily: Cadence = { type: "daily" };
const criteria = (name: string, value: string): Cadence => ({
  type: "daily-criteria",
  criteria: name,
  value,
});

export type GoalChoicePatch = { goalSlug: string; actionSlug?: string; cadence?: Cadence };

export type ChipOption = { label: string; patch: GoalChoicePatch };

export type ChipBeat = { id: string; kind: "chips"; messages: string[]; options: ChipOption[] };

type GoalPlan = {
  how: { q: string; options: { label: string; actionSlug: string; cadence?: Cadence }[] };
  cadence?: { q: string; options: { label: string; cadence: Cadence }[] };
};

const COUNT_CADENCE = {
  q: "how many times a week feels realistic?",
  options: [
    { label: "2× a week", cadence: weekly(2) },
    { label: "3× a week", cadence: weekly(3) },
    { label: "5× a week", cadence: weekly(5) },
    { label: "every day", cadence: daily },
  ],
};

const GOAL_PLANS: Record<string, GoalPlan> = {
  "get-fit": {
    how: {
      q: "how do you want to get fit?",
      options: [
        { label: "hit the gym", actionSlug: "gym" },
        { label: "go for a run", actionSlug: "run" },
        { label: "take a walk", actionSlug: "walk" },
        { label: "strength training", actionSlug: "strength" },
      ],
    },
    cadence: COUNT_CADENCE,
  },
  "sleep-better": {
    how: {
      q: "what time do you want to be asleep by?",
      options: [
        { label: "10:00 pm", actionSlug: "sleep-by", cadence: criteria("asleep-by", "22:00") },
        { label: "11:00 pm", actionSlug: "sleep-by", cadence: criteria("asleep-by", "23:00") },
        { label: "11:30 pm", actionSlug: "sleep-by", cadence: criteria("asleep-by", "23:30") },
        { label: "midnight", actionSlug: "sleep-by", cadence: criteria("asleep-by", "00:00") },
      ],
    },
  },
  "stop-procrastinating": {
    how: {
      q: "how will you beat procrastination?",
      options: [
        { label: "hardest task first", actionSlug: "top-task" },
        { label: "one deep-work block", actionSlug: "deep-work" },
        { label: "focus sprints", actionSlug: "pomodoro" },
        { label: "plan the day", actionSlug: "plan-day" },
      ],
    },
    cadence: {
      q: "how often?",
      options: [
        { label: "every day", cadence: daily },
        { label: "weekdays", cadence: weekly(5) },
        { label: "3× a week", cadence: weekly(3) },
      ],
    },
  },
  "stop-doomscrolling": {
    how: {
      q: "what's your daily screen-time limit?",
      options: [
        { label: "under 15 min", actionSlug: "screen-limit", cadence: criteria("under", "15m") },
        { label: "under 30 min", actionSlug: "screen-limit", cadence: criteria("under", "30m") },
        { label: "under 1 hour", actionSlug: "screen-limit", cadence: criteria("under", "60m") },
        { label: "no morning scroll", actionSlug: "no-morning-scroll", cadence: daily },
      ],
    },
  },
  "social-skills": {
    how: {
      q: "how do you want to build social skills?",
      options: [
        { label: "reach out to someone", actionSlug: "reach-out" },
        { label: "start a conversation", actionSlug: "new-conversation" },
        { label: "plan a hangout", actionSlug: "plan-hangout" },
      ],
    },
    cadence: {
      q: "how many times a week?",
      options: [
        { label: "once a week", cadence: weekly(1) },
        { label: "2× a week", cadence: weekly(2) },
        { label: "3× a week", cadence: weekly(3) },
      ],
    },
  },
  "manage-stress": {
    how: {
      q: "how do you want to manage stress?",
      options: [
        { label: "meditate", actionSlug: "meditate" },
        { label: "journal", actionSlug: "journal" },
        { label: "breathing exercise", actionSlug: "breathe" },
        { label: "get outside", actionSlug: "walk-outside" },
      ],
    },
    cadence: {
      q: "how often?",
      options: [
        { label: "every day", cadence: daily },
        { label: "5× a week", cadence: weekly(5) },
        { label: "3× a week", cadence: weekly(3) },
      ],
    },
  },
  "read-more": {
    how: {
      q: "how do you want to read more?",
      options: [
        { label: "a few pages", actionSlug: "read-pages" },
        { label: "read for 20 min", actionSlug: "read-minutes" },
        { label: "read before bed", actionSlug: "read-nightly" },
      ],
    },
    cadence: {
      q: "how many days a week?",
      options: [
        { label: "every day", cadence: daily },
        { label: "5 days", cadence: weekly(5) },
        { label: "3 days", cadence: weekly(3) },
      ],
    },
  },
  "be-productive": {
    how: {
      q: "how do you want to be more productive?",
      options: [
        { label: "pick top 3 tasks", actionSlug: "top-3" },
        { label: "time-block the day", actionSlug: "time-block" },
        { label: "weekly review", actionSlug: "weekly-review" },
      ],
    },
    cadence: {
      q: "how often?",
      options: [
        { label: "every day", cadence: daily },
        { label: "weekdays", cadence: weekly(5) },
      ],
    },
  },
};

/** The sidekick's opening lines, referencing its name if the user gave it one. */
export function introLines(sidekickName: string): string[] {
  return [
    `i'm ${sidekickName} — and we're officially a team! 🎉`,
    "let's turn your goals into a plan i can actually hold you to.",
  ];
}

/** Build the ordered chip beats for the user's chosen goals. */
export function buildGoalBeats(goalSlugs: string[]): ChipBeat[] {
  const beats: ChipBeat[] = [];
  for (const slug of goalSlugs) {
    const plan = GOAL_PLANS[slug];
    if (!plan) {
      continue;
    }
    const label = getGoalDefinition(slug)?.label.toLowerCase() ?? slug;
    beats.push({
      id: `${slug}-how`,
      kind: "chips",
      messages: [`first up — ${label}.`, plan.how.q],
      options: plan.how.options.map((opt) => ({
        label: opt.label,
        patch: { goalSlug: slug, actionSlug: opt.actionSlug, cadence: opt.cadence },
      })),
    });
    if (plan.cadence) {
      beats.push({
        id: `${slug}-cadence`,
        kind: "chips",
        messages: [plan.cadence.q],
        options: plan.cadence.options.map((opt) => ({
          label: opt.label,
          patch: { goalSlug: slug, cadence: opt.cadence },
        })),
      });
    }
  }
  return beats;
}

/**
 * Fold the beat patches selected during the chat into the goal inputs for
 * `onboarding.complete`. A goal with no explicit cadence falls back to the
 * catalog default server-side (adoptGoal).
 */
export function assembleGoalChoices(
  goalSlugs: string[],
  patches: GoalChoicePatch[],
): { slug: string; actionSlug?: string; cadence?: Cadence }[] {
  return goalSlugs.map((slug) => {
    const forGoal = patches.filter((p) => p.goalSlug === slug);
    const actionSlug = forGoal.find((p) => p.actionSlug)?.actionSlug;
    const cadence = forGoal.reduce<Cadence | undefined>((acc, p) => p.cadence ?? acc, undefined);
    return { slug, actionSlug, cadence };
  });
}
