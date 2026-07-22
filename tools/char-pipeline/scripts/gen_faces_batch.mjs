// Batch-generate the face expressions via the illustrate script, in parallel.
// Each expression is anchored on its closest reference face (from the character
// style sheet) so the EYES match that reference exactly, plus the full sheet for
// context. Output: transparent floating eyes+mouth, 1024².
//
//   OPENAI_API_KEY=... node tools/char-pipeline/scripts/gen_faces_batch.mjs
//
// Writes ~/Desktop/sidekick-faces-v2/<name>.png. 'happy' is kept (approved test).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const HOME = homedir();
const OUT = join(HOME, "Desktop/sidekick-faces-v2");
const REF = join(HOME, "Desktop/sidekick-faces-new/ref-faces");
const ILLUS = join(HOME, ".claude/skills/illustrate/scripts/illustrate.mjs");
const r = (n) => join(REF, `${n}.png`);

const STYLE =
  "Use the reference images as the STRICT style guide for the eyes and mouth. EYES: small, rounded, CLOSE-SET glossy black eyes — small shiny black beans set close together near the center, each with only a tiny subtle highlight; NOT large, NOT tall ovals, NOT wide-set, NO big white glint dots. Match the EXACT eye shape and rendering shown in the reference for this expression. MOUTH: clean edges — red lips, white teeth, dark interior, red tongue; NO cream/beige outline or border. Render ONLY the two eyes and the mouth as floating elements on a fully TRANSPARENT background — no yellow head, no body, no ears, no backdrop. Match the glossy 3D rendering, colors and finish of the reference exactly. Expression: ";

// name -> { refs (anchor first), clause }
const FACES = [
  ["neutral", [r("surprised"), r("happy"), r("_sheet")],
    "NEUTRAL — small calm open black eyes (relaxed, like the reference eyes), and a gentle soft closed smile with little to no teeth. Calm and content."],
  ["blink", [r("laughing"), r("happy"), r("_sheet")],
    "BLINK — both eyes CLOSED, drawn as two simple curved happy arcs exactly like the LAUGHING reference eyes, with a gentle soft closed smile mouth (mostly closed, minimal teeth), NOT an open laughing mouth."],
  ["excited", [r("excited"), r("_sheet")],
    "EXCITED — small open bright eyes and a BIG wide-open mouth showing top teeth and red tongue, exactly like the EXCITED reference (the largest, most open mouth of the set)."],
  ["surprised", [r("surprised"), r("_sheet")],
    "SURPRISED — small open round eyes and a small open round O-shaped mouth showing a bit of dark interior and red tongue, exactly like the SURPRISED reference."],
  ["talkOpen", [r("happy"), r("excited"), r("_sheet")],
    "TALK-OPEN — small open eyes and a moderate open mouth mid-speech showing top teeth and a little red tongue (less open than excited)."],
  ["talkClosed", [r("shy"), r("happy"), r("_sheet")],
    "TALK-CLOSED — small open eyes and a mouth nearly closed mid-speech: a small gentle smile with lips almost shut, little to no teeth."],
  ["angry", [r("angry"), r("_sheet")],
    "ANGRY — angry eyes angled steeply DOWN toward the center with sharp lowered eyebrows, exactly like the ANGRY reference, and an open downturned frowning/gritted mouth showing teeth. Clearly mad."],
  ["annoyed", [r("tired"), r("_sheet")],
    "ANNOYED — half-lidded, droopy, unamused flat-topped eyes with a flat lowered brow exactly like the TIRED reference, and a flat straight or slightly downturned mouth. Unimpressed and irritated."],
];

function gen([name, refs, clause]) {
  const argv = [
    ILLUS,
    "--prompt", STYLE + clause,
    "--out", join(OUT, `${name}.png`),
    ...refs.flatMap((rp) => ["--ref", rp]),
    "--model", "gpt-image-1.5",
    "--input-fidelity", "high",
    "--background", "transparent",
    "--size", "1024x1024",
    "--quality", "high",
    "--format", "png",
  ];
  return run("node", argv, { maxBuffer: 1 << 24 })
    .then(() => ({ name, ok: true }))
    .catch((e) => ({ name, ok: false, err: (e.stderr || e.message || "").slice(-300) }));
}

const LIMIT = 4;
const queue = [...FACES];
const results = [];
async function worker() {
  while (queue.length) {
    const job = queue.shift();
    console.log(`→ start ${job[0]}`);
    const res = await gen(job);
    console.log(res.ok ? `✓ done  ${res.name}` : `✗ FAIL ${res.name}: ${res.err}`);
    results.push(res);
  }
}
await Promise.all(Array.from({ length: LIMIT }, worker));

const ok = results.filter((x) => x.ok).map((x) => x.name);
const bad = results.filter((x) => !x.ok);
console.log(`\ndone: ${ok.length}/${FACES.length} ok -> ${ok.join(", ")}`);
if (bad.length) console.log(`FAILED: ${bad.map((b) => b.name).join(", ")}`);
