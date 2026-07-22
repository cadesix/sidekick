import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Haptics only fire on real mobile hardware; no-op on web (Expo Web) and quietly
// on the simulator (no taptic engine). Everything here is fire-and-forget.
const ENABLED = Platform.OS === 'ios' || Platform.OS === 'android';

/** A light tap for button/chip presses. */
export function hapticTap(): void {
  if (!ENABLED) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
