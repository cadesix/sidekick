import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { type Database, accounts, notificationPreferences, users } from "@sidekick/db";
import { createSession } from "./sessions";

const DEV_EMAIL = "dev@test.local";

export type DevLoginResult = { token: string; userId: string; isNewUser: boolean };

/**
 * Dev-only instant sign-in (19-auth.md). Fail-closed: rejected unless
 * `NODE_ENV === "development"` (unset counts as not-dev, so a prod server refuses
 * it even if called manually). Finds/creates `dev@test.local` via its email
 * account row; a first creation seeds a usable profile (name, sidekick,
 * timezone, sparks, notification prefs) with `onboardingCompletedAt` set, so the
 * app skips the onboarding funnel and lands on home.
 */
export async function devLogin(db: Database): Promise<DevLoginResult> {
  if (process.env.NODE_ENV !== "development") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Dev login is only available in development" });
  }

  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.provider, "email"), eq(accounts.providerAccountId, DEV_EMAIL)),
  });
  if (existing) {
    const { token } = await createSession(db, existing.userId);
    return { token, userId: existing.userId, isNewUser: false };
  }

  const userId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        email: DEV_EMAIL,
        emailVerified: new Date(),
        name: "Dev",
        sidekickName: "Sidekick",
        sidekickColor: "#8a63d2",
        timezone: "America/New_York",
        onboardingCompletedAt: new Date(),
        sparks: 50,
      })
      .returning({ id: users.id });
    const user = inserted[0];
    if (!user) {
      throw new Error("failed to create dev user");
    }
    await tx
      .insert(accounts)
      .values({ userId: user.id, provider: "email", providerAccountId: DEV_EMAIL });
    await tx.insert(notificationPreferences).values({ userId: user.id });
    return user.id;
  });

  const { token } = await createSession(db, userId);
  return { token, userId, isNewUser: true };
}
