import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { bubble, colors } from "../theme";
import type { Sender } from "../types";

interface MessageBubbleProps {
	from: Sender;
	tail: boolean;
	children: ReactNode;
	color?: string;
}

// The chat bubble: iOS blue for the user, gray for the sidekick, 24px corners —
// except the corner nearest the sender, which flattens to 6px on a group's LAST
// bubble (`tail`) so the group visibly points at who said it.
export function MessageBubble({ from, tail, children, color }: MessageBubbleProps) {
	const sent = from === "me";
	const fill = color ?? (sent ? colors.sentBubble : colors.receivedBubble);
	return (
		<View style={styles.wrapper}>
			<View
				style={[
					styles.bubble,
					tail ? (sent ? styles.tailSent : styles.tailReceived) : null,
					{ backgroundColor: fill },
				]}
			>
				{children}
			</View>
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
	tailSent: {
		borderBottomRightRadius: bubble.tailRadius,
	},
	tailReceived: {
		borderBottomLeftRadius: bubble.tailRadius,
	},
});
