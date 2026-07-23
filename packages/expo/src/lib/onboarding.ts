import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

// Onboarding gate + resume state. Ported from the web onboarding's localStorage
// resume (sidekick_onboarding_step_v1): the saved step is honored for a few
// hours so a reload drops the user back where they were; past the TTL they get
// the welcome moment again. `complete` gates the whole flow — a fresh account
// runs it once, then never sees it again (unless DEV → Replay clears it).
//
// v1 is device-local (AsyncStorage). Server-backed completion (so it survives a
// reinstall / follows the account) is a deliberate follow-up.

const STORAGE_KEY = 'sidekick_onboarding_v1';
// A fresh-enough session resumes at its saved step; older ones restart.
const RESUME_TTL_MS = 6 * 60 * 60 * 1000;

export type OnboardingState = {
  complete: boolean;
  // one guided pass over the home screen right after onboarding (entrypoints
  // hidden → bond explained → star prompted); consumed by Home, then cleared
  homeIntro: boolean;
  // the phase the user last reached (for resume); free-form — the screen
  // validates it against its own PHASE_ORDER before honoring it
  phase: string;
  ts: number;
  userName: string;
  sidekickName: string;
  // ISO-ish birthday string ("YYYY-MM-DD") collected in onboarding
  birthday: string;
};

const EMPTY: OnboardingState = {
  complete: false,
  homeIntro: false,
  phase: 'welcome',
  ts: 0,
  userName: '',
  sidekickName: '',
  birthday: '',
};

export const ONBOARDING_QUERY_KEY = ['onboarding', 'state'] as const;

async function readRaw(): Promise<OnboardingState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<OnboardingState>) };
  } catch {
    return EMPTY;
  }
}

async function writeRaw(next: OnboardingState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures — worst case the flow restarts next launch
  }
}

/** Full persisted state, with the resume TTL applied (stale step → welcome). */
export async function loadOnboarding(): Promise<OnboardingState> {
  const state = await readRaw();
  if (!state.complete && Date.now() - state.ts >= RESUME_TTL_MS) {
    return { ...state, phase: 'welcome' };
  }
  return state;
}

/** Persist the current step (resume point) + refresh its timestamp. */
export async function saveStep(phase: string): Promise<void> {
  const state = await readRaw();
  await writeRaw({ ...state, phase, ts: Date.now() });
}

/** Persist a collected profile field (userName / sidekickName) as it's entered. */
export async function saveOnboardingField(
  field: 'userName' | 'sidekickName' | 'birthday',
  value: string,
): Promise<void> {
  const state = await readRaw();
  await writeRaw({ ...state, [field]: value });
}

/** Mark the flow finished so the gate never re-triggers it. */
export async function markOnboardingComplete(): Promise<void> {
  const state = await readRaw();
  await writeRaw({ ...state, complete: true, homeIntro: true, ts: Date.now() });
}

/** Home consumed the guided intro (star tapped) — never replay it. */
export async function markHomeIntroDone(): Promise<void> {
  const state = await readRaw();
  await writeRaw({ ...state, homeIntro: false });
}

/** DEV: land on Home with the guided intro armed — marks complete too (else
 *  Home's front-door gate redirects straight back to /onboarding). */
export async function devArmHomeIntro(): Promise<void> {
  const state = await readRaw();
  await writeRaw({ ...state, complete: true, homeIntro: true, ts: Date.now() });
}

/** DEV: wipe onboarding state so the flow runs again from welcome. */
export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Push a fresh read into the query cache (call after any mutation above). */
export async function refreshOnboarding(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
}

/**
 * Reactive onboarding state for the gate + screen. The query resolves from
 * AsyncStorage, so `isPending` is true for the first tick — callers must wait
 * for it before deciding to redirect (else Home would flash before the gate).
 */
export function useOnboardingState() {
  return useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: loadOnboarding,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Convenience: invalidate the onboarding query from a component. */
export function useRefreshOnboarding(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => refreshOnboarding(queryClient);
}
