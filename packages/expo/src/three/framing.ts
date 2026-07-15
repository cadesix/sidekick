import type { Framing } from './renderer';

// Camera framings shared across surfaces so home and onboarding can't drift
// (the repo's north star is one code path for web + native — see root CLAUDE.md).
// Hero: full-body, centered. Chat: pulled way back + low so the whole standing
// character composes into the top sliver above an ~80%-height chat sheet.
export const HERO_FRAMING: Framing = { pos: [0, 0.66, 4.2], target: [0, 0.56, 0], fov: 41.1 };
export const CHAT_FRAMING: Framing = { pos: [0, 1.6, 13], target: [0, -2.0, 0], fov: 30 };
