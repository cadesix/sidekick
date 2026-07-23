import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Haptics only fire on real mobile hardware; no-op on web (Expo Web) and quietly
// on the simulator (no taptic engine). Everything here is fire-and-forget.
const ENABLED = Platform.OS === 'ios' || Platform.OS === 'android';

/** A light tap for chip/selection presses. */
export function hapticTap(): void {
  if (!ENABLED) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A firmer short hit for primary CTA button presses. */
export function hapticButton(): void {
  if (!ENABLED) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** A soft, subtle pop — for each incoming chat message as it lands. */
export function hapticMessage(): void {
  if (!ENABLED) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** A firm single hit — for the onboarding notification banner landing. */
export function hapticNotif(): void {
  if (!ENABLED) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

/**
 * "Meet your sidekick" reveal haptics, aligned to the camera cinematic in
 * onboarding.tsx `submitBirthday`: a rising rumble under the 1.4s `build` shake,
 * then a hard, sustained burst timed to the character's touchdown `impact` shake
 * (jumpIn fires at 1100ms; touchdown lands ~90% through its 800ms → ~1820ms; the
 * impact shake runs ~0.55s). Rapid Heavy hits read as one big landing thud.
 */
export function playRevealHaptics(): void {
  if (!ENABLED) return;
  const I = Haptics.ImpactFeedbackStyle;
  const fire = (style: Haptics.ImpactFeedbackStyle, at: number) =>
    setTimeout(() => void Haptics.impactAsync(style).catch(() => {}), at);

  // build-up: pulses that intensify as the suspense/shake rises (0–1.4s)
  const build: [Haptics.ImpactFeedbackStyle, number][] = [
    [I.Light, 0],
    [I.Light, 250],
    [I.Light, 480],
    [I.Medium, 700],
    [I.Medium, 900],
    [I.Medium, 1060],
    [I.Heavy, 1200],
    [I.Heavy, 1330],
  ];
  for (const [style, at] of build) fire(style, at);

  // landing: a very strong burst at touchdown, sustained across the impact shake
  const land = 1820;
  for (const dt of [0, 60, 130, 220, 340, 480]) fire(I.Heavy, land + dt);
}

/**
 * "Meet your sidekick" build-to-boom, tuned to onboarding's `startMeet`: a
 * DENSE, continuous rumble that grows stronger over `riseMs` (a tight train of
 * impacts — the closest expo-haptics gets to a sustained continuous haptic,
 * which the SDK doesn't expose), a massive burst at the pop (`boomMs`), then a
 * couple of stomp thuds as he lands. Fire-and-forget; self-terminating.
 */
export function playBuildToBoom(riseMs: number, boomMs: number): void {
  if (!ENABLED) return;
  const I = Haptics.ImpactFeedbackStyle;
  const fire = (style: Haptics.ImpactFeedbackStyle, at: number) =>
    setTimeout(() => void Haptics.impactAsync(style).catch(() => {}), Math.max(0, at));

  // a continuous buzz from the start: tightly-spaced hits whose weight climbs as
  // the boom approaches (gaps stay small so it reads as one sustained rumble)
  let t = 0;
  let gap = 150;
  while (t < riseMs - 90) {
    const frac = t / riseMs;
    fire(frac < 0.35 ? I.Light : frac < 0.7 ? I.Medium : I.Heavy, t);
    gap = Math.max(45, gap * 0.9);
    t += gap;
  }
  // BOOM at the pop, then landing stomps
  for (const dt of [0, 70, 150]) fire(I.Heavy, boomMs + dt);
  for (const dt of [0, 90]) fire(I.Heavy, boomMs + 620 + dt); // touchdown
}
