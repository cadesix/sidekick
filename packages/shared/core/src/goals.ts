// Weekly habit goals. Pure math (ISO week key, Mon-based day index) + the goal
// catalog (from the onboarding funnel). Checks are stored per ISO week as
// { [isoWeek]: { [goalValue]: boolean[7] } } (Mon..Sun) by the app adapter.

export const GOALS_KEY = 'sidekick_goals_v1'; // chosen goal values (string[])
export const CHECKS_KEY = 'sidekick_habit_checks_v1'; // { week: { goal: bool[7] } }

export type GoalOption = { value: string; label: string; icon: string };

// Mirrors the onboarding funnel's "goals" step options (packages/web funnel).
export const GOAL_OPTIONS: GoalOption[] = [
  { value: 'get-fit', label: 'Get Fit', icon: 'get-fit' },
  { value: 'sleep-better', label: 'Sleep Better', icon: 'sleep-better' },
  { value: 'stop-procrastinating', label: 'Stop Procrastinating', icon: 'stop-procrastinating' },
  { value: 'stop-doomscrolling', label: 'Stop Doomscrolling', icon: 'stop-doomscrolling' },
  { value: 'social-skills', label: 'Improve Social Skills', icon: 'social-skills' },
  { value: 'manage-stress', label: 'Manage Stress', icon: 'manage-stress' },
  { value: 'read-more', label: 'Read More', icon: 'read-more' },
  { value: 'be-productive', label: 'Be More Productive', icon: 'be-productive' },
];

// ISO-8601 week key "YYYY-Www" (Thursday decides the year), from a Date.
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Mon-based index (0..6) of a Date into a 7-slot week row.
export const todayIndex = (d: Date): number => (d.getDay() + 6) % 7;

// resolve saved goal values → options, falling back to all when none chosen.
export function resolveGoals(values: string[]): GoalOption[] {
  const chosen = values
    .map((v) => GOAL_OPTIONS.find((o) => o.value === v))
    .filter((o): o is GoalOption => Boolean(o));
  return chosen.length ? chosen : GOAL_OPTIONS;
}
