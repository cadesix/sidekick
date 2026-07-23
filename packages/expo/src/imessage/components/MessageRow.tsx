import * as Haptics from "expo-haptics";
import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	type EntryAnimationsValues,
	type SharedValue,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	interpolate,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { formatClockTime } from "../lib/time";
import type { MessageItem } from "../lib/transcript";
import { bubble, colors, font, type } from "../theme";
import type { Message } from "../types";
import { Icon } from "./Icon";
import { MessageContent, messageSummary } from "./MessageContent";
import { TapbackBadge } from "./TapbackBadge";

export const TIME_REVEAL_WIDTH = 74;

// Swipe-to-reply (iOS 17+): drag a bubble left-to-right, a reply arrow fades
// in on its left, and passing the threshold triggers the reply on release.
const REPLY_TRIGGER = 36;

const replyHaptic = () => {
	Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

export interface BubbleLayout {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface MessageRowProps {
	item: MessageItem;
	revealX: SharedValue<number>;
	onLongPress: (message: Message, layout: BubbleLayout) => void;
	onReply: (message: Message) => void;
	onOpenGame?: (matchId: string) => void;
	hidden?: boolean;
	animateEntry?: boolean;
}

// The just-sent bubble springs up from the input field; incoming bubbles pop
// in from the bottom-left where the typing indicator sat.
const enterSpring = (values: EntryAnimationsValues) => {
	"worklet";
	return {
		initialValues: {
			opacity: 0.01,
			transform: [{ translateY: values.targetHeight + 14 }, { scale: 0.82 }],
		},
		animations: {
			opacity: withTiming(1, { duration: 120 }),
			transform: [
				{ translateY: withSpring(0, { duration: 450, dampingRatio: 0.82 }) },
				{ scale: withSpring(1, { duration: 450, dampingRatio: 0.82 }) },
			],
		},
	};
};

function ReplyQuote({ replyTo }: { replyTo: Message }) {
	const sent = replyTo.role === "me";
	return (
		<View
			style={[
				styles.quoteRow,
				sent ? styles.quoteRowSent : styles.quoteRowReceived,
			]}
		>
			<View style={styles.quoteBubble}>
				<Text numberOfLines={2} style={styles.quoteText}>
					{messageSummary(replyTo)}
				</Text>
			</View>
		</View>
	);
}

export function MessageRow({
	item,
	revealX,
	onLongPress,
	onReply,
	onOpenGame,
	hidden,
	animateEntry,
}: MessageRowProps) {
	const { message } = item;
	const sent = message.role === "me";
	const bubbleRef = useRef<View>(null);

	const replyX = useSharedValue(0);
	const replyArmed = useSharedValue(0);

	const replyPan = Gesture.Pan()
		.activeOffsetX(22)
		.failOffsetX(-12)
		.failOffsetY([-12, 12])
		.onUpdate((event) => {
			const raw = Math.max(0, event.translationX);
			replyX.value = 72 * (raw / (raw + 80));
			if (replyX.value >= REPLY_TRIGGER && replyArmed.value === 0) {
				replyArmed.value = 1;
				runOnJS(replyHaptic)();
			} else if (replyX.value < REPLY_TRIGGER && replyArmed.value === 1) {
				replyArmed.value = 0;
			}
		})
		.onEnd(() => {
			if (replyArmed.value === 1) {
				runOnJS(onReply)(message);
			}
			replyArmed.value = 0;
			replyX.value = withSpring(0, { duration: 420, dampingRatio: 0.85 });
		});

	const slideStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: revealX.value + replyX.value }],
	}));
	const replyArrowStyle = useAnimatedStyle(() => ({
		opacity: interpolate(replyX.value, [8, REPLY_TRIGGER], [0, 1]),
		transform: [
			{ scale: interpolate(replyX.value, [8, REPLY_TRIGGER], [0.4, 1]) },
		],
	}));
	const timeStyle = useAnimatedStyle(() => ({
		opacity: interpolate(revealX.value, [-TIME_REVEAL_WIDTH, 0], [1, 0]),
		transform: [{ translateX: revealX.value }],
	}));

	const handleLongPress = () => {
		bubbleRef.current?.measureInWindow((x, y, width, height) => {
			onLongPress(message, { x, y, width, height });
		});
	};

	const hasReactions = message.reactions.length > 0;

	return (
		<Animated.View
			entering={animateEntry ? enterSpring : undefined}
			style={[
				{ marginTop: item.gapAbove + (hasReactions ? 14 : 0) },
				{ transformOrigin: sent ? "bottom right" : "bottom left" },
			]}
		>
			{item.replyTo ? <ReplyQuote replyTo={item.replyTo} /> : null}
			<GestureDetector gesture={replyPan}>
				<Animated.View
					style={[styles.row, sent ? styles.rowSent : styles.rowReceived, slideStyle]}
				>
				<Pressable
					ref={bubbleRef}
					onLongPress={handleLongPress}
					delayLongPress={350}
					style={[styles.bubbleHolder, hidden ? styles.hiddenBubble : null]}
				>
					<MessageContent message={message} tail={item.tail} onOpenGame={onOpenGame} />
					<Animated.View pointerEvents="none" style={[styles.replyArrow, replyArrowStyle]}>
						<Icon name="reply" size={15} color={colors.gray} filled />
					</Animated.View>
					{message.reactions.map((reaction) => (
						<TapbackBadge
							key={reaction.from}
							reaction={reaction}
							bubbleSide={sent ? "right" : "left"}
						/>
					))}
				</Pressable>
				</Animated.View>
			</GestureDetector>
			<Animated.View pointerEvents="none" style={[styles.timeReveal, timeStyle]}>
				<Text style={styles.timeText}>{formatClockTime(message.createdAt)}</Text>
			</Animated.View>
			{item.statusLabel ? (
				<Text style={styles.status}>{item.statusLabel}</Text>
			) : null}
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	row: {
		flexDirection: "row",
		paddingHorizontal: bubble.edgeMargin + 8,
	},
	rowSent: {
		justifyContent: "flex-end",
	},
	rowReceived: {
		justifyContent: "flex-start",
	},
	bubbleHolder: {
		maxWidth: `${bubble.maxWidthFraction * 100}%`,
	},
	replyArrow: {
		position: "absolute",
		left: -38,
		top: "50%",
		marginTop: -15,
		width: 30,
		height: 30,
		borderRadius: 15,
		backgroundColor: colors.gray5,
		alignItems: "center",
		justifyContent: "center",
	},
	hiddenBubble: {
		opacity: 0,
	},
	timeReveal: {
		position: "absolute",
		right: -TIME_REVEAL_WIDTH,
		top: 0,
		bottom: 0,
		width: TIME_REVEAL_WIDTH,
		justifyContent: "center",
		alignItems: "flex-start",
	},
	timeText: {
		fontSize: 13,
		fontFamily: font.regular,
		color: colors.secondaryLabel,
	},
	status: {
		alignSelf: "flex-end",
		marginTop: 2,
		marginRight: bubble.edgeMargin + 8,
		fontSize: type.delivered.fontSize,
		fontFamily: font.medium,
		color: colors.secondaryLabel,
	},
	quoteRow: {
		flexDirection: "row",
		paddingHorizontal: bubble.edgeMargin + 8,
		marginBottom: -4,
	},
	quoteRowSent: {
		justifyContent: "flex-end",
		paddingRight: 26,
	},
	quoteRowReceived: {
		justifyContent: "flex-start",
		paddingLeft: 26,
	},
	quoteBubble: {
		maxWidth: "60%",
		borderRadius: 14,
		borderCurve: "continuous",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.gray3,
		backgroundColor: colors.gray6,
		paddingHorizontal: 10,
		paddingVertical: 6,
		opacity: 0.9,
	},
	quoteText: {
		fontSize: 15,
		lineHeight: 19,
		fontFamily: font.regular,
		color: colors.secondaryLabel,
	},
});
