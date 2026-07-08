import { describe, expect, it } from "vitest";
import { getGoalDefinition } from "@sidekick/shared";
import { STEPS } from "../apps/mobile/features/onboarding/manifest";
import {
  STEP_COUNT,
  canGoBack,
  isFinalStep,
  nextIndex,
  prevIndex,
  progressSegments,
  stepAt,
} from "../apps/mobile/features/onboarding/navigation";
import { computePersonality } from "../apps/mobile/features/onboarding/personality";
import { assembleGoalChoices, buildGoalBeats } from "../apps/mobile/features/onboarding/plan";

const STEP_TYPES = new Set(STEPS.map((s) => s.type));

describe("funnel manifest integrity", () => {
  it("has unique, ordered step ids and starts on welcome, ends on onboarding-chat", () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(STEPS[0]?.type).toBe("welcome");
    expect(STEPS[STEPS.length - 1]?.type).toBe("onboarding-chat");
  });

  it("keeps the demographics + interests order (name → age → gender → interests → result)", () => {
    const order = STEPS.map((s) => s.id);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("name")).toBeLessThan(idx("age"));
    expect(idx("age")).toBeLessThan(idx("gender"));
    expect(idx("gender")).toBeLessThan(idx("interests"));
    expect(idx("interests")).toBeLessThan(idx("result"));
  });

  it("has 20 personality items, 4 per trait, each balanced with a reverse-keyed item", () => {
    const items = STEPS.flatMap((s) => (s.type === "personality" ? [s.question] : []));
    expect(items).toHaveLength(20);
    for (const trait of ["O", "C", "E", "A", "N"] as const) {
      const forTrait = items.filter((i) => i.trait === trait);
      expect(forTrait).toHaveLength(4);
      expect(forTrait.some((i) => i.reverse)).toBe(true);
    }
  });

  it("only lists goal slugs that exist in the shared catalog", () => {
    const goalsStep = STEPS.find((s) => s.type === "goals");
    if (!goalsStep || goalsStep.type !== "goals") {
      throw new Error("goals step missing");
    }
    for (const slug of goalsStep.question.options) {
      expect(getGoalDefinition(slug)).toBeDefined();
    }
  });

  it("covers every step type in the union", () => {
    const declared: (typeof STEPS)[number]["type"][] = [
      "welcome", "name", "choice", "goals", "interests", "transition", "quiz-intro",
      "statement", "personality", "fact", "result", "reveal", "meet", "choose-color",
      "name-sidekick", "onboarding-chat",
    ];
    for (const type of declared) {
      expect(STEP_TYPES.has(type)).toBe(true);
    }
  });
});

describe("funnel navigation", () => {
  it("advances and retreats within bounds", () => {
    expect(nextIndex(0)).toBe(1);
    expect(prevIndex(0)).toBe(0);
    expect(nextIndex(STEP_COUNT - 1)).toBe(STEP_COUNT - 1);
    expect(isFinalStep(STEP_COUNT - 1)).toBe(true);
    expect(isFinalStep(0)).toBe(false);
    expect(canGoBack(0)).toBe(false);
    expect(canGoBack(1)).toBe(true);
  });

  it("clamps stepAt to the manifest bounds", () => {
    expect(stepAt(-5).id).toBe("welcome");
    expect(stepAt(9999).type).toBe("onboarding-chat");
  });

  it("seeds the first progress segment and fills left-to-right", () => {
    const atStart = progressSegments(0);
    expect(atStart[0]).toBe(15);
    const atEnd = progressSegments(STEP_COUNT);
    expect(atEnd).toEqual([100, 100, 100]);
  });
});

describe("personality scoring", () => {
  it("maps a high-agreement extravert/open profile to a positive archetype", () => {
    const answers: Record<string, string> = {};
    for (const step of STEPS) {
      if (step.type === "personality") {
        answers[step.question.id] = step.question.reverse ? "1" : "5";
      }
    }
    const p = computePersonality(answers);
    expect(p.name).toBeTruthy();
    expect(p.percents.E).toBeGreaterThan(50);
    expect(p.percents.O).toBeGreaterThan(50);
  });

  it("defaults unanswered items to neutral without throwing", () => {
    const p = computePersonality({});
    expect(p.percents.O).toBe(50);
  });
});

describe("onboarding-chat plan", () => {
  it("builds a how + cadence beat for count goals, one beat for criteria goals", () => {
    const beats = buildGoalBeats(["get-fit", "sleep-better"]);
    const ids = beats.map((b) => b.id);
    expect(ids).toContain("get-fit-how");
    expect(ids).toContain("get-fit-cadence");
    expect(ids).toContain("sleep-better-how");
    expect(ids).not.toContain("sleep-better-cadence");
  });

  it("assembles selected patches into valid onboarding.complete goal inputs", () => {
    const beats = buildGoalBeats(["get-fit", "sleep-better"]);
    const patches = beats.map((b) => {
      const first = b.options[0];
      if (!first) {
        throw new Error("goal beat has no options");
      }
      return first.patch;
    });
    const choices = assembleGoalChoices(["get-fit", "sleep-better"], patches);

    const getFit = choices.find((c) => c.slug === "get-fit");
    expect(getFit?.actionSlug).toBe("gym");
    expect(getFit?.cadence).toEqual({ type: "weekly", target: 2 });

    const sleep = choices.find((c) => c.slug === "sleep-better");
    expect(sleep?.actionSlug).toBe("sleep-by");
    expect(sleep?.cadence).toEqual({ type: "daily-criteria", criteria: "asleep-by", value: "22:00" });
  });

  it("references only real catalog action slugs", () => {
    const beats = buildGoalBeats(["get-fit", "sleep-better", "manage-stress"]);
    for (const beat of beats) {
      for (const opt of beat.options) {
        if (opt.patch.actionSlug) {
          const def = getGoalDefinition(opt.patch.goalSlug);
          expect(def?.actionItems.some((a) => a.slug === opt.patch.actionSlug)).toBe(true);
        }
      }
    }
  });
});
