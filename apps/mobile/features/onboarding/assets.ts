import type { ImageSourcePropType } from "react-native";

/**
 * Static asset maps for the funnel. React Native's `require` needs literal paths,
 * so every quiz scene, Likert face, archetype render, and sidekick color is
 * enumerated here (assets copied from `web/public` into `assets/onboarding`).
 */

export const WELCOME_HERO = require("../../assets/onboarding/welcome-hero.webp");
export const CHEER = require("../../assets/onboarding/sidekick-cheer.webp");
export const THINK = require("../../assets/onboarding/sidekick-think.webp");
export const SILHOUETTE = require("../../assets/onboarding/sidekick-silhouette.webp");
export const MEET = require("../../assets/onboarding/meet-sidekick.webp");
export const QUIZ_INTRO = require("../../assets/onboarding/quiz-intro.webp");
export const QUIZ_PROMPT = require("../../assets/onboarding/quiz-prompt.webp");

export const FACES: Record<string, ImageSourcePropType> = {
  "1": require("../../assets/onboarding/faces/1.webp"),
  "2": require("../../assets/onboarding/faces/2.webp"),
  "3": require("../../assets/onboarding/faces/3.webp"),
  "4": require("../../assets/onboarding/faces/4.webp"),
  "5": require("../../assets/onboarding/faces/5.webp"),
};

export const SCENES: Record<string, ImageSourcePropType> = {
  q1: require("../../assets/onboarding/scenes/q1.webp"),
  q2: require("../../assets/onboarding/scenes/q2.webp"),
  q3: require("../../assets/onboarding/scenes/q3.webp"),
  q4: require("../../assets/onboarding/scenes/q4.webp"),
  q5: require("../../assets/onboarding/scenes/q5.webp"),
  q6: require("../../assets/onboarding/scenes/q6.webp"),
  q7: require("../../assets/onboarding/scenes/q7.webp"),
  q8: require("../../assets/onboarding/scenes/q8.webp"),
  q9: require("../../assets/onboarding/scenes/q9.webp"),
  q10: require("../../assets/onboarding/scenes/q10.webp"),
  q11: require("../../assets/onboarding/scenes/q11.webp"),
  q12: require("../../assets/onboarding/scenes/q12.webp"),
  q13: require("../../assets/onboarding/scenes/q13.webp"),
  q14: require("../../assets/onboarding/scenes/q14.webp"),
  q15: require("../../assets/onboarding/scenes/q15.webp"),
  q16: require("../../assets/onboarding/scenes/q16.webp"),
  q17: require("../../assets/onboarding/scenes/q17.webp"),
  q18: require("../../assets/onboarding/scenes/q18.webp"),
  q19: require("../../assets/onboarding/scenes/q19.webp"),
  q20: require("../../assets/onboarding/scenes/q20.webp"),
};

export const ARCHETYPES: Record<string, ImageSourcePropType> = {
  strategist: require("../../assets/onboarding/types/strategist.webp"),
  tinkerer: require("../../assets/onboarding/types/tinkerer.webp"),
  driver: require("../../assets/onboarding/types/driver.webp"),
  maverick: require("../../assets/onboarding/types/maverick.webp"),
  guide: require("../../assets/onboarding/types/guide.webp"),
  dreamer: require("../../assets/onboarding/types/dreamer.webp"),
  inspirer: require("../../assets/onboarding/types/inspirer.webp"),
  "free-spirit": require("../../assets/onboarding/types/free-spirit.webp"),
  backbone: require("../../assets/onboarding/types/backbone.webp"),
  caretaker: require("../../assets/onboarding/types/caretaker.webp"),
  captain: require("../../assets/onboarding/types/captain.webp"),
  connector: require("../../assets/onboarding/types/connector.webp"),
  maker: require("../../assets/onboarding/types/maker.webp"),
  wanderer: require("../../assets/onboarding/types/wanderer.webp"),
  "go-getter": require("../../assets/onboarding/types/go-getter.webp"),
  spark: require("../../assets/onboarding/types/spark.webp"),
};

/** Resolves a statement/quiz-intro step's `imageKey` to its illustration. */
export const STATEMENT_IMAGES: Record<string, ImageSourcePropType> = {
  "quiz-intro": QUIZ_INTRO,
  "quiz-prompt": QUIZ_PROMPT,
};

export const COLOR_HEROES: Record<string, ImageSourcePropType> = {
  yellow: require("../../assets/onboarding/colors/yellow.webp"),
  red: require("../../assets/onboarding/colors/red.webp"),
  pink: require("../../assets/onboarding/colors/pink.webp"),
  purple: require("../../assets/onboarding/colors/purple.webp"),
  lightblue: require("../../assets/onboarding/colors/lightblue.webp"),
  green: require("../../assets/onboarding/colors/green.webp"),
  white: require("../../assets/onboarding/colors/white.webp"),
};
