import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import type { Reaction, ReactionType } from "../types";
import { Icon, type IconName } from "./Icon";

export const TAPBACK_ORDER: ReactionType[] = [
	"heart",
	"thumbsUp",
	"thumbsDown",
	"haha",
	"exclamation",
	"question",
];

// Tinted glyphs stand in for Apple's emoji-style tapback art (the iOS 26
// simulator renders raw emoji as tofu boxes — facebook/react-native#56183).
const GLYPH_ART: Partial<Record<ReactionType, { name: IconName; color: string }>> = {
	heart: { name: "heart", color: "#FF4D8D" },
	thumbsUp: { name: "thumbsUp", color: "#FFC83D" },
	thumbsDown: { name: "thumbsDown", color: "#FFAA33" },
};

// Since iOS 18 the tapback glyphs are always colorful, in the pill and in the
// badge: pink heart, yellow thumbs, red "!!", blue stacked "HA HA" and "?".
export function TapbackGlyph({ type, size }: { type: ReactionType; size: number }) {
	if (type.startsWith("emoji:")) {
		return (
			<Text allowFontScaling={false} style={{ fontSize: size }}>
				{type.slice("emoji:".length)}
			</Text>
		);
	}
	const art = GLYPH_ART[type];
	if (art) {
		return <Icon name={art.name} size={size * 0.82} color={art.color} filled />;
	}
	if (type === "exclamation") {
		return (
			<Text
				allowFontScaling={false}
				style={[styles.textGlyph, { color: "#FF3B30", fontSize: size * 0.85 }]}
			>
				!!
			</Text>
		);
	}
	if (type === "haha") {
		return (
			<Text
				allowFontScaling={false}
				style={[styles.textGlyph, { fontSize: size * 0.42, lineHeight: size * 0.5 }]}
			>
				HA{"\n"}HA
			</Text>
		);
	}
	return (
		<Text allowFontScaling={false} style={[styles.textGlyph, { fontSize: size * 0.95 }]}>
			?
		</Text>
	);
}

interface TapbackBadgeProps {
	reaction: Reaction;
	// Which side of the screen the reacted-to bubble sits on.
	bubbleSide: "left" | "right";
}

// The small reaction bubble overlapping the message's top corner, with the
// two shrinking tail dots pointing into the bubble.
export function TapbackBadge({ reaction, bubbleSide }: TapbackBadgeProps) {
	const mine = reaction.from === "me";
	const fill = mine ? colors.blue : colors.receivedBubble;
	// The badge hugs the corner nearest the reactor: my reactions sit on the
	// side my bubbles live on (right), theirs on the left.
	const onRightCorner = bubbleSide === "left";
	return (
		<View
			pointerEvents="none"
			style={[
				styles.container,
				onRightCorner ? styles.containerRight : styles.containerLeft,
			]}
		>
			<View style={[styles.badge, { backgroundColor: fill }]}>
				<TapbackGlyph type={reaction.type} size={16} />
			</View>
			<View
				style={[
					styles.dotLarge,
					{ backgroundColor: fill },
					onRightCorner ? styles.dotLargeRight : styles.dotLargeLeft,
				]}
			/>
			<View
				style={[
					styles.dotSmall,
					{ backgroundColor: fill },
					onRightCorner ? styles.dotSmallRight : styles.dotSmallLeft,
				]}
			/>
		</View>
	);
}

const BADGE = 30;

// How far the badge pokes above the bubble's top edge (its container sits at
// top: -BADGE + 10) — anything placed above the bubble must clear this too.
export const TAPBACK_BADGE_OVERHANG = BADGE - 10;

const styles = StyleSheet.create({
	textGlyph: {
		color: "#3FA2F7",
		fontWeight: "800",
		fontStyle: "italic",
		textAlign: "center",
	},
	container: {
		position: "absolute",
		top: -BADGE + 10,
		width: BADGE,
		height: BADGE,
	},
	containerRight: {
		right: -6,
	},
	containerLeft: {
		left: -6,
	},
	badge: {
		width: BADGE,
		height: BADGE,
		borderRadius: BADGE / 2,
		alignItems: "center",
		justifyContent: "center",
	},
	dotLarge: {
		position: "absolute",
		width: 7,
		height: 7,
		borderRadius: 3.5,
		bottom: -2,
	},
	dotLargeRight: {
		left: 1,
	},
	dotLargeLeft: {
		right: 1,
	},
	dotSmall: {
		position: "absolute",
		width: 3.5,
		height: 3.5,
		borderRadius: 1.75,
		bottom: -6,
	},
	dotSmallRight: {
		left: -1,
	},
	dotSmallLeft: {
		right: -1,
	},
});
