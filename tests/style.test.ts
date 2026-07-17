import { describe, expect, test } from "vitest";
import {
  type StyleConfig,
  type StyleDecision,
  advanceStyleState,
  decideStyle,
  getStyleConfig,
  initStyleState,
  injectTypo,
  applyTransforms,
  renderStyleDirective,
  spaceBeforeBang,
  splitIntoBubbles,
} from "@sidekick/core";
import { mulberry32 } from "@sidekick/core";

const V1 = getStyleConfig("v1");

/** Run N turns through the controller, threading state, returning each decision. */
function simulate(config: StyleConfig, turns: number, prefix = "conv"): StyleDecision[] {
  let state = initStyleState();
  const out: StyleDecision[] = [];
  for (let i = 0; i < turns; i++) {
    const decision = decideStyle(config, state, `${prefix}:${i}`);
    out.push(decision);
    state = advanceStyleState(state, decision);
  }
  return out;
}

describe("decideStyle", () => {
  test("is deterministic given the same config, state, seed", () => {
    const a = decideStyle(V1, initStyleState(), "conv:0");
    const b = decideStyle(V1, initStyleState(), "conv:0");
    expect(a).toEqual(b);
  });

  test("never exceeds the per-turn trait budget", () => {
    for (const d of simulate(V1, 300)) {
      expect(d.fired.length).toBeLessThanOrEqual(V1.maxTraitsPerTurn);
    }
  });

  test("respects cooldowns — a trait never fires two eligible turns in a row when cooldown >= 1", () => {
    const decisions = simulate(V1, 300);
    for (const trait of V1.traits.filter((t) => t.cooldown >= 1)) {
      let prevFired = -10;
      decisions.forEach((d, i) => {
        if (d.fired.includes(trait.id)) {
          expect(i - prevFired).toBeGreaterThan(trait.cooldown);
          prevFired = i;
        }
      });
    }
  });

  test("multi-send is frequent (structural, benign); word-quirks stay rare (anti-uncanny)", () => {
    const decisions = simulate(V1, 1000);
    const rate = (id: string) => decisions.filter((d) => (d.fired as string[]).includes(id)).length / 1000;
    // splitting a multi-sentence reply reads as normal texting, so it fires often
    expect(rate("multisend")).toBeGreaterThan(0.6);
    expect(rate("multisend")).toBeLessThan(0.95);
    // the quirks that read uncanny when frequent stay rare
    expect(rate("typo")).toBeLessThan(0.12);
    expect(rate("bangspace")).toBeLessThan(0.2);
    expect(rate("elongation")).toBeLessThan(0.35);
  });

  test("a dependency trait only fires when its prerequisite fired the same turn", () => {
    const withCorrection: StyleConfig = {
      id: "dep-test",
      maxTraitsPerTurn: 3,
      traits: [
        { id: "typo", kind: "transform", baseRate: 1, cooldown: 0 },
        { id: "correction", kind: "transform", baseRate: 1, cooldown: 0, requires: "typo" },
      ],
    };
    const d = decideStyle(withCorrection, initStyleState(), "x:0");
    expect(d.fired).toContain("typo");
    expect(d.fired).toContain("correction");

    const noTypo: StyleConfig = { ...withCorrection, traits: [withCorrection.traits[1]] };
    const d2 = decideStyle(noTypo, initStyleState(), "x:0");
    expect(d2.fired).not.toContain("correction"); // prerequisite absent
  });

  test("directive traits contribute prompt snippets; transform traits are listed for post-processing", () => {
    // a config where both kinds fire for sure
    const cfg: StyleConfig = {
      id: "kinds",
      maxTraitsPerTurn: 3,
      traits: [
        { id: "abbrev", kind: "directive", baseRate: 1, cooldown: 0, directive: "use lmk/rn" },
        { id: "multisend", kind: "transform", baseRate: 1, cooldown: 0 },
      ],
    };
    const d = decideStyle(cfg, initStyleState(), "k:0");
    expect(d.directives).toEqual(["use lmk/rn"]);
    expect(d.transforms).toEqual(["multisend"]);
    expect(renderStyleDirective(d)).toContain("use lmk/rn");
    expect(renderStyleDirective({ fired: [], directives: [], transforms: [] })).toBe("");
  });
});

describe("transforms", () => {
  test("splitIntoBubbles: single thought stays one bubble", () => {
    expect(splitIntoBubbles("i think you're funny, ambitious, and easy to root for")).toEqual([
      "i think you're funny, ambitious, and easy to root for",
    ]);
  });

  test("splitIntoBubbles: two sentences become two bubbles", () => {
    expect(splitIntoBubbles("congrats on the job! what did they say?")).toEqual([
      "congrats on the job!",
      "what did they say?",
    ]);
  });

  test("splitIntoBubbles: overflow past max merges into the last bubble", () => {
    const out = splitIntoBubbles("one. two. three. four.", 3);
    expect(out).toHaveLength(3);
    expect(out[2]).toBe("three. four.");
  });

  test("spaceBeforeBang adds a space before the first !", () => {
    expect(spaceBeforeBang("nice!")).toBe("nice !");
    expect(spaceBeforeBang("no bangs here")).toBe("no bangs here");
  });

  test("injectTypo drops exactly one interior letter and is deterministic", () => {
    const rng = mulberry32(1234);
    const out = injectTypo("consistency is the whole game", rng);
    expect(out).not.toBe("consistency is the whole game");
    expect(out.length).toBe("consistency is the whole game".length - 1);
    // same seed → same typo
    expect(injectTypo("consistency is the whole game", mulberry32(1234))).toBe(out);
  });

  test("applyTransforms pipelines quirks then splits into bubbles", () => {
    const decision: StyleDecision = { fired: ["multisend"], directives: [], transforms: ["multisend"] };
    expect(applyTransforms("yesss congrats! what did they say?", decision, "seed:0")).toEqual([
      "yesss congrats!",
      "what did they say?",
    ]);
    const none: StyleDecision = { fired: [], directives: [], transforms: [] };
    expect(applyTransforms("just one bubble here", none, "seed:0")).toEqual(["just one bubble here"]);
  });
});

describe("golden — v1 config behavior is pinned", () => {
  test("the first 6 turns of v1 produce a stable fired sequence", () => {
    const seq = simulate(V1, 6).map((d) => d.fired.join(",") || "-");
    // Regenerate intentionally if you change v1; a silent shift fails here.
    expect(seq).toMatchInlineSnapshot(`
      [
        "-",
        "abbrev",
        "multisend,elongation",
        "multisend",
        "abbrev,bangspace",
        "multisend",
      ]
    `);
  });
});
