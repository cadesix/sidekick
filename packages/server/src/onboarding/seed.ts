import { type Cadence, cadencePhrase } from "@sidekick/shared";

export { cadencePhrase };

/**
 * Cold-start memory seeding (user-memory.md §6). At funnel completion we write one
 * `identity` sentence from demographics, one `preference` sentence from the
 * archetype, and one `goal_context` sentence per chosen goal — all plain
 * third-person sentences with `source='onboarding'`, `confidence='stated'`. These
 * builders are pure so the exact sentences are unit-testable.
 */

export type OnboardingPersonality = {
  archetype: string;
  tagline: string;
  blurb: string;
  percents: { O: number; C: number; E: number; A: number; N: number };
};

const AGE_PHRASE: Record<string, string> = {
  "under-18": "under 18",
  "18-24": "18–24",
  "25-34": "25–34",
  "35-44": "35–44",
  "45-54": "45–54",
  "55-plus": "55 or older",
};

const GENDER_PHRASE: Record<string, string> = {
  female: "female",
  male: "male",
  "non-binary": "non-binary",
};

const lower = (value: string): string => value.toLowerCase();

export function agePhrase(bracket: string): string {
  return AGE_PHRASE[bracket] ?? bracket;
}

/**
 * e.g. "Maya is 25–34, female." — each of age/gender is omitted when empty or
 * (gender) unrecognized/'prefer-not'; with neither, falls back to "Maya just joined."
 * (the streamlined onboarding may not collect a birthday). `gender` is expected
 * canonical (female/male/non-binary).
 */
export function identitySentence(name: string, ageBracket: string, gender: string): string {
  const parts = [ageBracket ? agePhrase(ageBracket) : "", GENDER_PHRASE[gender] ?? ""].filter(Boolean);
  return parts.length > 0 ? `${name} is ${parts.join(", ")}.` : `${name} just joined.`;
}

/** e.g. "Maya's coaching style is The Spark — spontaneous, playful, lives in the moment." */
export function preferenceSentence(name: string, personality: OnboardingPersonality): string {
  return `${name}'s coaching style is ${personality.archetype} — ${lower(personality.tagline)}`;
}

/** e.g. "Maya is into music, gaming, fitness." — one `interest` memory. */
export function interestsSentence(name: string, interests: string[]): string {
  return `${name} is into ${interests.join(", ")}.`;
}

/** e.g. "Maya chose get fit (go for a run, 3× a week)." */
export function goalContextSentence(
  name: string,
  goalLabel: string,
  actionLabel: string | undefined,
  cadence: Cadence | undefined,
): string {
  const base = `${name} chose ${lower(goalLabel)}`;
  const phrase = cadencePhrase(cadence);
  if (actionLabel && phrase) {
    return `${base} (${lower(actionLabel)}, ${phrase}).`;
  }
  if (actionLabel) {
    return `${base} (${lower(actionLabel)}).`;
  }
  return `${base}.`;
}
