import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { syncHealth, touchStreak } from '~/lib/api';
import { maybeRefreshFocusShield } from '~/lib/focus';
import { readHealthDays } from '~/lib/health';
import { HEALTH_CONNECTION_QUERY_KEY } from '~/lib/health-connection';
import { maybeUpdateLocation } from '~/lib/location';
import { patchStreakTouch, SNAPSHOT_QUERY_KEY } from '~/lib/state';

// Each integration pushes fresh device data, then invalidates the query that
// reads it back. All are safe no-ops when the user hasn't connected / has denied
// permission, so a rejection just means "not shared" — the caller runs them via
// allSettled so one unavailable integration never blocks the others.
async function syncHealthData(queryClient: QueryClient): Promise<void> {
  const days = await readHealthDays(30);
  if (days.length === 0) {
    return;
  }
  await syncHealth(days);
  await queryClient.invalidateQueries({ queryKey: HEALTH_CONNECTION_QUERY_KEY });
}

async function syncLocation(queryClient: QueryClient): Promise<void> {
  await maybeUpdateLocation();
  await queryClient.invalidateQueries({ queryKey: ['location', 'setting'] });
}

async function syncFocus(queryClient: QueryClient): Promise<void> {
  await maybeRefreshFocusShield();
  await queryClient.invalidateQueries({ queryKey: ['focus-local'] });
}

// Progression is server-truth (plan 20 decision 11): no push in v1, so each
// foreground touches the app-open streak (decision 7 — server-idempotent per
// local day, so once per foreground event is the only client-side discipline)
// and then refetches the snapshot — cross-device changes land here. Ordering
// the refetch after the touch means the first snapshot of the day already
// carries the bumped count; the patch after both settles the count even when
// the refetch deduped into an in-flight pre-touch request.
async function syncProgression(queryClient: QueryClient): Promise<void> {
  const touch = await touchStreak().catch(() => null);
  await queryClient.invalidateQueries({ queryKey: SNAPSHOT_QUERY_KEY });
  if (touch) {
    patchStreakTouch(queryClient, touch);
  }
}

/**
 * On each genuine foreground (and once on mount), push fresh HealthKit days,
 * coarse location, and focus-shield state, then refresh the queries that read
 * them back (12-life-integrations.md). An `AppState` subscription is the accepted
 * RN mechanism for a foreground trigger, so this is a justified useEffect.
 *
 * iOS also emits `active` for transient interruptions — Control Center, the Face
 * ID prompt, notification banners — so we sync only on a real background→active
 * transition; otherwise every glance at Control Center re-runs the whole sync.
 */
export function useForegroundSync(): void {
  const queryClient = useQueryClient();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    function sync(): void {
      void Promise.allSettled([
        syncHealthData(queryClient),
        syncLocation(queryClient),
        syncFocus(queryClient),
        syncProgression(queryClient),
      ]);
    }
    function onChange(next: AppStateStatus): void {
      const cameToForeground = /inactive|background/.test(appState.current) && next === 'active';
      appState.current = next;
      if (cameToForeground) {
        sync();
      }
    }
    sync();
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [queryClient]);
}
