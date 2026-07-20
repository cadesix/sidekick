import { router } from "../trpc";
import { adsRouter } from "./ads";
import { authRouter } from "./auth";
import { chatRouter } from "./chat";
import { cosmeticsRouter } from "./cosmetics";
import { dailyBoxRouter } from "./daily-box";
import { deepTalksRouter } from "./deep-talks";
import { devRouter } from "./dev";
import { documentsRouter } from "./documents";
import { gamesRouter } from "./games";
import { goalsRouter } from "./goals";
import { healthRouter } from "./health";
import { locationRouter } from "./location";
import { memoryRouter } from "./memory";
import { musicRouter } from "./music";
import { onboardingRouter } from "./onboarding";
import { notificationsRouter } from "./notifications";
import { remindersRouter } from "./reminders";
import { sessionsRouter } from "./sessions";
import { shopRouter } from "./shop";
import { starChatRouter } from "./star-chat";
import { stateRouter } from "./state";
import { streakRouter } from "./streak";
import { usersRouter } from "./users";

export const appRouter = router({
  ads: adsRouter,
  auth: authRouter,
  chat: chatRouter,
  cosmetics: cosmeticsRouter,
  dailyBox: dailyBoxRouter,
  deepTalks: deepTalksRouter,
  dev: devRouter,
  documents: documentsRouter,
  games: gamesRouter,
  goals: goalsRouter,
  health: healthRouter,
  location: locationRouter,
  memory: memoryRouter,
  music: musicRouter,
  onboarding: onboardingRouter,
  notifications: notificationsRouter,
  reminders: remindersRouter,
  sessions: sessionsRouter,
  shop: shopRouter,
  starChat: starChatRouter,
  state: stateRouter,
  streak: streakRouter,
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
