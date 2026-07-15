// Deterministic RNG + local-day helpers shared by the daily box and shop
// rotation. Pure: callers pass the clock in (Date.now() is a side effect kept
// at the app edge) so rolls are reproducible and testable.

// mulberry32 PRNG — same family the web shop + daily box use.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash → 32-bit seed.
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// local (not UTC) YYYY-MM-DD for a Date.
export function dayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// local day string offset by whole days from `nowMs` (DST-safe ms stepping).
export function localDay(nowMs: number, offsetDays = 0): string {
  return dayString(new Date(nowMs + offsetDays * 86400000));
}
