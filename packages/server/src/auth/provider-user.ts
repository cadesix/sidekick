import { and, eq } from "drizzle-orm";
import { type Database, accounts, notificationPreferences, users } from "@sidekick/db";

export type AuthProvider = "apple" | "google" | "email" | "phone";

export type ProviderIdentity = {
  provider: AuthProvider;
  providerAccountId: string;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
};

export type FindOrCreateResult = { userId: string; isNewUser: boolean };

/**
 * Find-or-create a user for a provider identity (19-auth.md). Keyed solely on
 * `(provider, providerAccountId)`: a hit signs that user in; a miss creates a
 * fresh user (with email/phone/emailVerified from the identity), its account row,
 * and notification preferences in one transaction. No anonymous users, no merging.
 */
export async function findOrCreateUserForProvider(
  db: Database,
  identity: ProviderIdentity,
): Promise<FindOrCreateResult> {
  const existing = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.provider, identity.provider),
      eq(accounts.providerAccountId, identity.providerAccountId),
    ),
  });
  if (existing) {
    return { userId: existing.userId, isNewUser: false };
  }

  const emailVerified = identity.email && identity.emailVerified ? new Date() : null;

  const userId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({ email: identity.email, phone: identity.phone, emailVerified })
      .returning({ id: users.id });
    const user = inserted[0];
    if (!user) {
      throw new Error("failed to create user");
    }
    await tx.insert(accounts).values({
      userId: user.id,
      provider: identity.provider,
      providerAccountId: identity.providerAccountId,
    });
    await tx.insert(notificationPreferences).values({ userId: user.id });
    return user.id;
  });

  return { userId, isNewUser: true };
}
