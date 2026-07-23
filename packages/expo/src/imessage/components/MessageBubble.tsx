import { BlurView } from "expo-blur";
import { useContext, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { FloatingChat } from "../floating-chat";
import { bubble, colors } from "../theme";
import type { Sender } from "../types";

interface MessageBubbleProps {
	from: Sender;
	tail: boolean;
	children: ReactNode;
	color?: string;
}

// The brand bubble (06 §3.3): cream for the sidekick, usergray for the user,
// 24px corners — except the corner nearest the sender, which flattens to 6px on
// a group's LAST bubble (`tail`, replacing the old iMessage tail hook) so the
// group visibly points at who said it.
export function MessageBubble({ from, tail, children, color }: MessageBubbleProps) {
	const sent = from === "me";
	// floating ("sky") chat: default fills become frosted glass over the scene
	// (an explicit `color` override — game cards etc. — keeps its solid fill)
	const frosted = useContext(FloatingChat) && color === undefined;
	const fill = color ?? (sent ? colors.sentBubble : colors.receivedBubble);
	const corner = tail ? (sent ? styles.tailSent : styles.tailReceived) : null;
	if (frosted) {
		return (
			<View style={styles.wrapper}>
				<View style={[styles.bubble, styles.bubbleFrosted, corner]}>
					<BlurView tint="dark" intensity={26} style={StyleSheet.absoluteFill} />
					<View style={[StyleSheet.absoluteFill, styles.frostTint]} />
					{children}
				</View>
			</View>
		);
	}
	return (
		<View style={styles.wrapper}>
			<View style={[styles.bubble, corner, { backgroundColor: fill }]}>
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
	// frosted: the blur + a faint white lift live in absolute layers UNDER the
	// text; overflow clips them to the bubble corners
	bubbleFrosted: {
		overflow: "hidden",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.22)",
	},
	frostTint: {
		backgroundColor: "rgba(255,255,255,0.12)",
	},
	tailSent: {
		borderBottomRightRadius: bubble.tailRadius,
	},
	tailReceived: {
		borderBottomLeftRadius: bubble.tailRadius,
	},
});
