import { and, eq, isNotNull } from "drizzle-orm";
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
 * Providers whose `email_verified` claim we trust enough to link accounts by
 * email. Apple and Google are high-assurance IdPs, and email OTP is our own
 * verification. Any provider NOT in this set can never take over an existing
 * account by asserting a matching email — the allowlist fails safe when a
 * low-assurance provider (e.g. GitHub, which never revalidates emails) is added.
 */
const PROVIDERS_WITH_TRUSTED_EMAIL: ReadonlySet<AuthProvider> = new Set([
  "apple",
  "google",
  "email",
]);

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Find-or-create a user for a provider identity (19-auth.md). Keyed on
 * `(provider, providerAccountId)`: a hit signs that user in. On a miss, if the
 * identity carries a *verified* email from a trusted provider and an existing
 * user already owns that verified email, the new provider is **linked** to that
 * user (a fresh `accounts` row, same `userId`). Otherwise a new user is created
 * with its account row and notification preferences in one transaction.
 *
 * Linking requires verification on *both* sides (trusted `emailVerified` incoming
 * AND the existing user's `emailVerified` set) so an unverified email claim can
 * never hijack an account.
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

  const email = identity.email ? normalizeEmail(identity.email) : undefined;
  const emailIsTrusted =
    email !== undefined &&
    identity.emailVerified === true &&
    PROVIDERS_WITH_TRUSTED_EMAIL.has(identity.provider);

  return db.transaction(async (tx) => {
    if (email !== undefined && emailIsTrusted) {
      const linkTarget = await tx.query.users.findFirst({
        where: and(eq(users.email, email), isNotNull(users.emailVerified)),
      });
      if (linkTarget) {
        await tx.insert(accounts).values({
          userId: linkTarget.id,
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
        });
        return { userId: linkTarget.id, isNewUser: false };
      }
    }

    const inserted = await tx
      .insert(users)
      .values({ email, phone: identity.phone, emailVerified: emailIsTrusted ? new Date() : null })
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
    return { userId: user.id, isNewUser: true };
  });
}
