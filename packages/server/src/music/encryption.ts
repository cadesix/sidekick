import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypt the Apple Music user token at rest (12 §music). AES-256-GCM with a key
 * from `MUSIC_TOKEN_KEY` (base64, 32 bytes). Stored as `gcm:iv:tag:ciphertext`.
 * When no key is configured (local/dev) we fall back to a `plain:` marker so the
 * flow still works — production must set the key. Decryption dispatches on prefix.
 */
function keyFromEnv(): Buffer | null {
  const raw = process.env.MUSIC_TOKEN_KEY;
  if (!raw) {
    return null;
  }
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function encryptToken(plaintext: string): string {
  const key = keyFromEnv();
  if (!key) {
    return `plain:${plaintext}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  if (stored.startsWith("plain:")) {
    return stored.slice("plain:".length);
  }
  if (!stored.startsWith("gcm:")) {
    return stored;
  }
  const key = keyFromEnv();
  if (!key) {
    throw new Error("MUSIC_TOKEN_KEY is required to decrypt a stored music token");
  }
  const [, ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("malformed encrypted music token");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
