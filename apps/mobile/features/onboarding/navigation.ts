import { STEPS } from "./manifest";
import type { StepConfig } from "./types";

/**
 * Pure step navigation for the funnel — one route, internal index (02 §port
 * strategy). Kept free of RN so it is unit-tested from the root vitest suite.
 */

export const STEP_COUNT = STEPS.length;

export function stepAt(index: number): StepConfig {
  const clamped = Math.min(Math.max(index, 0), STEPS.length - 1);
  const step = STEPS[clamped];
  if (!step) {
    throw new Error("onboarding manifest is empty");
  }
  return step;
}

export function nextIndex(current: number): number {
  return Math.min(current + 1, STEPS.length - 1);
}

export function prevIndex(current: number): number {
  return Math.max(current - 1, 0);
}

export function isFinalStep(index: number): boolean {
  return index >= STEPS.length - 1;
}

/** Back is available on every step except the first (welcome). */
export function canGoBack(index: number): boolean {
  return index > 0;
}

const SEGMENTS = 3;

/**
 * Fractional fill per progress segment (06 §3.6 / web progress-bar). Three
 * segments; the first is seeded to 15% so step 0 never reads as "no progress".
 */
export function progressSegments(current: number): number[] {
  const perSegment = STEPS.length / SEGMENTS;
  return Array.from({ length: SEGMENTS }, (_, i) => {
    const segStart = i * perSegment;
    const raw = Math.min(1, Math.max(0, (current - segStart) / perSegment));
    const fill = i === 0 ? Math.max(0.15, raw) : raw;
    return Math.round(fill * 100);
  });
}
