import { SignJWT, importPKCS8 } from "jose";

/**
 * Apple MusicKit developer-token config, read from env. The `.p8` private key
 * never ships to the client — the app fetches short-lived developer tokens from
 * our endpoint (12-life-integrations.md). Newlines in the PEM may arrive escaped
 * (`\n`) from a single-line env var, so we unescape them.
 */
export type AppleMusicEnv = {
  privateKey?: string;
  keyId?: string;
  teamId?: string;
};

export function appleMusicEnvFromProcess(env: NodeJS.ProcessEnv): AppleMusicEnv {
  return {
    privateKey: env.APPLE_MUSIC_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    keyId: env.APPLE_MUSIC_KEY_ID,
    teamId: env.APPLE_MUSIC_TEAM_ID,
  };
}

/** Apple caps developer tokens at 6 months; we mint them for ~180 days. */
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180;

export type DeveloperToken = { token: string; expiresAt: Date };

/**
 * Mint an ES256 developer token from the MusicKit `.p8` key. Returns `null` when
 * the env isn't configured, so the endpoint can answer a clean 501 rather than
 * throwing.
 */
export async function mintDeveloperToken(
  env: AppleMusicEnv,
  now: Date = new Date(),
): Promise<DeveloperToken | null> {
  if (!env.privateKey || !env.keyId || !env.teamId) {
    return null;
  }
  const key = await importPKCS8(env.privateKey, "ES256");
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.keyId })
    .setIssuer(env.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return { token, expiresAt: new Date(exp * 1000) };
}
