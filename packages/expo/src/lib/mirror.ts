import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuthStore } from "./auth-store";

/**
 * User-scoped boot mirrors of server state (plan 20 decision 10). The 3D scene
 * hydrates wardrobe + skin from these before any network; the `state.snapshot`
 * query reconciles and rewrites them. Server is truth — a mirror is disposable
 * cache, guarded by the owning userId + a schema version so it's never read for
 * the wrong account or across a shape change. Both auth transitions delete them
 * (auth-session.ts / api.ts signOut), and pre-migration keys (`sidekick-
 * wardrobe-v1`, skin inside `sidekick3d-settings-v2`) are simply abandoned.
 */
export const WARDROBE_MIRROR_KEY = "sidekick.wardrobeMirror";
export const SKIN_MIRROR_KEY = "sidekick.skinMirror";

type Envelope<T> = { userId: string; schemaVersion: number; data: T };

export async function readMirror<T>(key: string, schemaVersion: number): Promise<T | null> {
  const { userId } = useAuthStore.getState();
  if (!userId) {
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const envelope: Envelope<T> = JSON.parse(raw);
    if (envelope.userId !== userId || envelope.schemaVersion !== schemaVersion) {
      return null;
    }
    return envelope.data;
  } catch {
    return null;
  }
}

/** Fire-and-forget write, skipped when no user is signed in (a mirror is never anonymous). */
export function writeMirror<T>(key: string, schemaVersion: number, data: T): void {
  const { userId } = useAuthStore.getState();
  if (!userId) {
    return;
  }
  const envelope: Envelope<T> = { userId, schemaVersion, data };
  AsyncStorage.setItem(key, JSON.stringify(envelope)).catch(() => {
    // storage failures only cost the next cold boot a network round-trip
  });
}

/** Delete every boot mirror — called on both auth transitions, next to queryClient.clear(). */
export async function clearProgressionMirrors(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([WARDROBE_MIRROR_KEY, SKIN_MIRROR_KEY]);
  } catch {
    // a surviving mirror is still unreadable for the next account (userId guard)
  }
}
