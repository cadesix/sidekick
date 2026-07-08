import { eq } from "drizzle-orm";
import { type Database, musicAuth } from "@sidekick/db";
import { type AppleMusicClient, HttpAppleMusicClient } from "@sidekick/shared";
import { appleMusicEnvFromProcess, mintDeveloperToken } from "./dev-token";
import { decryptToken } from "./encryption";

/**
 * Build a real Apple Music client from a plaintext user token (used right after
 * `connect`, before the token is stored). Returns `null` when the developer-token
 * env isn't configured, so taste ingestion silently skips in unconfigured envs.
 */
export async function appleMusicClientFromToken(
  userToken: string,
  storefront: string | null,
): Promise<AppleMusicClient | null> {
  const developer = await mintDeveloperToken(appleMusicEnvFromProcess(process.env));
  if (!developer) {
    return null;
  }
  return new HttpAppleMusicClient({
    developerToken: developer.token,
    userToken,
    storefront: storefront ?? undefined,
  });
}

/**
 * The resolver the server registers into the shared music tools (services.ts):
 * read the stored token for the user, decrypt it, mint a developer token, and
 * hand back a live client. `null` → the tools report "not_connected".
 */
export async function appleMusicClientForUser(
  db: Database,
  userId: string,
): Promise<AppleMusicClient | null> {
  const rows = await db
    .select({ userToken: musicAuth.userToken, storefront: musicAuth.storefront })
    .from(musicAuth)
    .where(eq(musicAuth.userId, userId))
    .limit(1);
  const auth = rows[0];
  if (!auth) {
    return null;
  }
  return appleMusicClientFromToken(decryptToken(auth.userToken), auth.storefront);
}
