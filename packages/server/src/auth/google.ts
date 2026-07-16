export type VerifiedGoogleToken = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

/**
 * Verify a Google id token (19-auth.md) via Google's tokeninfo endpoint. Accepts
 * the iOS and web client IDs as audiences — `expo-auth-session`'s Google provider
 * mints an id_token on both platforms, so this one path covers them all.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleToken> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );

  if (!response.ok) {
    throw new Error("Invalid Google ID token");
  }

  const payload = (await response.json()) as {
    iss: string;
    aud: string;
    sub: string;
    email?: string;
    email_verified?: string;
    name?: string;
    picture?: string;
    exp: string;
  };

  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Invalid token issuer");
  }

  const validClientIds = [
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
  ].filter(Boolean);

  if (!validClientIds.includes(payload.aud)) {
    throw new Error("Invalid token audience");
  }

  if (Date.now() > Number.parseInt(payload.exp, 10) * 1000) {
    throw new Error("Token has expired");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === "true",
    name: payload.name,
    picture: payload.picture,
  };
}
