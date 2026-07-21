import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
	Easing,
	interpolate,
	useAnimatedProps,
	useAnimatedStyle,
	useDerivedValue,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { buildTranscript, type TranscriptItem } from "../lib/transcript";
import { useSidekickChat } from "../useSidekickChat";
import { usePendingAttachments } from "../usePendingAttachments";
import { resolveCityLine } from "~/lib/location";
import { colors } from "../theme";
import type { AudioAttachment, Message, ReactionType } from "../types";
import { type AttachmentState, ChatInputBar } from "../components/ChatInputBar";
import { PendingAttachmentRow } from "../components/PendingAttachmentRow";
import { Glass } from "../components/Glass";
import { Icon } from "../components/Icon";
import { SponsoredCard } from "~/components/SponsoredCard";
import {
	MessageRow,
	TIME_REVEAL_WIDTH,
	type BubbleLayout,
} from "../components/MessageRow";
import { GamePickerSheet } from "../components/GamePickerSheet";
import { type DrawerAction, PlusDrawer } from "../components/PlusDrawer";
import { ReplyChain } from "../components/ReplyChain";
import { TapbackOverlay } from "../components/TapbackOverlay";
import { TimestampSeparator } from "../components/TimestampSeparator";
import { TypingIndicator } from "../components/TypingIndicator";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const TYPING_ITEM = "typing";
const ENTRY_ANIMATION_WINDOW = 1200;
const SHEET_HEADER_HEIGHT = 54;

/** Fraction of the screen the chat sheet covers; the mascot lives in the band above. */
export const CHAT_SHEET_DETENT = 0.82;

interface OverlayState {
	message: Message;
	layout: BubbleLayout;
	container: { width: number; height: number };
}

/**
 * The chat, hosted inside the home screen's slide-up drawer (plain RN views,
 * so it renders on web too). The mascot in the band above the drawer IS the
 * conversation identity, so there's no iMessage-style header — just a grabber
 * (slide down to dismiss) and a close button on the right. The composer
 * stack is pinned to the drawer bottom and rides the keyboard via the
 * keyboard-controller translate.
 */
