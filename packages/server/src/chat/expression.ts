import { z } from "zod";

// The face expressions the sidekick can pulse when a line pops over his head
// (the overhead speech bubble). These names MUST match the client's
// FaceExpression cells in packages/expo/src/three/face.ts — the client casts the
// string straight onto the face sprite sheet. The internal-only cells (blink,
// talkOpen/Closed) are intentionally excluded; only emotive ones belong here.
export const OVERHEAD_EXPRESSIONS = [
  "neutral",
  "happy",
  "excited",
  "surprised",
  "annoyed",
  "angry",
  "sad",
] as const;

export type OverheadExpression = (typeof OVERHEAD_EXPRESSIONS)[number];

/** Emitted alongside an LLM-generated overhead line so the face matches its tone. */
export const overheadExpressionSchema = z
  .enum(OVERHEAD_EXPRESSIONS)
  .describe("the face expression that best matches the emotion of the line");
