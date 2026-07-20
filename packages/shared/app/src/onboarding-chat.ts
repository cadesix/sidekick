import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Database, actionItems, goals, users } from "@sidekick/db";
import { type Cadence, cadenceSchema, getGoalDefinition } from "./goals/catalog";

/**
 * The LLM-driven onboarding chat (02 §onboarding chat): a scripted-with-LLM-color
 * conversation on `conversations.kind = 'onboarding'`. A server-side state machine
 * walks the required beats; the model renders each beat in the sidekick voice and
 * must call `commit_onboarding_choice` / `set_reminder_time` before the machine
 * advances. The beat pointer is DERIVED from durable state (which goals have an
 * active action item; whether `users.reminder_time` is set) rather than stored,
 * so a mid-chat crash or resend can never desync it.
 */

export const ONBOARDING_CHAT_PROMPT = { version: "onboarding-chat-v1" } as const;

/** The instruction `startOnboardingChat` renders the intro message from. */
export const ONBOARDING_INTRO_INSTRUCTION =
  "this is your very first message to the user ever — they just met you and named you. greet them warmly. if you have their personality result, react to it once (warmly, like it delights you). then get started on your current step (see the setup chat context) — keep it to 1-2 short lowercase sentences.";

export type OnboardingBeat =
  // Freeform first-habit discovery: no goal chosen yet, so the chat uncovers a
  // pain point, lands one habit, shapes a cadence, and commits it.
  | { type: "discover_habit" }
  | { type: "plan_goal"; slug: string }
  | { type: "reminder" }
  | { type: "wrap_up" };

export type OnboardingGoalState = {
  slug: string;
  label: string;
  planned: boolean;
  actionLabel: string | null;
  cadence: Cadence | null;
};

export type OnboardingChatState = {
  userName: string | null;
  sidekickName: string | null;
  archetype: string | null;
  tagline: string | null;
  reminderTime: string | null;
  goals: OnboardingGoalState[];
  beat: OnboardingBeat;
};

const personalityShape = z.object({ archetype: z.string(), tagline: z.string() });

/** e.g. "3× a week" / "every day" / "asleep by 23:30". */
export function cadencePhrase(cadence: Cadence | undefined): string | null {
  if (!cadence) {
    return null;
  }
  if (cadence.type === "weekly") {
    return `${cadence.target}× a week`;
  }
  if (cadence.type === "daily") {
    return "every day";
  }
  return `${cadence.criteria.replace(/-/g, " ")} ${cadence.value}`;
}

function deriveBeat(goalStates: OnboardingGoalState[], reminderTime: string | null): OnboardingBeat {
  // No goal at all → freeform discovery (they didn't pick from a catalog). The
  // commit_freeform_goal tool creates the first goal, which advances the beat.
  if (goalStates.length === 0) {
    return { type: "discover_habit" };
  }
  const unplanned = goalStates.find((g) => !g.planned);
  if (unplanned) {
    return { type: "plan_goal", slug: unplanned.slug };
  }
  if (reminderTime === null) {
    return { type: "reminder" };
  }
  return { type: "wrap_up" };
}

