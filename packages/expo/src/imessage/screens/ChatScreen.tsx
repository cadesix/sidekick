import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
 * conversation identity, so there's no iMessage-style header — just a slim row
 * of glass buttons: close on the left, settings on the right. The composer
 * stack is pinned to the drawer bottom and rides the keyboard via the
 * keyboard-controller translate.
 */
export function ChatScreen({ onClose }: { onClose: () => void }) {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const { thread, messages, composerAd, typing, send, addReaction, removeMessage } =
		useSidekickChat();

	const [replyTo, setReplyTo] = useState<Message | undefined>(undefined);
	const [plusOpen, setPlusOpen] = useState(false);
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
	// In an inverted list the header renders at the visual bottom; it reserves
	// room for the input bar plus however far the keyboard lifted it.
	const bottomSpacerStyle = useAnimatedStyle(() => ({
		height: inputBarHeight.value - keyboard.height.value,
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
					<Glass isInteractive style={styles.glassButton}>
						<Pressable
							hitSlop={12}
							accessibilityLabel="Settings"
							onPress={() => router.push("/settings")}
							style={styles.glassPressable}
						>
							<Icon name="ellipsis" size={20} color={colors.blue} strokeWidth={2.5} />
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
				<LinearGradient
					colors={["rgba(255,255,255,0)", colors.background]}
					locations={[0, 1]}
					style={styles.inputFade}
					pointerEvents="none"
				/>
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
					<PendingAttachmentRow
						attachments={attachments.pending}
						error={attachments.error}
						onRemove={attachments.remove}
						onRetry={attachments.retry}
					/>
					{/* The drawer anchors to the input bar (not the growing footer), so it
					    always opens the same distance above the plus button — staged
					    attachments and reply chains no longer push it up. */}
					<View>
						{plusOpen ? <PlusDrawer onSelect={handleDrawerAction} /> : null}
						<ChatInputBar
							replyActive={replyTo !== undefined}
							attachmentState={attachmentState}
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
		height: 130,
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
		justifyContent: "space-between",
		paddingHorizontal: 12,
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
