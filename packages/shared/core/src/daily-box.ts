// The daily box — the steady-state coin faucet (docs/token-economy.md). One box
// per local day: a guaranteed coin roll (band by streak tier) + a ~1-in-7 bonus
// double + the streak milestone reward on milestone days. Rolls are seeded by
// (day, "daily-box") so contents are fixed before opening and reload never
// rerolls. Pure — persistence + grants live in the app store.

import { hashStr, mulberry32 } from './rng';

// Streak milestone schedule: a reward every day for week one, then tapering so
// later rewards keep scarcity. Rewards are coins or real shop cosmetics.
export type Milestone = { day: number; label: string; coins?: number; render?: string };

export const MILESTONES: Milestone[] = [
  { day: 1, label: '10 coins', coins: 10 },
  { day: 2, label: '15 coins', coins: 15 },
  { day: 3, label: 'Charcoal Beanie', render: 'beanie-charcoal' },
  { day: 4, label: '20 coins', coins: 20 },
  { day: 5, label: '25 coins', coins: 25 },
  { day: 6, label: 'Black Glasses', render: 'glasses-black' },
  { day: 7, label: 'White Sneakers', render: 'sneakers-white' },
  { day: 10, label: '40 coins', coins: 40 },
  { day: 14, label: 'Sky Backpack', render: 'backpack-sky' },
  { day: 21, label: '75 coins', coins: 75 },
  { day: 30, label: 'Wizard Hat', render: 'wizard-purple' },
  { day: 45, label: '100 coins', coins: 100 },
  { day: 60, label: 'Night Bucket Hat', render: 'bucket-night' },
  { day: 90, label: '200 coins', coins: 200 },
  { day: 180, label: 'Silver Crown', render: 'crown-silver' },
  { day: 365, label: 'Gold Crown', render: 'crown-gold' },
];

// box tier bands: expected 20/25/30 per day, ±10% so opening feels alive but
// weekly income converges on the curve.
export type BoxTier = 'base' | 'silver' | 'gold';
export const TIER_BANDS: Record<BoxTier, [number, number]> = {
  base: [18, 22],
  silver: [22, 28],
  gold: [27, 33],
};

export function boxTier(streak: number): BoxTier {
  return streak >= 30 ? 'gold' : streak >= 7 ? 'silver' : 'base';
}

export type BoxReward = {
  tier: BoxTier;
  coins: number; // the guaranteed roll (pre-double)
  doubled: boolean; // bonus slot hit: the roll pays out twice
  milestone?: Milestone; // present on milestone days
  total: number; // coins actually granted (roll × double + milestone coins)
};

// Pure seeded roll for a given day's box — safe to call any number of times.
export function rollDailyBox(streak: number, dayStr: string): BoxReward {
  const rng = mulberry32(hashStr(`${dayStr}|daily-box`));
  const tier = boxTier(streak);
  const [min, max] = TIER_BANDS[tier];
  const coins = min + Math.floor(rng() * (max - min + 1));
  const doubled = rng() < 1 / 7;
  const milestone = MILESTONES.find((m) => m.day === streak);
  const total = coins * (doubled ? 2 : 1) + (milestone?.coins ?? 0);
  return { tier, coins, doubled, milestone, total };
}
