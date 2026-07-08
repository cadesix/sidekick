/**
 * Design tokens (06-design-system §1). The NativeWind theme in `tailwind.config.js`
 * mirrors these as class names; this module exposes the raw values for the places
 * RN needs an inline style (SolidShadow's hard shadow, pastel row fills).
 */
export const INK = "#111111";

/**
 * Rotating pastel fills for option cards / goal rows (06 §1.1). Lists index into
 * this in order by row index.
 */
export const PASTELS = ["#FBF5D0", "#F6D2CB", "#DCF3EF", "#F1DAF6", "#DCE7FB"] as const;

export const pastelFor = (i: number): string => PASTELS[i % PASTELS.length] ?? PASTELS[0];
