/**
 * The shield is a sidekick moment (13-focus-mode.md). The shield UI is static
 * between refreshes — it can't call the LLM — so its personality comes from a
 * daily-rotating subtitle line, chosen deterministically from the date (no
 * Math.random, injectable date, so it's testable and stable across a device's day).
 * The mobile seam assembles the native ShieldConfiguration from these strings plus
 * the SF-Symbol/blur/color constants it owns; everything here is plain text.
 */

/** The primary dismiss label — "ok, closing" → close behavior. */
export const SHIELD_PRIMARY_LABEL = "ok, closing";

/** Secondary label opens a negotiation in chat, not a bypass button (13). */
export function shieldSecondaryLabel(sidekickName: string): string {
  return `let me ask ${sidekickName}`;
}

/** Title: "hey. it's {sidekickName}." */
export function shieldTitle(sidekickName: string): string {
  return `hey. it's ${sidekickName}.`;
}

/** The deep-link the secondary button's notification carries into chat (13). */
export const SHIELD_KNOCK_TITLE = "heard you knocking 👀";
export const SHIELD_KNOCK_BODY = "what's up?";

type ShieldSubtitle = { text: string; needsBudget?: boolean; needsStreak?: boolean };

/**
 * ~12 in-voice subtitle lines. Lines tagged `needsBudget` are skipped when the
 * user runs block-on-demand with no daily budget; `needsStreak` lines still render
 * a 0 gracefully. Order is stable — the daily index maps onto it deterministically.
 */
export const SHIELD_SUBTITLES: ShieldSubtitle[] = [
  { text: "you said {budget} minutes. i counted.", needsBudget: true },
  { text: "the scroll can wait. your thing can't." },
  { text: "day {streak} of us. don't make it weird.", needsStreak: true },
  { text: "future you is watching. wave." },
  { text: "not mad. just here." },
  { text: "you'd forgotten you opened this, right?" },
  { text: "{budget} minutes was the deal. deal's a deal.", needsBudget: true },
  { text: "put it down. i'll still like you." },
  { text: "this is the part where you close it and feel great." },
  { text: "we both know what happens if you keep going." },
  { text: "streak's at {streak}. protect it.", needsStreak: true },
  { text: "go be a person. the feed will survive." },
];

/**
 * The local day as an integer (UTC-midnight based on the date's Y/M/D). Two shield
 * refreshes on the same calendar day pick the same line; the next day advances.
 */
export function shieldDayIndex(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
}

/**
 * The subtitle for a given day, with {budget}/{streak}/{sidekickName} filled in.
 * Deterministic: same date + budget → same line. Budget-dependent lines drop out
 * when there's no daily budget so we never render "you said  minutes".
 */
export function pickShieldSubtitle(input: {
  date: Date;
  budgetMinutes: number | null;
  streak: number;
  sidekickName: string;
}): string {
  const eligible = SHIELD_SUBTITLES.filter((line) => {
    if (line.needsBudget && input.budgetMinutes === null) {
      return false;
    }
    return true;
  });
  const index = ((shieldDayIndex(input.date) % eligible.length) + eligible.length) % eligible.length;
  const chosen = eligible[index] ?? eligible[0]!;
  return chosen.text
    .replace("{budget}", String(input.budgetMinutes ?? ""))
    .replace("{streak}", String(input.streak))
    .replace("{sidekickName}", input.sidekickName);
}

/** The shield preview shown on the setup screen (13 §UI) — same copy the OS shows. */
export function shieldPreview(input: {
  date: Date;
  budgetMinutes: number | null;
  streak: number;
  sidekickName: string;
}): { title: string; subtitle: string; primaryLabel: string; secondaryLabel: string } {
  return {
    title: shieldTitle(input.sidekickName),
    subtitle: pickShieldSubtitle(input),
    primaryLabel: SHIELD_PRIMARY_LABEL,
    secondaryLabel: shieldSecondaryLabel(input.sidekickName),
  };
}
