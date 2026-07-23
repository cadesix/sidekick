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

// Throws on failure (unlike readRaw's soft fallback) — the completion path relies
// on that to surface a lost write instead of silently sending the user to Home
// with unpersisted `complete`.
async function writeRaw(next: OnboardingState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

// Serialized mutation queue. Every persisted change is a read-modify-write, and
// they're fired concurrently (a data-collection step saves its field AND the
// next phase in the same tick, both un-awaited). Run un-serialized they'd
// interleave and the later write would clobber the earlier's field (lost
// update) — dropping a collected field, regressing the phase, or worst, a stale
// step write landing after `finish()` and resetting `complete` to false (which
// bounces the user back into onboarding on the next cold start). Chaining every
// mutation onto one promise makes each read see the previous write's result, so
// none can clobber another. The chain never rejects (a failed write can't wedge
// later ones); callers that care about durability get the failure via the
// returned promise.
let mutationQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(task, task); // run regardless of the prior outcome
  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Serialized read-modify-write. Failures propagate to the returned promise. */
function mutate(fn: (state: OnboardingState) => OnboardingState): Promise<void> {
  return enqueue(async () => {
    await writeRaw(fn(await readRaw()));
  });
}

/** Full persisted state, with the resume TTL applied (stale step → welcome). */
export async function loadOnboarding(): Promise<OnboardingState> {
  const state = await readRaw();
  if (!state.complete && Date.now() - state.ts >= RESUME_TTL_MS) {
    return { ...state, phase: 'welcome' };
  }
  return state;
}

/** The profile fields collected during the flow. */
export type CollectedFields = Partial<Pick<OnboardingState, 'userName' | 'sidekickName' | 'birthday'>>;

/** Persist the current step (resume point) + refresh its timestamp, optionally
 *  folding in the field(s) just collected on that step — the field and the phase
 *  advance land in ONE atomic write so they can never diverge (a persisted phase
 *  past a field screen with the field itself missing, which resume would then
 *  skip). Best-effort: a lost step/field only costs a restart-from-earlier, so
 *  failures are swallowed. No-op once complete — the flow is done, there's
 *  nothing to resume, and writing here could only regress `complete`. */
export function saveStep(phase: string, fields?: CollectedFields): Promise<void> {
  return mutate((s) => (s.complete ? s : { ...s, ...fields, phase, ts: Date.now() })).catch(() => {});
}

/** Mark the flow finished so the gate never re-triggers it. Failures PROPAGATE
 *  (and the write is read-back verified) so `finish()` can retry instead of
 *  sending the user to Home with `complete` unpersisted — which a cold start
 *  would read as not-onboarded and bounce straight back into the flow. */
export async function markOnboardingComplete(): Promise<void> {
  await mutate((s) => ({ ...s, complete: true, homeIntro: true, ts: Date.now() }));
  const check = await readRaw();
  if (!check.complete) throw new Error('onboarding completion did not persist');
}

/** Home consumed the guided intro (star tapped) — never replay it. Failures
 *  propagate so the caller can keep the in-session cache authoritative. */
export function markHomeIntroDone(): Promise<void> {
  return mutate((s) => ({ ...s, homeIntro: false }));
}

/** DEV: land on Home with the guided intro armed — marks complete too (else
 *  Home's front-door gate redirects straight back to /onboarding). */
export function devArmHomeIntro(): Promise<void> {
  return mutate((s) => ({ ...s, complete: true, homeIntro: true, ts: Date.now() })).catch(() => {});
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
