import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { colors } from "../theme";
import { Glass } from "./Glass";
import type { Message, ReactionType } from "../types";
import { Icon, type IconName } from "./Icon";
import { MessageContent } from "./MessageContent";
import type { BubbleLayout } from "./MessageRow";
import { TAPBACK_BADGE_OVERHANG, TAPBACK_ORDER, TapbackBadge, TapbackGlyph } from "./TapbackBadge";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

// The bubble clone floats over the scrim (blurred background + 12% black dim),
// so its tail cutout must carve with the dimmed background color — the raw
// background would show as a bright square just above the tail.
const SCRIM_BEHIND = "#E0E0E0";

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
	icon: IconName;
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
			<Icon name={action.icon} size={19} color={colors.label} />
			<Text style={styles.menuLabel}>{action.label}</Text>
		</Pressable>
	);
}

interface TapbackOverlayProps {
	message: Message;
	layout: BubbleLayout;
	// Size of the view the overlay fills — the chat drawer, NOT the window.
	// Bubble layouts arrive in these same drawer-relative coordinates.
	container: { width: number; height: number };
	onSelectReaction: (type: ReactionType) => void;
	onAction: (key: string) => void;
	onDismiss: () => void;
}

export function TapbackOverlay({
	message,
	layout,
	container,
	onSelectReaction,
	onAction,
	onDismiss,
}: TapbackOverlayProps) {
	const insets = useSafeAreaInsets();
	const sent = message.role === "me";
	const [emojiRow, setEmojiRow] = useState(false);

	// iOS 26 menu grouping: Reply | Undo Send | Copy, Select, Translate, More.
	const groups: MenuAction[][] = [
		[{ key: "reply", label: "Reply", icon: "reply" }],
		...(sent
			? [[{ key: "undoSend", label: "Undo Send", icon: "undo" as IconName }]]
			: []),
		[
			{ key: "copy", label: "Copy", icon: "copy" },
			{ key: "select", label: "Select", icon: "select" },
			{ key: "translate", label: "Translate", icon: "translate" },
			{ key: "more", label: "More…", icon: "more" },
		],
	];

	const menuHeight =
		groups.reduce((sum, group) => sum + group.length * MENU_ROW_HEIGHT, 0) +
		(groups.length - 1) * MENU_GROUP_GAP;
	// Reaction badges poke above the bubble clone, so the pill backs off far
	// enough not to sit on top of them.
	const pillGap = GAP + (message.reactions.length > 0 ? TAPBACK_BADGE_OVERHANG : 0);
	// The drawer already starts below the status bar; its bottom edge is the
	// screen bottom, so only the home-indicator inset applies.
	const minTop = 12;
	const maxBottom = container.height - insets.bottom - 16;
	let bubbleTop = layout.y;
	if (bubbleTop - PILL_HEIGHT - pillGap < minTop) {
		bubbleTop = minTop + PILL_HEIGHT + pillGap;
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
	// No opacity: animating a parent's opacity permanently kills descendant
	// UIGlassEffect views (expo/expo#41024), so the popovers scale in at full alpha.
	const popoverStyle = useAnimatedStyle(() => ({
		transform: [{ scale: interpolate(progress.value, [0, 1], [0.86, 1]) }],
	}));
	const scrimBlurProps = useAnimatedProps(() => ({ intensity: progress.value * 20 }));
	const scrimDimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

	const mine = message.reactions.find((reaction) => reaction.from === "me");
	const sideAlign = sent
		? { right: container.width - layout.x - layout.width }
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
				<MessageContent message={message} tail backgroundBehind={SCRIM_BEHIND} />
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
					{ top: bubbleTop - PILL_HEIGHT - pillGap },
					emojiRow ? { maxWidth: container.width - 24 } : null,
					sent
						? { right: container.width - layout.x - layout.width - 4, transformOrigin: "bottom right" }
						: { left: Math.max(8, layout.x - 4), transformOrigin: "bottom left" },
					popoverStyle,
				]}
			>
				<Glass style={styles.pillInner}>
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
									<Icon name="smile" size={24} color={colors.gray} />
								)}
							</Pressable>
						</>
					)}
				</Glass>
			</Animated.View>

			<Animated.View
				style={[
					styles.menu,
					{ top: bubbleTop + layout.height + GAP },
					sent
						? { right: container.width - layout.x - layout.width, transformOrigin: "top right" }
						: { left: layout.x, transformOrigin: "top left" },
					popoverStyle,
				]}
			>
				{groups.map((group, groupIndex) => (
					<Glass
						key={group[0]?.key}
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
					</Glass>
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
		borderCurve: "continuous",
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
