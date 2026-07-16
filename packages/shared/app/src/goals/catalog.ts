import { z } from "zod";

/**
 * How often an action item is expected. `weekly` is a count target ("run 3x");
 * `daily` is every-day binary; `daily-criteria` is a tier-2 time/threshold item
 * verified through conversation ("asleep by 23:30", "under 30m on socials").
 */
export const cadenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("weekly"), target: z.number().int().min(1).max(7) }),
  z.object({
    type: z.literal("daily-criteria"),
    criteria: z.string().min(1),
    value: z.string().min(1),
  }),
]);
export type Cadence = z.infer<typeof cadenceSchema>;

/**
 * Trackability tiers (03-goals-and-checkins.md):
 * 1 = binary/count items (gym, run, pages) — hard-tracked.
 * 2 = time-criteria items (sleep by X, under X minutes) — tracked via conversation.
 * 3 = fuzzy goals (social skills, productivity) — no hard metric; the sidekick
 *     sets a weekly micro-challenge that becomes a tier-1 item.
 * (Tier 4, screen-time-backed items, is native and deferred to plan 13.)
 */
export type Tier = 1 | 2 | 3;

export type ActionItemTemplate = {
  slug: string;
  label: string;
  defaultCadence: Cadence;
  /** The renegotiation choices `adjust_action_item` offers for this item. */
  cadenceOptions: Cadence[];
};

export type GoalDefinition = {
  slug: string;
  label: string;
  tier: Tier;
  /** 3–6 suggested action items; the first is the default on adoption. */
  actionItems: ActionItemTemplate[];
  /** Per-goal steer for the check-in prompt ("for sleep, ask about last night"). */
  promptGuidance: string;
  /**
   * Tier-3 goals support a weekly micro-challenge: a `custom`-slug action item
   * the sidekick proposes ("talk to one stranger this week"), tracked tier-1.
   */
  weeklyChallenge: boolean;
};

/** Custom / user-defined action items (including tier-3 micro-challenges). */
export const CUSTOM_ACTION_SLUG = "custom";

/** Reminder time used when a user hasn't picked one (24h "HH:MM", local). */
export const DEFAULT_REMINDER_TIME = "09:00";

const weekly = (target: number): Cadence => ({ type: "weekly", target });
const daily: Cadence = { type: "daily" };
const criteria = (name: string, value: string): Cadence => ({
  type: "daily-criteria",
  criteria: name,
  value,
});

const WEEKLY_OPTIONS: Cadence[] = [weekly(2), weekly(3), weekly(4), weekly(5)];

