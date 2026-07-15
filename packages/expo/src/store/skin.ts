import { loadSettings, saveSettings, type SidekickSettings } from '../three/settings';

// The sidekick's skin — the cel body color plus its darker shadow tint. Ported
// from packages/web/src/components/sidekick-skin.ts so onboarding and the
// Appearance sheet draw from one palette and one persistence path.
//
// Unlike web, the LIVE 3D recolor of an already-mounted scene goes through the
// renderer controller, which this store can't reach. So applySkin only owns
// PERSISTENCE (writes celBodyColor + celShadowColor into settings) and RETURNS
// the patched settings; the caller (home) re-applies them to the live
// controller via controller.applySettings(next).

export type SkinColor = { id: string; body: string; shadow: string };

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
