import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import { useEffect, useRef, useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
	Easing,
	interpolate,
	runOnJS,
	useAnimatedProps,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { isEmojiOnly } from "../lib/emoji";
import { colors } from "../theme";
import type { Message, ReactionType } from "../types";
import { AudioBubble } from "./AudioBubble";
import type { BubbleLayout } from "./MessageRow";
import { MessageBubble } from "./MessageBubble";
import { TAPBACK_ORDER, TapbackBadge, TapbackGlyph } from "./TapbackBadge";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const PILL_HEIGHT = 48;
const MENU_WIDTH = 254;
const MENU_ROW_HEIGHT = 44;
const MENU_GROUP_GAP = 8;
const GAP = 10;

const QUICK_EMOJI = [
	"😂",
	"🥹",
	"😍",
	"🙏",
	"🔥",
	"😭",
	"💀",
	"🎉",
	"💯",
	"👏",
	"😮",
	"😡",
	"🥰",
	"😅",
	"👀",
	"✨",
	"🤝",
	"🫶",
];

interface MenuAction {
	key: string;
	label: string;
	symbol: SFSymbol;
}

// NativeWind's css-interop drops FUNCTION-form Pressable styles, so the pressed
// tint is tracked in state rather than via `({ pressed }) => ...`.
function MenuRow({
	action,
	divided,
	onPress,
}: {
	action: MenuAction;
	divided: boolean;
	onPress: () => void;
}) {
	const [pressed, setPressed] = useState(false);
	return (
		<Pressable
			onPress={onPress}
			onPressIn={() => setPressed(true)}
			onPressOut={() => setPressed(false)}
			style={[
				styles.menuRow,
				divided ? styles.menuRowBorder : null,
				pressed ? styles.menuRowPressed : null,
			]}
		>
			<SymbolView name={action.symbol} size={19} tintColor={colors.label} />
			<Text style={styles.menuLabel}>{action.label}</Text>
		</Pressable>
	);
}

interface TapbackOverlayProps {
	message: Message;
	layout: BubbleLayout;
	onSelectReaction: (type: ReactionType) => void;
	onAction: (key: string) => void;
	onDismiss: () => void;
}

export function TapbackOverlay({
	message,
	layout,
	onSelectReaction,
	onAction,
	onDismiss,
}: TapbackOverlayProps) {
	const insets = useSafeAreaInsets();
	const screen = Dimensions.get("window");
	const sent = message.role === "me";
	const [emojiRow, setEmojiRow] = useState(false);

	// iOS 26 menu grouping: Reply | Undo Send | Copy, Select, Translate, More.
	const groups: MenuAction[][] = [
		[{ key: "reply", label: "Reply", symbol: "arrowshape.turn.up.left" }],
		...(sent
			? [[{ key: "undoSend", label: "Undo Send", symbol: "arrow.uturn.backward" as SFSymbol }]]
			: []),
		[
			{ key: "copy", label: "Copy", symbol: "doc.on.doc" },
			{ key: "select", label: "Select", symbol: "selection.pin.in.out" },
			{ key: "translate", label: "Translate", symbol: "translate" },
			{ key: "more", label: "More…", symbol: "ellipsis.circle" },
		],
	];

	const menuHeight =
		groups.reduce((sum, group) => sum + group.length * MENU_ROW_HEIGHT, 0) +
		(groups.length - 1) * MENU_GROUP_GAP;
	const minTop = insets.top + 56;
	const maxBottom = screen.height - insets.bottom - 16;
	let bubbleTop = layout.y;
	if (bubbleTop - PILL_HEIGHT - GAP < minTop) {
		bubbleTop = minTop + PILL_HEIGHT + GAP;
	}
	if (bubbleTop + layout.height + GAP + menuHeight > maxBottom) {
		bubbleTop = maxBottom - menuHeight - GAP - layout.height;
	}

	// One progress value drives the whole thing so the bubble lift, the frosted
	// backdrop, and both glass popovers move as a single coherent motion.
	const progress = useSharedValue(0);
	const closingRef = useRef(false);
	useEffect(() => {
		progress.value = withSpring(1, { duration: 420, dampingRatio: 0.82 });
	}, [progress]);

	const close = (after?: () => void) => {
		if (closingRef.current) {
			return;
		}
		closingRef.current = true;
		if (after) {
			after();
		}
		progress.value = withTiming(
			0,
			{ duration: 190, easing: Easing.in(Easing.cubic) },
			(finished) => {
				if (finished) {
					runOnJS(onDismiss)();
				}
			},
		);
	};

	const bubbleStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateY: progress.value * (bubbleTop - layout.y) },
			{ scale: 1 + progress.value * 0.03 },
		],
	}));
	const popoverStyle = useAnimatedStyle(() => ({
		opacity: progress.value,
		transform: [{ scale: interpolate(progress.value, [0, 1], [0.86, 1]) }],
	}));
	const scrimBlurProps = useAnimatedProps(() => ({ intensity: progress.value * 20 }));
	const scrimDimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

	const mine = message.reactions.find((reaction) => reaction.from === "me");
	const emojiOnly = message.kind === "text" && isEmojiOnly(message.text);
	const sideAlign = sent
		? { right: screen.width - layout.x - layout.width }
		: { left: layout.x };

	const selectReaction = (type: ReactionType) => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		close(() => onSelectReaction(type));
	};

	return (
		<View style={StyleSheet.absoluteFill}>
			<AnimatedBlurView
				tint="light"
				pointerEvents="none"
				animatedProps={scrimBlurProps}
				style={StyleSheet.absoluteFill}
			/>
			<Animated.View
				pointerEvents="none"
				style={[StyleSheet.absoluteFill, styles.scrimDim, scrimDimStyle]}
			/>
			<Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />

			<Animated.View
				pointerEvents="none"
				style={[
					styles.bubbleClone,
					{ top: layout.y, width: layout.width },
					sideAlign,
					bubbleStyle,
				]}
			>
				{emojiOnly ? (
					<Text style={styles.bigEmoji}>{message.text}</Text>
				) : message.kind === "audio" && message.audio ? (
					<MessageBubble from={message.role} tail>
						<AudioBubble audio={message.audio} sent={sent} />
					</MessageBubble>
				) : (
					<MessageBubble from={message.role} tail>
						<Text style={[styles.text, { color: sent ? colors.sentText : colors.receivedText }]}>
							{message.text}
						</Text>
					</MessageBubble>
				)}
				{message.reactions.map((reaction) => (
					<TapbackBadge
						key={reaction.from}
						reaction={reaction}
						bubbleSide={sent ? "right" : "left"}
					/>
				))}
			</Animated.View>

			<Animated.View
				style={[
					styles.pill,
					{ top: bubbleTop - PILL_HEIGHT - GAP },
					emojiRow ? { maxWidth: screen.width - 24 } : null,
					sent
						? { right: screen.width - layout.x - layout.width - 4, transformOrigin: "bottom right" }
						: { left: Math.max(8, layout.x - 4), transformOrigin: "bottom left" },
					popoverStyle,
				]}
			>
				<GlassView glassEffectStyle="regular" style={styles.pillInner}>
					{emojiRow ? (
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={styles.emojiRow}
						>
							{QUICK_EMOJI.map((emoji) => {
								const type: ReactionType = `emoji:${emoji}`;
								return (
									<Pressable
										key={emoji}
										hitSlop={4}
										onPress={() => selectReaction(type)}
										style={[
											styles.pillItem,
											mine?.type === type ? styles.pillItemSelected : null,
										]}
									>
										<Text allowFontScaling={false} style={styles.emojiGlyph}>
											{emoji}
										</Text>
									</Pressable>
								);
							})}
						</ScrollView>
					) : (
						<>
							{TAPBACK_ORDER.map((tapback) => (
								<Pressable
									key={tapback}
									hitSlop={4}
									onPress={() => selectReaction(tapback)}
									style={[
										styles.pillItem,
										mine?.type === tapback ? styles.pillItemSelected : null,
									]}
								>
									<TapbackGlyph type={tapback} size={26} />
								</Pressable>
							))}
							<Pressable
								hitSlop={4}
								onPress={() => {
									Haptics.selectionAsync();
									setEmojiRow(true);
								}}
								style={[
									styles.pillItem,
									mine?.type.startsWith("emoji:") ? styles.pillItemSelected : null,
								]}
							>
								{mine?.type.startsWith("emoji:") ? (
									<TapbackGlyph type={mine.type} size={26} />
								) : (
									<SymbolView name="face.smiling" size={24} tintColor={colors.gray} />
								)}
							</Pressable>
						</>
					)}
				</GlassView>
			</Animated.View>

			<Animated.View
				style={[
					styles.menu,
					{ top: bubbleTop + layout.height + GAP },
					sent
						? { right: screen.width - layout.x - layout.width, transformOrigin: "top right" }
						: { left: layout.x, transformOrigin: "top left" },
					popoverStyle,
				]}
			>
				{groups.map((group, groupIndex) => (
					<GlassView
						key={group[0]?.key}
						glassEffectStyle="regular"
						style={[styles.menuGroup, groupIndex > 0 ? { marginTop: MENU_GROUP_GAP } : null]}
					>
						{group.map((action, index) => (
							<MenuRow
								key={action.key}
								action={action}
								divided={index > 0}
								onPress={() => close(() => onAction(action.key))}
							/>
						))}
					</GlassView>
				))}
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({
	scrimDim: {
		backgroundColor: "rgba(0,0,0,0.12)",
	},
	bubbleClone: {
		position: "absolute",
	},
	text: {
		fontSize: 17,
		lineHeight: 22,
	},
	bigEmoji: {
		fontSize: 46,
		lineHeight: 54,
	},
	pill: {
		position: "absolute",
		height: PILL_HEIGHT,
		borderRadius: PILL_HEIGHT / 2,
		shadowColor: "#000000",
		shadowOpacity: 0.1,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: 4 },
	},
	pillInner: {
		flexDirection: "row",
		alignItems: "center",
		height: "100%",
		borderRadius: PILL_HEIGHT / 2,
		paddingHorizontal: 6,
		gap: 1,
	},
	emojiRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 1,
	},
	pillItem: {
		width: 40,
		height: 40,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
	},
	pillItemSelected: {
		backgroundColor: "rgba(120,120,128,0.24)",
	},
	emojiGlyph: {
		fontSize: 26,
	},
	menu: {
		position: "absolute",
		width: MENU_WIDTH,
	},
	menuGroup: {
		borderRadius: 16,
		borderCurve: "continuous",
		shadowColor: "#000000",
		shadowOpacity: 0.1,
		shadowRadius: 20,
		shadowOffset: { width: 0, height: 6 },
	},
	menuRow: {
		height: MENU_ROW_HEIGHT,
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 14,
	},
	menuRowBorder: {
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: "rgba(60,60,67,0.2)",
	},
	menuRowPressed: {
		backgroundColor: "rgba(120,120,128,0.12)",
	},
	menuLabel: {
		fontSize: 17,
		color: colors.label,
	},
});
