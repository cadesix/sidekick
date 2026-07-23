import { useEffect } from 'react';
import { Easing, cancelAnimation, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

// The shared ramp behind the head-tracked floating buttons' lazy drift (star
// pill, closet avatar): a repeating linear 0→1 that each consumer maps through
// its own integer-rate sine pair (sin(k·2π + φ) = sin(φ), so the repeat wrap is
// seamless).
//
// Lifecycle rules both consumers need and previously hand-copied:
//  - stopped while hidden: an invisible overlay shouldn't tick a worklet a frame
//  - restarted FROM 0 on unhide: cancelAnimation freezes mid-ramp, and
//    withRepeat would loop that midpoint→1 forever — a positional snap per wrap
export function useOverheadDrift(hidden: boolean | undefined, periodMs: number): SharedValue<number> {
  const drift = useSharedValue(0);
  useEffect(() => {
    if (hidden) {
      cancelAnimation(drift);
      return;
    }
    drift.value = 0;
    drift.value = withRepeat(withTiming(1, { duration: periodMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(drift);
  }, [hidden, periodMs, drift]);
  return drift;
}
