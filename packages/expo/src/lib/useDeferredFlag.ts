import { useEffect, useState } from 'react';

// A boolean derived from `on` with independent enter/leave delays. Both the Shop
// and Closet sheets stay mounted and slide via transform, so their heavy content
// (image grids, animation loops, per-second intervals) needs to mount/unmount on
// a timer relative to the slide rather than instantly:
//   - offDelay: keep the flag true this long AFTER `on` goes false (so content
//     stays through the slide-out) — content-unmount gate.
//   - onDelay: flip the flag true this long AFTER `on` goes true (so a stagger /
//     heavy grid lands after the slide-in settles) — deferred-reveal gate.
// The delays are tied to the sheets' slide durations.
export function useDeferredFlag(
  on: boolean,
  { onDelay = 0, offDelay = 0 }: { onDelay?: number; offDelay?: number },
): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    const delay = on ? onDelay : offDelay;
    if (delay === 0) {
      setFlag(on);
      return;
    }
    const t = setTimeout(() => setFlag(on), delay);
    return () => clearTimeout(t);
  }, [on, onDelay, offDelay]);
  return flag;
}
