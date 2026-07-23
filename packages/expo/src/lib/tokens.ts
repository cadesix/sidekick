/**
 * Design tokens (06-design-system §1). The NativeWind theme in `tailwind.config.js`
 * mirrors these as class names; this module exposes the raw values for the places
 * RN needs an inline style (SolidShadow's hard shadow, pastel row fills).
 */
export const INK = "#111111";

/**
 * The one type family (06 §1.2), ABC Diatype Rounded. iOS won't faux-bold a
 * custom font, so weights are separate families — always set the family, never
 * fontWeight, for the bold/medium looks. Registered in app/_layout.tsx.
 */
export const FONT = "Diatype-Rounded";
export const FONT_MEDIUM = "Diatype-Rounded-Medium";
export const FONT_BOLD = "Diatype-Rounded-Bold";

/**
 * Rotating pastel fills for option cards / goal rows (06 §1.1). Lists index into
 * this in order by row index.
 */
export const PASTELS = ["#FBF5D0", "#F6D2CB", "#DCF3EF", "#F1DAF6", "#DCE7FB"] as const;

export const pastelFor = (i: number): string => PASTELS[i % PASTELS.length] ?? PASTELS[0];
