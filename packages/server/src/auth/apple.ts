import appleSignin from "apple-signin-auth";

export type Platform = "ios" | "web";

export type VerifiedAppleToken = {
  sub: string;
  email?: string;
  emailVerified: boolean;
};

/**
 * Verify an Apple identity token (19-auth.md). Audience is platform-specific: the
 * app bundle id on iOS, the Services ID on web. `apple-signin-auth` fetches and
 * caches Apple's JWKS itself.
 */
export async function verifyAppleToken(
  identityToken: string,
  platform: Platform,
): Promise<VerifiedAppleToken> {
  const audience =
    platform === "web"
      ? (process.env.APPLE_SERVICES_ID ?? process.env.APP_BUNDLE_IDENTIFIER ?? "")
      : (process.env.APP_BUNDLE_IDENTIFIER ?? "");

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
