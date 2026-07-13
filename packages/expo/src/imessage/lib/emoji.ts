// Messages renders short emoji-only texts as bare oversized emoji, no bubble.
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*){1,3}$/u;

export const isEmojiOnly = (text: string): boolean =>
	EMOJI_ONLY.test(text.replace(/\s/g, ""));
