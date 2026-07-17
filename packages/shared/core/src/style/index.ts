export type { TraitId, TraitKind, TraitSpec, StyleConfig, StyleState, StyleDecision } from "./types";
export { STYLE_CONFIGS, DEFAULT_STYLE_CONFIG_ID, getStyleConfig } from "./configs";
export { decideStyle, initStyleState, advanceStyleState, renderStyleDirective } from "./decide";
export { splitIntoBubbles, spaceBeforeBang, injectTypo, applyTransforms } from "./transforms";
