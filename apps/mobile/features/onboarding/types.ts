/**
 * Step model for the funnel, ported from the web manifest (`web/src/components/
 * funnel/types.ts`). The funnel is one Expo Router route with an internal step
 * index — `manifest.ts` composes these `StepConfig`s into the ordered `STEPS`
 * array (02 §port strategy). Images are referenced by string key (resolved in
 * `assets.ts` by the RN step components) so this module and the manifest stay
 * asset-free and unit-testable.
 */

export type StepType =
  | "welcome"
  | "name"
  | "choice"
  | "goals"
  | "interests"
  | "transition"
  | "quiz-intro"
  | "statement"
  | "personality"
  | "fact"
  | "result"
  | "reveal"
  | "meet"
  | "choose-color"
  | "name-sidekick"
  | "onboarding-chat";

export type StepRole = "landing" | "question" | "interstitial" | "success";

export interface MultiSelectOption {
  value: string;
  label: string;
  emoji: string;
}

export interface GoalsConfig {
  id: string;
  title: string;
  subtitle?: string;
  minSelections: number;
  /** Goal slugs; icons + labels resolve from the catalog in the step component. */
  options: string[];
}

export interface InterestsConfig {
  id: string;
  title: string;
  subtitle?: string;
  minSelections: number;
  options: MultiSelectOption[];
}

export type BigFiveTrait = "O" | "C" | "E" | "A" | "N";

export interface PersonalityItem {
  id: string;
  text: string;
  trait: BigFiveTrait;
  reverse?: boolean;
}

export interface ChoiceOption {
  value: string;
  label: string;
}

export type StepConfig = (
  | { id: string; type: "welcome"; role: "landing"; title: string; cta?: string }
  | { id: string; type: "name"; role: "question"; title: string; placeholder?: string }
  | { id: string; type: "choice"; role: "question"; key: "age" | "gender"; title: string; options: ChoiceOption[] }
  | { id: string; type: "statement"; role: "interstitial"; title: string; imageKey: string; cta?: string }
  | { id: string; type: "goals"; role: "question"; question: GoalsConfig }
  | { id: string; type: "interests"; role: "question"; question: InterestsConfig }
  | { id: string; type: "transition"; role: "interstitial"; title: string }
  | { id: string; type: "quiz-intro"; role: "interstitial"; title: string; imageKey: string }
  | { id: string; type: "fact"; role: "interstitial"; title: string }
  | { id: string; type: "personality"; role: "question"; question: PersonalityItem }
  | { id: string; type: "result"; role: "success"; title: string }
  | { id: string; type: "reveal"; role: "success"; title: string; subtitle?: string; cta?: string }
  | { id: string; type: "meet"; role: "success"; title?: string; cta?: string }
  | { id: string; type: "choose-color"; role: "success"; title: string }
  | { id: string; type: "name-sidekick"; role: "success"; title: string }
  | { id: string; type: "onboarding-chat"; role: "success"; title: string }
) & { version?: number };

export interface FunnelAnswers {
  name?: string;
  age?: string;
  gender?: string;
  goals?: string[];
  interests?: string[];
  personality?: Record<string, string>;
  sidekickColor?: string;
  sidekickName?: string;
}
