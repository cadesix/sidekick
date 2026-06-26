import type { StepIllustration } from "./types";

/**
 * Hand-engraved style illustrations generated to match the funnel's antique feel.
 * Served unoptimized (already sized + compressed) so Next's optimizer doesn't
 * re-encode and soften the fine line work.
 */
export const ILLUSTRATIONS = {
	gavel: {
		src: "/funnel/gavel.webp",
		alt: "Engraving of an auctioneer's gavel",
		width: 426,
		height: 640,
	},
	twinVases: {
		src: "/funnel/twin-vases.webp",
		alt: "Engraving of two nearly identical antique vases",
		width: 426,
		height: 640,
	},
	hourglass: {
		src: "/funnel/hourglass.webp",
		alt: "Engraving of an antique hourglass",
		width: 415,
		height: 640,
	},
	magnifier: {
		src: "/funnel/magnifier.webp",
		alt: "Engraving of an antique magnifying glass",
		width: 426,
		height: 640,
	},
	chest: {
		src: "/funnel/chest.webp",
		alt: "Engraving of an open treasure chest",
		width: 468,
		height: 640,
	},
	blueVase: {
		src: "/funnel/bluevase.webp",
		alt: "Watercolor illustration of an ornate blue porcelain vase",
		width: 438,
		height: 640,
	},
} satisfies Record<string, StepIllustration>;
