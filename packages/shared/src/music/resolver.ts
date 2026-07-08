import type { Database } from "@sidekick/db";
import type { AppleMusicClient } from "./client";

/**
 * The seam that decouples the shared music tools from server-only token
 * decryption + developer-token minting (both node-bound, so they can't live in
 * this mobile-bundled package). The server registers the real resolver at boot
 * (`setAppleMusicClientResolver` in services.ts); tests register one returning a
 * `ScriptedAppleMusicClient`. Default returns `null` → tools report "not_connected".
 */
export type AppleMusicClientResolver = (
  db: Database,
  userId: string,
) => Promise<AppleMusicClient | null>;

let resolver: AppleMusicClientResolver = async () => null;

export function setAppleMusicClientResolver(next: AppleMusicClientResolver): void {
  resolver = next;
}

export function resolveAppleMusicClient(
  db: Database,
  userId: string,
): Promise<AppleMusicClient | null> {
  return resolver(db, userId);
}
