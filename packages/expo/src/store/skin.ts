import { readMirror, SKIN_MIRROR_KEY, writeMirror } from '../lib/mirror';
import { loadSettings, saveSettings, type SidekickSettings } from '../three/settings';

// The sidekick's skin — the cel body color plus its darker shadow tint. The
// server owns it since plan 20 (`users.skin`, cosmetics.setSkin); this module
// keeps the palette, the settings plumbing the renderer reads, and the
// user-scoped boot mirror (lib/mirror.ts) that lets the scene build with the
// right colors before any network.
//
// The LIVE 3D recolor of an already-mounted scene goes through the renderer
// controller, which this module can't reach. So applySkin only owns the local
// scene state (writes celBodyColor + celShadowColor into settings) and RETURNS
// the patched settings; the caller (home / AppearanceSheet) re-applies them to
// the live controller via controller.applySettings(next).

export type SkinColor = { id: string; body: string; shadow: string };

export type Skin = { body: string; shadow: string };

// bumped whenever the persisted Skin shape changes; a mismatched mirror is ignored
const SKIN_SCHEMA_VERSION = 1;

export function saveSkinMirror(skin: Skin): void {
  writeMirror(SKIN_MIRROR_KEY, SKIN_SCHEMA_VERSION, skin);
}

/**
 * Boot-time hydration (plan 20 decision 10): after the look-dev settings load,
 * the mirrored server skin overwrites their cel colors — so the scene builds
 * wearing the signed-in account's skin, not whatever the device last rendered.
 * No mirror (fresh install, other account, never picked) leaves settings as-is.
 */
export async function hydrateSkinFromMirror(): Promise<void> {
  const skin = await readMirror<Skin>(SKIN_MIRROR_KEY, SKIN_SCHEMA_VERSION);
  if (!skin) return;
  saveSettings({ ...loadSettings(), celBodyColor: skin.body, celShadowColor: skin.shadow });
}

export const SKIN_COLORS: SkinColor[] = [
  { id: 'sunny', body: '#f2b13c', shadow: '#c98f52' },
  { id: 'coral', body: '#f57e63', shadow: '#c85f4a' },
  { id: 'sky', body: '#5fa8e0', shadow: '#3f7db0' },
  { id: 'mint', body: '#6cc98f', shadow: '#4a9b6b' },
  { id: 'grape', body: '#a988e0', shadow: '#7d63b0' },
  { id: 'bubblegum', body: '#f28cc0', shadow: '#c86a99' },
];

// Persist the picked skin into the shared settings and return the patched copy
// so the caller can push it to the live scene (applySettings) itself.
export function applySkin(id: string): SidekickSettings {
  const skin = SKIN_COLORS.find((c) => c.id === id) ?? SKIN_COLORS[0];
  const next: SidekickSettings = {
    ...loadSettings(),
    celBodyColor: skin.body,
    celShadowColor: skin.shadow,
  };
  saveSettings(next);
  return next;
}

// The skin id whose body color matches the current settings, or null if none.
export function currentSkinId(settings: SidekickSettings): string | null {
  const body = settings.celBodyColor?.toLowerCase();
  return SKIN_COLORS.find((c) => c.body.toLowerCase() === body)?.id ?? null;
}
