// Coin balance + owned-cosmetics inventory — pure tables/clamps. Persistence
// lives in the app adapters; this module only owns the numbers.

export const START_COINS = 150;
// the outfit you start with is already yours
export const START_INVENTORY = ['shirt-sky'];

// Chat mini-games (plans/21-games.md): flat, participation-flavored payouts —
// small + capped so there is nothing worth cheating.
export const GAME_WIN_COINS = 20;
export const GAME_LOSS_COINS = 5;
// only the first N completed matches per local day pay out
export const GAME_REWARD_DAILY_CAP = 3;
