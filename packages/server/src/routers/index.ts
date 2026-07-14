import { router } from "../trpc";
import { adsRouter } from "./ads";
import { authRouter } from "./auth";
import { chatRouter } from "./chat";
import { cosmeticsRouter } from "./cosmetics";
import { deepTalksRouter } from "./deep-talks";
import { documentsRouter } from "./documents";
import { goalsRouter } from "./goals";
import { healthRouter } from "./health";
import { locationRouter } from "./location";
import { memoryRouter } from "./memory";
import { musicRouter } from "./music";
import { onboardingRouter } from "./onboarding";
import { remindersRouter } from "./reminders";
import { usersRouter } from "./users";

export const appRouter = router({
  ads: adsRouter,
  auth: authRouter,
  chat: chatRouter,
  cosmetics: cosmeticsRouter,
  deepTalks: deepTalksRouter,
  documents: documentsRouter,
  goals: goalsRouter,
  health: healthRouter,
  location: locationRouter,
  memory: memoryRouter,
  music: musicRouter,
  onboarding: onboardingRouter,
  reminders: remindersRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