export const ChatScreen = memo(ChatScreenImpl);
function ChatScreenImpl({
	onClose,
	onOpenGame,
}: {
	onClose: () => void;
	onOpenGame: (matchId: string) => void;
}) {
	const insets = useSafeAreaInsets();
	const { thread, messages, composerAd, typing, send, addReaction, removeMessage } =
		useSidekickChat();

	const [replyTo, setReplyTo] = useState<Message | undefined>(undefined);
	const [plusOpen, setPlusOpen] = useState(false);
	const [gamePickerOpen, setGamePickerOpen] = useState(false);
	const [recording, setRecording] = useState(false);
	const attachments = usePendingAttachments();
	const [overlay, setOverlay] = useState<OverlayState | null>(null);
	const mountedAt = useRef(Date.now());
	const containerRef = useRef<View>(null);

	const transcript = useMemo(
		() => buildTranscript(messages, Date.now()),
		[messages],
	);
	// The focused reply thread: the target's reply ancestors plus every message
	// replying into the chain (replies always follow their target, so one
	// forward pass catches all descendants).
	const replyChain = useMemo(() => {
		if (!replyTo) {
			return [];
		}
		const byId = new Map(messages.map((message) => [message.id, message]));
		const chainIds = new Set<string>();
		let cursor: Message | undefined = byId.get(replyTo.id) ?? replyTo;
		while (cursor) {
			chainIds.add(cursor.id);
			cursor = cursor.replyToId ? byId.get(cursor.replyToId) : undefined;
		}
		messages.forEach((message) => {
			if (message.replyToId && chainIds.has(message.replyToId)) {
				chainIds.add(message.id);
			}
		});
		const chain = messages.filter((message) => chainIds.has(message.id));
		return chain.length > 0 ? chain : [replyTo];
	}, [replyTo, messages]);
	const data: (TranscriptItem | typeof TYPING_ITEM)[] = useMemo(
		() => (typing ? [TYPING_ITEM, ...transcript] : transcript),
		[typing, transcript],
	);

	const keyboard = useReanimatedKeyboardAnimation();
	const inputBarHeight = useSharedValue(56);
	const revealX = useSharedValue(0);
	const replyProgress = useSharedValue(0);

	// Blur ramps in with the transcript instead of the whole layer fading, so
	// entering/leaving reply focus reads as a smooth defocus.
	const replyActive = replyTo !== undefined;
	useDerivedValue(() => {
		replyProgress.value = withTiming(replyActive ? 1 : 0, {
			duration: replyActive ? 280 : 220,
			easing: Easing.out(Easing.cubic),
		});
	}, [replyActive]);

	const scrimBlurProps = useAnimatedProps(() => ({
		intensity: replyProgress.value * 28,
	}));
	const scrimTintStyle = useAnimatedStyle(() => ({
		opacity: replyProgress.value,
	}));

	// keyboard.height runs 0 → -keyboardHeight, so this lifts the composer
	// exactly onto the keyboard's top edge; the home-indicator padding swaps
	// out while the keyboard is up.
	const footerStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: keyboard.height.value }],
	}));
	const inputBarPaddingStyle = useAnimatedStyle(() => ({
		paddingBottom: interpolate(
			keyboard.progress.value,
			[0, 1],
			[insets.bottom, 8],
		),
	}));
	// Short feather above the composer so messages dissolve into it instead of
	// cutting hard at its edge — without a fixed slab overhanging readable text.
	const FADE_FEATHER = 24;
	// In an inverted list the header renders at the visual bottom; it reserves
	// room for the input bar (plus the fade feather) and however far the keyboard
	// lifted it — so the newest message rests ABOVE the fade, not under it.
	const bottomSpacerStyle = useAnimatedStyle(() => ({
		height: inputBarHeight.value - keyboard.height.value + FADE_FEATHER,
	}));
	// The bottom fade tracks the live composer height (which now grows with
	// multi-line text) plus that feather, so it hugs the composer instead of the
	// old fixed 130px slab that overhung and covered the newest message.
	const inputFadeStyle = useAnimatedStyle(() => ({
		height: inputBarHeight.value + FADE_FEATHER,
	}));

	const timeRevealPan = Gesture.Pan()
		.activeOffsetX(-18)
		.failOffsetX(18)
		.failOffsetY([-12, 12])
		.onUpdate((event) => {
			const raw = Math.min(0, event.translationX);
			const magnitude = -raw;
			const damped = TIME_REVEAL_WIDTH * (magnitude / (magnitude + TIME_REVEAL_WIDTH));
			revealX.value = -damped;
		})
		.onEnd(() => {
			revealX.value = withSpring(0, { duration: 450, dampingRatio: 0.85 });
		});

	const handleSendText = useCallback(
		(text: string) => {
			send({ text, replyToId: replyTo?.id, attachments: attachments.take() });
			setReplyTo(undefined);
		},
		[send, replyTo, attachments],
	);

	const handleSendAudio = useCallback(
		(audio: AudioAttachment) => {
			send({ text: "", audio });
		},
		[send],
	);

	// Location is a one-time, city-level share (coords never leave the device) —
	// it lands in the transcript as a normal turn the sidekick can react to.
	const shareLocation = async () => {
		const city = await resolveCityLine().catch(() => null);
		if (city === null) {
			Alert.alert(
				"Couldn't share location",
				"Allow location access in Settings, then try again.",
			);
			return;
		}
		send({ text: `📍 ${city}` });
	};

	let attachmentState: AttachmentState = "none";
	if (attachments.pending.length > 0) {
		attachmentState = attachments.allReady ? "ready" : "settling";
	}

	const handleDrawerAction = (action: DrawerAction) => {
		setPlusOpen(false);
		if (action === "games") {
			setGamePickerOpen(true);
			return;
		}
		if (action === "audio") {
			setRecording(true);
			return;
		}
		if (action === "location") {
			void shareLocation();
			return;
		}
		void attachments.pickFrom(action);
	};

	// Bubbles are measured in window coordinates, but the overlay fills this
	// screen, which sits inside a drawer offset from the window's top.
	const handleLongPress = useCallback((message: Message, layout: BubbleLayout) => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		containerRef.current?.measureInWindow((containerX, containerY, containerWidth, containerHeight) => {
			setOverlay({
				message,
				layout: { ...layout, x: layout.x - containerX, y: layout.y - containerY },
				container: { width: containerWidth, height: containerHeight },
			});
		});
	}, []);

	const handleOverlayAction = useCallback(
		(key: string) => {
			if (!overlay) {
				return;
			}
			if (key === "reply") {
				setReplyTo(overlay.message);
			}
			if (key === "copy") {
				Clipboard.setStringAsync(overlay.message.text);
			}
			if (key === "undoSend") {
				removeMessage(overlay.message.id);
			}
		},
		[overlay, removeMessage],
	);

	const handleReaction = useCallback(
		(reactionType: ReactionType) => {
			if (!overlay) {
				return;
			}
			addReaction(overlay.message.id, reactionType);
		},
		[overlay, addReaction],
	);

	const renderItem = ({ item }: { item: TranscriptItem | typeof TYPING_ITEM }) => {
		if (item === TYPING_ITEM) {
			return (
				<View style={styles.typingRow}>
					<TypingIndicator />
				</View>
			);
		}
		if (item.type === "separator") {
			return <TimestampSeparator day={item.day} time={item.time} />;
		}
		return (
			<MessageRow
				item={item}
				revealX={revealX}
				onLongPress={handleLongPress}
				onReply={setReplyTo}
				onOpenGame={onOpenGame}
				hidden={overlay?.message.id === item.message.id}
				animateEntry={
					item.message.createdAt > mountedAt.current &&
					Date.now() - item.message.createdAt < ENTRY_ANIMATION_WINDOW
				}
			/>
		);
	};

	if (!thread) {
		return null;
	}

	return (
		<View ref={containerRef} style={styles.container}>
			<GestureDetector gesture={timeRevealPan}>
				<FlatList
					inverted
					data={data}
					keyExtractor={(item) => (item === TYPING_ITEM ? TYPING_ITEM : item.id)}
					renderItem={renderItem}
					keyboardDismissMode="interactive"
					showsVerticalScrollIndicator
					contentContainerStyle={{
						paddingTop: 8,
					}}
					ListHeaderComponent={<Animated.View style={bottomSpacerStyle} />}
					ListFooterComponent={<View style={styles.topSpacer} />}
					style={styles.list}
				/>
			</GestureDetector>

			<AnimatedBlurView
				tint="light"
				pointerEvents="none"
				animatedProps={scrimBlurProps}
				style={StyleSheet.absoluteFill}
			/>
			<Animated.View
				pointerEvents="none"
				style={[StyleSheet.absoluteFill, styles.replyScrim, scrimTintStyle]}
			/>
			{replyTo ? (
				<Pressable
					style={StyleSheet.absoluteFill}
					onPress={() => setReplyTo(undefined)}
				/>
			) : null}

			<View style={styles.header} pointerEvents="box-none">
				<LinearGradient
					colors={["rgba(255,255,255,0.96)", "rgba(255,255,255,0.82)", "rgba(255,255,255,0)"]}
					locations={[0, 0.55, 1]}
					style={styles.headerFade}
					pointerEvents="none"
				/>
				{/* grabber: signals the sheet slides down to dismiss */}
				<View style={styles.grabberWrap} pointerEvents="none">
					<View style={styles.grabber} />
				</View>
				{/* close on the RIGHT now; settings moved to the home screen's gear */}
				<View style={styles.headerRow} pointerEvents="box-none">
					<Glass isInteractive style={styles.glassButton}>
						<Pressable
							hitSlop={12}
							accessibilityLabel="Close chat"
							onPress={onClose}
							style={styles.glassPressable}
						>
							<Icon name="xmark" size={18} color={colors.blue} strokeWidth={2.5} />
						</Pressable>
					</Glass>
				</View>
			</View>

			{plusOpen ? (
				<Pressable
					style={StyleSheet.absoluteFill}
					onPress={() => setPlusOpen(false)}
				/>
			) : null}

			<Animated.View style={[styles.footer, footerStyle]} pointerEvents="box-none">
				<Animated.View style={[styles.inputFade, inputFadeStyle]} pointerEvents="none">
					<LinearGradient
						colors={["rgba(255,255,255,0)", colors.background]}
						locations={[0, 1]}
						style={StyleSheet.absoluteFill}
					/>
				</Animated.View>
				<Animated.View
					style={inputBarPaddingStyle}
					onLayout={(event) => {
						inputBarHeight.value = withTiming(event.nativeEvent.layout.height, {
							duration: 200,
						});
					}}
				>
					{replyTo ? <ReplyChain messages={replyChain} /> : null}
					{composerAd ? <SponsoredCard ad={composerAd} /> : null}
					{/* The drawer anchors a fixed distance above the wrapper's BOTTOM (the
					    plus button is bottom-aligned there), so staged attachments, reply
					    chains, and multiline text never push it up. */}
					<View>
						{plusOpen ? <PlusDrawer onSelect={handleDrawerAction} /> : null}
						<ChatInputBar
							replyActive={replyTo !== undefined}
							attachmentState={attachmentState}
							tray={
								attachments.pending.length > 0 || attachments.error !== null ? (
									<PendingAttachmentRow
										attachments={attachments.pending}
										error={attachments.error}
										onRemove={attachments.remove}
										onRetry={attachments.retry}
									/>
								) : null
							}
							onSendText={handleSendText}
							onSendAudio={handleSendAudio}
							onTogglePlusMenu={() => setPlusOpen((open) => !open)}
							plusMenuOpen={plusOpen}
							recording={recording}
							onRecordingChange={setRecording}
						/>
					</View>
				</Animated.View>
			</Animated.View>

			<GamePickerSheet
				visible={gamePickerOpen}
				onClose={() => setGamePickerOpen(false)}
				onOpenMatch={(matchId) => {
					setGamePickerOpen(false);
					onOpenGame(matchId);
				}}
			/>

			{overlay ? (
				<TapbackOverlay
					message={
						messages.find((candidate) => candidate.id === overlay.message.id) ??
						overlay.message
					}
					layout={overlay.layout}
					container={overlay.container}
					onSelectReaction={handleReaction}
					onAction={handleOverlayAction}
					onDismiss={() => setOverlay(null)}
				/>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	// Clipped to the drawer's rounded top so scrolled bubbles can't paint over
	// the corner notches or the drawer's top edge.
	container: {
		flex: 1,
		backgroundColor: colors.background,
		borderTopLeftRadius: 28,
		borderTopRightRadius: 28,
		overflow: "hidden",
	},
	list: {
		flex: 1,
	},
	typingRow: {
		paddingHorizontal: 16,
	},
	topSpacer: {
		height: SHEET_HEADER_HEIGHT + 16,
	},
	footer: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
	},
	inputFade: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
	},
	replyScrim: {
		backgroundColor: "rgba(255,255,255,0.5)",
	},
	header: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 10,
	},
	headerFade: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		height: SHEET_HEADER_HEIGHT + 30,
	},
	headerRow: {
		height: SHEET_HEADER_HEIGHT,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-end",
		paddingHorizontal: 12,
	},
	grabberWrap: {
		position: "absolute",
		top: 8,
		left: 0,
		right: 0,
		alignItems: "center",
	},
	grabber: {
		width: 36,
		height: 5,
		borderRadius: 3,
		backgroundColor: "rgba(60,60,67,0.3)",
	},
	glassButton: {
		width: 42,
		height: 42,
		borderRadius: 21,
		borderCurve: "continuous",
	},
	glassPressable: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
});
