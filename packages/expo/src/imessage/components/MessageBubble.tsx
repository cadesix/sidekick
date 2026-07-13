import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { bubble, colors } from "../theme";
import type { Sender } from "../types";

interface MessageBubbleProps {
	from: Sender;
	tail: boolean;
	children: ReactNode;
	color?: string;
	backgroundBehind?: string;
}

// The classic iMessage bubble. The tail is drawn with two overlapping views:
// a bubble-colored hook that overhangs the outer edge, and a background-colored
// cutout that carves its outer curve (samuelkraft technique).
export function MessageBubble({
	from,
	tail,
	children,
	color,
	backgroundBehind,
}: MessageBubbleProps) {
	const sent = from === "me";
	const fill = color ?? (sent ? colors.sentBubble : colors.receivedBubble);
	const behind = backgroundBehind ?? colors.background;
	return (
		<View style={styles.wrapper}>
			{tail ? (
				<View pointerEvents="none" style={styles.tailContainer}>
					<View
						style={[
							styles.tail,
							sent ? styles.tailSent : styles.tailReceived,
							{ backgroundColor: fill },
						]}
					/>
					<View
						style={[
							styles.tailCutout,
							sent ? styles.tailCutoutSent : styles.tailCutoutReceived,
							{ backgroundColor: behind },
						]}
					/>
				</View>
			) : null}
			<View style={[styles.bubble, { backgroundColor: fill }]}>{children}</View>
		</View>
	);
}

const styles = StyleSheet.create({
	wrapper: {
		maxWidth: "100%",
	},
	bubble: {
		borderRadius: bubble.radius,
		borderCurve: "continuous",
		paddingHorizontal: bubble.paddingHorizontal,
		paddingVertical: bubble.paddingVertical,
	},
	tailContainer: {
		...StyleSheet.absoluteFillObject,
	},
	tail: {
		position: "absolute",
		bottom: 0,
		width: 20,
		height: 20,
	},
	tailSent: {
		right: -7,
		borderBottomLeftRadius: 15,
	},
	tailReceived: {
		left: -7,
		borderBottomRightRadius: 15,
	},
	tailCutout: {
		position: "absolute",
		bottom: 0,
		width: 26,
		height: 20,
	},
	tailCutoutSent: {
		right: -26,
		borderBottomLeftRadius: 10,
	},
	tailCutoutReceived: {
		left: -26,
		borderBottomRightRadius: 10,
	},
});
