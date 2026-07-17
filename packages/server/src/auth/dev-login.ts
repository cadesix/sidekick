import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { type Database, users } from "@sidekick/db";
import { findOrCreateUserForProvider } from "./provider-user";
import { createSession } from "./sessions";

const DEV_EMAIL = "dev@test.local";

export type DevLoginResult = { token: string; userId: string; isNewUser: boolean };

/**
 * Dev-only instant sign-in (19-auth.md). Fail-closed: rejected unless
 * `NODE_ENV === "development"` (unset counts as not-dev, so a prod server refuses
 * it even if called manually). Finds/creates `dev@test.local` via its email
 * account row; a first creation seeds a usable profile (name, sidekick,
 * timezone, notification prefs) with `onboardingCompletedAt` set, so the app
 * skips the onboarding funnel and lands on home. The starter economy state comes
 * from `findOrCreateUserForProvider`, same as any sign-in.
 */
export async function devLogin(db: Database): Promise<DevLoginResult> {
  if (process.env.NODE_ENV !== "development") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Dev login is only available in development" });
  }

  const { userId, isNewUser } = await findOrCreateUserForProvider(db, {
    provider: "email",
    providerAccountId: DEV_EMAIL,
    email: DEV_EMAIL,
    emailVerified: true,
  });

  if (isNewUser) {
    await db
      .update(users)
      .set({
        name: "Dev",
        sidekickName: "Sidekick",
        sidekickColor: "#8a63d2",
        timezone: "America/New_York",
        onboardingCompletedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  const { token } = await createSession(db, userId);
  return { token, userId, isNewUser };
}
