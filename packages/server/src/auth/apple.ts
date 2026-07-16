import appleSignin from "apple-signin-auth";

export type VerifiedAppleToken = {
  sub: string;
  email?: string;
  emailVerified: boolean;
};

/**
 * Verify an Apple identity token (19-auth.md). The token's `aud` must match one of
 * our own client identifiers — the iOS app bundle id and/or the web Services ID —
 * so a token minted for any other Apple app is rejected. We fail closed when
 * neither is configured: `apple-signin-auth` forwards the audience to
 * `jsonwebtoken`, which SKIPS the `aud` check entirely for a falsy value, so an
 * empty audience would accept any Apple-signed token. `apple-signin-auth` fetches
 * and caches Apple's JWKS itself.
 */
export async function verifyAppleToken(identityToken: string): Promise<VerifiedAppleToken> {
  const audience = [process.env.APP_BUNDLE_IDENTIFIER, process.env.APPLE_SERVICES_ID].filter(
    (value): value is string => Boolean(value),
  );
  if (audience.length === 0) {
    throw new Error(
      "Apple sign-in is not configured: set APP_BUNDLE_IDENTIFIER and/or APPLE_SERVICES_ID",
    );
  }

  const claims = await appleSignin.verifyIdToken(identityToken, {
    audience,
    ignoreExpiration: false,
  });

  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === "true" || claims.email_verified === true,
  };
}
