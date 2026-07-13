import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	Modal,
	Pressable,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
	Easing,
	interpolate,
	useAnimatedProps,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { buildTranscript, type TranscriptItem } from "../lib/transcript";
import { useSidekickChat } from "../useSidekickChat";
import { colors } from "../theme";
import type { AudioAttachment, Message, ReactionType } from "../types";
import { Avatar } from "../components/Avatar";
import { CHAT_HEADER_CONTENT_HEIGHT, ChatHeader } from "../components/ChatHeader";
import { ChatInputBar } from "../components/ChatInputBar";
import { SponsoredCard } from "~/components/SponsoredCard";
import {
	MessageRow,
	TIME_REVEAL_WIDTH,
	type BubbleLayout,
} from "../components/MessageRow";
import { PlusDrawer } from "../components/PlusDrawer";
import { ReplyChain } from "../components/ReplyChain";
import { TapbackOverlay } from "../components/TapbackOverlay";
import { TimestampSeparator } from "../components/TimestampSeparator";
import { TypingIndicator } from "../components/TypingIndicator";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const TYPING_ITEM = "typing";
const ENTRY_ANIMATION_WINDOW = 1200;

interface OverlayState {
	message: Message;
	layout: BubbleLayout;
}

export function ChatScreen() {
	const insets = useSafeAreaInsets();
	const { thread, messages, composerAd, typing, send, addReaction, removeMessage } =
		useSidekickChat();

	const [replyTo, setReplyTo] = useState<Message | undefined>(undefined);
	const [plusOpen, setPlusOpen] = useState(false);
	const [recording, setRecording] = useState(false);
	const [overlay, setOverlay] = useState<OverlayState | null>(null);
	const [contactOpen, setContactOpen] = useState(false);
	const mountedAt = useRef(Date.now());

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
	useEffect(() => {
		replyProgress.value = withTiming(replyTo ? 1 : 0, {
			duration: replyTo ? 280 : 220,
			easing: Easing.out(Easing.cubic),
		});
	}, [replyTo, replyProgress]);

	const scrimBlurProps = useAnimatedProps(() => ({
		intensity: replyProgress.value * 28,
	}));
	const scrimTintStyle = useAnimatedStyle(() => ({
		opacity: replyProgress.value,
	}));

	const inputBarStyle = useAnimatedStyle(() => ({
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
	// room for the input bar and rides the keyboard.
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
			send({ text, replyToId: replyTo?.id });
			setReplyTo(undefined);
		},
		[send, replyTo],
	);

	const handleSendAudio = useCallback(
		(audio: AudioAttachment) => {
			send({ text: "", audio });
		},
		[send],
	);

	const handleLongPress = useCallback((message: Message, layout: BubbleLayout) => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		setOverlay({ message, layout });
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
		return <View style={styles.container} />;
	}

	return (
		<View style={styles.container}>
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
					ListFooterComponent={
						<View style={{ height: insets.top + CHAT_HEADER_CONTENT_HEIGHT + 12 }} />
					}
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

			<ChatHeader
				thread={thread}
				onPressContact={() => setContactOpen(true)}
				replyActive={replyTo !== undefined}
				onExitReply={() => setReplyTo(undefined)}
			/>

			{plusOpen ? (
				<Pressable
					style={StyleSheet.absoluteFill}
					onPress={() => setPlusOpen(false)}
				/>
			) : null}

			<Animated.View style={[styles.inputBarWrapper, inputBarStyle]}>
				<LinearGradient
					colors={["rgba(255,255,255,0)", colors.background]}
					locations={[0, 1]}
					style={styles.inputFade}
					pointerEvents="none"
				/>
				{plusOpen ? (
					<PlusDrawer
						onSelectAudio={() => {
							setPlusOpen(false);
							setRecording(true);
						}}
						onClose={() => setPlusOpen(false)}
					/>
				) : null}
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
					<ChatInputBar
						replyActive={replyTo !== undefined}
						onSendText={handleSendText}
						onSendAudio={handleSendAudio}
						onTogglePlusMenu={() => setPlusOpen((open) => !open)}
						plusMenuOpen={plusOpen}
						recording={recording}
						onRecordingChange={setRecording}
					/>
				</Animated.View>
			</Animated.View>

			{overlay ? (
				<TapbackOverlay
					message={
						messages.find((candidate) => candidate.id === overlay.message.id) ??
						overlay.message
					}
					layout={overlay.layout}
					onSelectReaction={handleReaction}
					onAction={handleOverlayAction}
					onDismiss={() => setOverlay(null)}
				/>
			) : null}

			<Modal
				visible={contactOpen}
				animationType="slide"
				presentationStyle="formSheet"
				onRequestClose={() => setContactOpen(false)}
			>
				<View style={styles.contactSheet}>
					<Pressable
						style={styles.contactDone}
						onPress={() => setContactOpen(false)}
					>
						<Text style={styles.contactDoneText}>Done</Text>
					</Pressable>
					<Avatar
						initials={thread.avatarInitials ?? thread.name.slice(0, 1)}
						size={96}
					/>
					<Text style={styles.contactName}>{thread.name}</Text>
					<Text style={styles.contactSubtitle}>{thread.systemPrompt}</Text>
				</View>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: colors.background,
	},
	list: {
		flex: 1,
	},
	typingRow: {
		paddingHorizontal: 16,
	},
	inputBarWrapper: {
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
	contactSheet: {
		flex: 1,
		alignItems: "center",
		paddingTop: 32,
		paddingHorizontal: 24,
		backgroundColor: colors.gray6,
	},
	contactDone: {
		alignSelf: "flex-end",
		marginBottom: 12,
	},
	contactDoneText: {
		color: colors.blue,
		fontSize: 17,
		fontWeight: "600",
	},
	contactName: {
		fontSize: 24,
		fontWeight: "600",
		marginTop: 12,
		color: colors.label,
	},
	contactSubtitle: {
		fontSize: 14,
		color: colors.secondaryLabel,
		textAlign: "center",
		marginTop: 10,
		lineHeight: 19,
	},
});
