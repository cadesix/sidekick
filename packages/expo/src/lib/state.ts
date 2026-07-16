import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";

import type { SessionsState } from "@sidekick/core";

import {
  type BoxClaim,
  fetchSnapshot,
  type SessionComplete,
  type Snapshot,
  type StreakTouch,
} from "./api";

/**
 * The client side of plan 20's server-driven state: one cold-start
 * `state.snapshot` query holding every progression slice (coins, bond, streak,
 * daily box, inventory, skin, astral, sessions), kept fresh by mutation patches
 * and a foreground refetch (useForegroundSync.ts). Later domains extend this
 * file — a new slice is a field on the snapshot plus a patch from its mutation,
 * never a new cold-start round trip.
 */
export const SNAPSHOT_QUERY_KEY = ["state", "snapshot"] as const;

export type { Snapshot };

export function useSnapshot(): UseQueryResult<Snapshot> {
  return useQuery({ queryKey: SNAPSHOT_QUERY_KEY, queryFn: fetchSnapshot });
}

/** Every progression mutation returns the new version plus only the fields it changed. */
export type SnapshotPatch = Partial<Snapshot> & Pick<Snapshot, "stateVersion">;

/**
 * Compare-before-patch (plan 20 decision 11): a mutation response carrying an
 * older `stateVersion` than the cached snapshot's NEVER overwrites newer cache
 * state — a delayed response can't clobber what a faster one already applied.
 * With nothing cached yet there is nothing to patch; the snapshot query fills
 * the cache whole when it lands.
 */
export function patchSnapshot(queryClient: QueryClient, patch: SnapshotPatch): void {
  queryClient.setQueryData<Snapshot>(SNAPSHOT_QUERY_KEY, (current) => {
    if (!current || patch.stateVersion < current.stateVersion) {
      return current;
    }
    return { ...current, ...patch };
  });
}

/**
 * Merge a `streak.touch` response into the cached snapshot. The touch returns
 * only the count, so the rest of the streak slice (the milestone ladder) is
 * carried over from cache rather than clobbered by a partial slice.
 */
export function patchStreakTouch(queryClient: QueryClient, touch: StreakTouch): void {
  const current = queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY);
  if (!current) {
    return;
  }
  patchSnapshot(queryClient, {
    stateVersion: touch.stateVersion,
    streak: { ...current.streak, count: touch.count },
  });
}

/**
 * Apply a `dailyBox.claim` response: the new balance, the streak count the
 * claim's same-transaction touch produced, and the box no longer claimable.
 * The ladder and tier carry over from cache — the next box's tier arrives with
 * the next snapshot refetch.
 */
export function patchBoxClaim(queryClient: QueryClient, claim: BoxClaim): void {
  const current = queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY);
  if (!current) {
    return;
  }
  patchSnapshot(queryClient, {
    stateVersion: claim.stateVersion,
    coins: claim.coins,
    streak: { ...current.streak, count: claim.streak },
    dailyBox: { ...current.dailyBox, claimable: false },
  });
}

/**
 * The snapshot's per-session rows as core's `SessionsState`, for the pure ladder
 * helpers (isSessionDone, nextSession, isIslandUnlocked…). Raw answers stay
 * server-side by design (decision 11), so the shape's `answers` is always empty
 * here — nothing that reads the snapshot needs them.
 */
export function snapshotSessions(snapshot: Snapshot | undefined): SessionsState {
  const state: SessionsState = {};
  for (const s of snapshot?.sessions ?? []) {
    state[s.sessionId] = { beat: s.beat, answers: [], done: s.done };
  }
  return state;
}

/**
 * Keep the cached sessions slice current as a `sessions.progress` upsert lands,
 * so diving out of a session and back in resumes at the right beat without a
 * snapshot refetch.
 */
export function patchSessionProgress(
  queryClient: QueryClient,
  sessionId: string,
  beat: number,
  stateVersion: number,
): void {
  const current = queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY);
  if (!current) {
    return;
  }
  const rest = current.sessions.filter((s) => s.sessionId !== sessionId);
  patchSnapshot(queryClient, {
    stateVersion,
    sessions: [...rest, { sessionId, beat, done: false }],
  });
}

/**
 * Apply a `sessions.complete` response: the catalog-paid coins/bond, the
 * refreshed astral card, and this session marked done in the sessions slice —
 * which is what unlocks its island and advances the star-chat ladder.
 */
export function patchSessionComplete(
  queryClient: QueryClient,
  sessionId: string,
  result: SessionComplete,
): void {
  const current = queryClient.getQueryData<Snapshot>(SNAPSHOT_QUERY_KEY);
  if (!current) {
    return;
  }
  const existing = current.sessions.find((s) => s.sessionId === sessionId);
  const rest = current.sessions.filter((s) => s.sessionId !== sessionId);
  patchSnapshot(queryClient, {
    stateVersion: result.stateVersion,
    coins: result.coins,
    bond: result.bond,
    astral: result.astral,
    sessions: [...rest, { sessionId, beat: existing?.beat ?? 0, done: true }],
  });
}