export const GOAL_CATALOG: GoalDefinition[] = [
  {
    slug: "get-fit",
    label: "Get Fit",
    tier: 1,
    weeklyChallenge: false,
    promptGuidance:
      "Ask how movement went, not whether they 'completed a workout'. Celebrate any effort; a walk still counts.",
    actionItems: [
      { slug: "gym", label: "Hit the gym", defaultCadence: weekly(3), cadenceOptions: WEEKLY_OPTIONS },
      { slug: "run", label: "Go for a run", defaultCadence: weekly(3), cadenceOptions: WEEKLY_OPTIONS },
      { slug: "walk", label: "Take a walk", defaultCadence: daily, cadenceOptions: [daily, weekly(5), weekly(4)] },
      { slug: "strength", label: "Strength training", defaultCadence: weekly(3), cadenceOptions: WEEKLY_OPTIONS },
      { slug: "yoga", label: "Do yoga", defaultCadence: weekly(2), cadenceOptions: WEEKLY_OPTIONS },
    ],
  },
  {
    slug: "sleep-better",
    label: "Sleep Better",
    tier: 2,
    weeklyChallenge: false,
    promptGuidance:
      "Ask about LAST night, never tonight. Be gentle about slip-ups; sleep is sensitive and guilt makes it worse.",
    actionItems: [
      { slug: "sleep-by", label: "Asleep by a set time", defaultCadence: criteria("asleep-by", "23:30"), cadenceOptions: [criteria("asleep-by", "22:30"), criteria("asleep-by", "23:00"), criteria("asleep-by", "23:30"), criteria("asleep-by", "00:00")] },
      { slug: "wake-by", label: "Wake up by a set time", defaultCadence: criteria("awake-by", "07:00"), cadenceOptions: [criteria("awake-by", "06:30"), criteria("awake-by", "07:00"), criteria("awake-by", "07:30")] },
      { slug: "no-screens", label: "No screens before bed", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
      { slug: "wind-down", label: "Wind-down routine", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
    ],
  },
  {
    slug: "stop-procrastinating",
    label: "Stop Procrastinating",
    tier: 2,
    weeklyChallenge: false,
    promptGuidance:
      "Ask what they got moving on today, not what they avoided. Frame the next step as small and doable.",
    actionItems: [
      { slug: "top-task", label: "Do the hardest task first", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
      { slug: "deep-work", label: "One deep-work block", defaultCadence: daily, cadenceOptions: [daily, weekly(5), weekly(3)] },
      { slug: "pomodoro", label: "Focus sprints", defaultCadence: weekly(5), cadenceOptions: WEEKLY_OPTIONS },
      { slug: "plan-day", label: "Plan the day", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
    ],
  },
  {
    slug: "stop-doomscrolling",
    label: "Stop Doomscrolling",
    tier: 2,
    weeklyChallenge: false,
    promptGuidance:
      "Ask how the phone-scroll balance felt today. No shame if the scroll won — reset framing, not a lecture. (Self-report until native Screen Time lands.)",
    actionItems: [
      { slug: "screen-limit", label: "Stay under a daily limit", defaultCadence: criteria("under", "30m"), cadenceOptions: [criteria("under", "15m"), criteria("under", "30m"), criteria("under", "60m")] },
      { slug: "no-morning-scroll", label: "No scrolling first thing", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
      { slug: "phone-free-meals", label: "Phone-free meals", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
      { slug: "app-limit", label: "Set an app limit", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
    ],
  },
  {
    slug: "social-skills",
    label: "Improve Social Skills",
    tier: 3,
    weeklyChallenge: true,
    promptGuidance:
      "This is fuzzy — anchor on a concrete micro-challenge (message a friend, start one conversation). Ask how it felt, celebrate the attempt regardless of outcome.",
    actionItems: [
      { slug: "reach-out", label: "Reach out to someone", defaultCadence: weekly(3), cadenceOptions: WEEKLY_OPTIONS },
      { slug: "new-conversation", label: "Start a new conversation", defaultCadence: weekly(1), cadenceOptions: [weekly(1), weekly(2), weekly(3)] },
      { slug: "plan-hangout", label: "Plan a hangout", defaultCadence: weekly(1), cadenceOptions: [weekly(1), weekly(2)] },
    ],
  },
  {
    slug: "manage-stress",
    label: "Manage Stress",
    tier: 3,
    weeklyChallenge: true,
    promptGuidance:
      "Lead with how they're feeling, not a checkbox. If they're low, comfort first; the action item comes second.",
    actionItems: [
      { slug: "meditate", label: "Meditate", defaultCadence: daily, cadenceOptions: [daily, weekly(5), weekly(3)] },
      { slug: "journal", label: "Journal", defaultCadence: daily, cadenceOptions: [daily, weekly(5), weekly(3)] },
      { slug: "breathe", label: "Breathing exercise", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
      { slug: "walk-outside", label: "Get outside", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
    ],
  },
  {
    slug: "read-more",
    label: "Read More",
    tier: 1,
    weeklyChallenge: false,
    promptGuidance:
      "Ask what they're reading and whether they got a few pages in. Curiosity about the book beats interrogating the streak.",
    actionItems: [
      { slug: "read-pages", label: "Read a few pages", defaultCadence: daily, cadenceOptions: [daily, weekly(5), weekly(4)] },
      { slug: "read-minutes", label: "Read for a set time", defaultCadence: criteria("minutes", "20"), cadenceOptions: [criteria("minutes", "10"), criteria("minutes", "20"), criteria("minutes", "30")] },
      { slug: "read-nightly", label: "Read before bed", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
    ],
  },
  {
    slug: "be-productive",
    label: "Be More Productive",
    tier: 3,
    weeklyChallenge: true,
    promptGuidance:
      "Fuzzy goal — pin it to a concrete daily anchor (top 3 tasks, one time-block). Ask what they moved forward, not whether they were 'productive'.",
    actionItems: [
      { slug: "top-3", label: "Pick top 3 tasks", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
      { slug: "time-block", label: "Time-block the day", defaultCadence: daily, cadenceOptions: [daily, weekly(5)] },
      { slug: "inbox-zero", label: "Clear the inbox", defaultCadence: weekly(5), cadenceOptions: WEEKLY_OPTIONS },
      { slug: "weekly-review", label: "Weekly review", defaultCadence: weekly(1), cadenceOptions: [weekly(1), weekly(2)] },
    ],
  },
];

const CATALOG_BY_SLUG = new Map(GOAL_CATALOG.map((g) => [g.slug, g]));

export function getGoalDefinition(slug: string): GoalDefinition | undefined {
  return CATALOG_BY_SLUG.get(slug);
}

export function getActionItemTemplate(
  goalSlug: string,
  actionSlug: string,
): ActionItemTemplate | undefined {
  return getGoalDefinition(goalSlug)?.actionItems.find((a) => a.slug === actionSlug);
}

/** The default action item a goal adopts when the user doesn't pick one. */
export function defaultActionItem(goalSlug: string): ActionItemTemplate | undefined {
  return getGoalDefinition(goalSlug)?.actionItems[0];
}
