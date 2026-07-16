// Bond: how much the sidekick knows about you (10–100). Grows via guided
// sessions (they call the app's addBond, which clamps with this). Map
// destinations unlock at bond thresholds; the score floats over the head.

export const BOND_MAX = 100;
// every sidekick starts a little bonded — the score reads as a percent and
// never drops below this floor
export const BOND_MIN = 10;