/** Read the beat machine's state from durable rows — nothing chat-specific is stored. */
export async function onboardingChatState(
  db: Database,
  userId: string,
): Promise<OnboardingChatState> {
  const userRows = await db
    .select({
      name: users.name,
      sidekickName: users.sidekickName,
      personality: users.personality,
      reminderTime: users.reminderTime,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];

  const goalRows = await db
    .select({ id: goals.id, slug: goals.slug, label: goals.label })
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
    .orderBy(asc(goals.createdAt));

  const goalIds = goalRows.map((g) => g.id);
  const itemRows =
    goalIds.length > 0
      ? await db
          .select({ goalId: actionItems.goalId, label: actionItems.label, cadence: actionItems.cadence })
          .from(actionItems)
          .where(and(inArray(actionItems.goalId, goalIds), eq(actionItems.status, "active")))
          .orderBy(desc(actionItems.createdAt))
      : [];
  const itemByGoal = new Map<string, (typeof itemRows)[number]>();
  for (const item of itemRows) {
    if (!itemByGoal.has(item.goalId)) {
      itemByGoal.set(item.goalId, item);
    }
  }

  const goalStates: OnboardingGoalState[] = goalRows.map((goal) => {
    const item = itemByGoal.get(goal.id);
    const parsed = item ? cadenceSchema.safeParse(item.cadence) : null;
    return {
      slug: goal.slug,
      label: goal.label ?? getGoalDefinition(goal.slug)?.label ?? goal.slug,
      planned: item !== undefined,
      actionLabel: item?.label ?? null,
      cadence: parsed?.success ? parsed.data : null,
    };
  });

  const personality = personalityShape.safeParse(user?.personality);
  const reminderTime = user?.reminderTime ?? null;

  return {
    userName: user?.name ?? null,
    sidekickName: user?.sidekickName ?? null,
    archetype: personality.success ? personality.data.archetype : null,
    tagline: personality.success ? personality.data.tagline : null,
    reminderTime,
    goals: goalStates,
    beat: deriveBeat(goalStates, reminderTime),
  };
}

function goalLine(goal: OnboardingGoalState): string {
  if (goal.planned) {
    const phrase = cadencePhrase(goal.cadence ?? undefined);
    const plan = [goal.actionLabel, phrase].filter((p): p is string => p !== null).join(", ");
    return `- ${goal.label.toLowerCase()} — planned: ${plan.toLowerCase()}`;
  }
  return `- ${goal.label.toLowerCase()} — not planned yet`;
}

function planGoalInstruction(slug: string): string {
  const definition = getGoalDefinition(slug);
  const label = definition?.label.toLowerCase() ?? slug;
  const options = (definition?.actionItems ?? [])
    .map((item) => {
      const cadences = item.cadenceOptions
        .map((c) => cadencePhrase(c))
        .filter((p): p is string => p !== null)
        .join(" / ");
      return `  - action_slug "${item.slug}": ${item.label.toLowerCase()} (cadence options: ${cadences})`;
    })
    .join("\n");
  return `you're planning "${label}" right now. ask how they want to do it (offer the options below as choices), then how often feels realistic. free text is always fine — map whatever they say onto the closest option. once BOTH the action and the cadence are clear, call commit_onboarding_choice with goal_slug "${slug}", the action_slug, and the cadence — silently, never announcing the tool — then move straight on to the next step.
options for "${label}":
${options}`;
}

const DISCOVER_HABIT_INSTRUCTION =
  'they haven\'t picked a goal yet — you\'re finding their first habit together, ONE thing at a time. first, warmly uncover what\'s going on for them and what they\'d want to change (a life transition, loneliness, getting fit, stress, focus, whatever it is) — ask, listen, react. then land on ONE concrete habit they\'d actually do. then shape it into a realistic rhythm: offer a specific version and a cadence (e.g. "a 20 minute walk" "3× a week", or "read before bed" "every night"). keep it doable, never ridiculous like "run 50 miles a day". once you BOTH have a clear habit AND a cadence, call commit_freeform_goal with a short label and the cadence — silently, never announce it — then move straight on to setting a daily check-in time.';

const REMINDER_INSTRUCTION =
  'every goal has a plan now — hype that up in one line, then ask when they want their daily check-in text (a time of day). when they pick one, call set_reminder_time with the 24-hour "HH:MM" — silently — then move on.';

const WRAP_UP_INSTRUCTION =
  "everything's set. ask if you can send them notifications so your check-ins actually reach them — soft and friendly, one line (the app shows the real permission dialog; you never need a tool for this). once they've answered, wrap up warmly in one or two lines and tell them you're ready when they are.";

function beatInstruction(beat: OnboardingBeat): string {
  if (beat.type === "discover_habit") {
    return DISCOVER_HABIT_INSTRUCTION;
  }
  if (beat.type === "plan_goal") {
    return planGoalInstruction(beat.slug);
  }
  if (beat.type === "reminder") {
    return REMINDER_INSTRUCTION;
  }
  return WRAP_UP_INSTRUCTION;
}

/**
 * The remaining steps after the current beat, so the model can flow from a
 * committed step straight into the next question within the same turn (the
 * system block is only rebuilt between turns).
 */
function remainingSteps(state: OnboardingChatState): string[] {
  const steps: string[] = [];
  if (state.beat.type === "discover_habit") {
    steps.push("pick a daily check-in time");
  }
  if (state.beat.type === "plan_goal") {
    const currentSlug = state.beat.slug;
    let past = false;
    for (const goal of state.goals) {
      if (goal.slug === currentSlug) {
        past = true;
        continue;
      }
      if (past && !goal.planned) {
        steps.push(`plan "${goal.label.toLowerCase()}"`);
      }
    }
    steps.push("pick a daily check-in time");
  }
  if (state.beat.type !== "wrap_up") {
    steps.push("ask about notifications, then wrap up");
  }
  return steps;
}

/**
 * The ONBOARDING SETUP CHAT system block. Rebuilt every turn from the derived
 * state, so a committed choice moves the "current step" automatically. Sits after
 * the persona block; onboarding conversations are short-lived, so it takes no
 * cache breakpoint of its own (the persona block keeps breakpoint A).
 */
export function renderOnboardingBlock(state: OnboardingChatState): string {
  const name = state.userName ?? "the user";
  const personality =
    state.archetype !== null
      ? `their personality result: ${state.archetype}${state.tagline ? ` — ${state.tagline.toLowerCase()}` : ""}`
      : "their personality result isn't available — skip referencing it";
  const goalLines = state.goals.map(goalLine).join("\n");
  const remaining = remainingSteps(state);
  const remainingLine =
    remaining.length > 0
      ? `\nafter the current step is committed, flow straight into the next one in the same message. steps still ahead: ${remaining.join(" → ")}.`
      : "";
  const goalsSection =
    state.goals.length > 0
      ? `their chosen goals:\n${goalLines}`
      : "they haven't chosen a goal yet — you'll find their first habit together.";
  return `=== ONBOARDING SETUP CHAT ===
this is ${name}'s very first conversation with you. your job: help them land their first habit and turn it into a concrete plan, set a daily check-in time, and get them to allow notifications. keep every message to 1–2 short lowercase sentences and ask about ONE thing at a time.
${personality}.
${goalsSection}
current step: ${beatInstruction(state.beat)}${remainingLine}
=== END ===`;
}

/**
 * Deterministic chip hints for the current beat — fed to the suggested-replies
 * generator so the tappable options match the catalog (plan 02: action items
 * rendered as reply chips), and used as-is by clients that want static chips.
 */
export function beatChipHints(state: OnboardingChatState): string[] {
  if (state.beat.type === "discover_habit") {
    return []; // freeform — let the suggested-replies generator produce contextual chips
  }
  if (state.beat.type === "plan_goal") {
    const definition = getGoalDefinition(state.beat.slug);
    return (definition?.actionItems ?? []).map((item) => item.label.toLowerCase());
  }
  if (state.beat.type === "reminder") {
    return ["9:00 am", "12:00 pm", "8:00 pm"];
  }
  return ["turn on notifications", "maybe later"];
}
