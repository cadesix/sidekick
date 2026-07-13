import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
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
const SHEET_HEADER_HEIGHT = 54;

/** Fraction of the screen the chat sheet covers; the mascot lives in the band above. */
export const CHAT_SHEET_DETENT = 0.75;

interface OverlayState {
	message: Message;
	layout: BubbleLayout;
}

/**
 * The chat, presented as a native bottom sheet over the home screen (the
 * mascot above the sheet is the "contact", so there's no iMessage-style
 * header — just a slim row of glass buttons: settings on the left, close on
 * the right). The composer stack renders through the sheet's `footer` so it's
 * natively pinned to the visible sheet bottom and rides the keyboard — RN-side
 * layout can't reach the sheet bottom because the content is laid out at full
 * screen height.
 */
export function ChatScreen({
	sheetRef,
	onWillDismiss,
}: {
	sheetRef: RefObject<TrueSheet | null>;
	onWillDismiss: () => void;
}) {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const { thread, messages, composerAd, typing, send, addReaction, removeMessage } =
		useSidekickChat();

	const [replyTo, setReplyTo] = useState<Message | undefined>(undefined);
	const [plusOpen, setPlusOpen] = useState(false);
	const [recording, setRecording] = useState(false);
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

	// The hosting native sheet rides the keyboard itself, so the input bar just
	// stays pinned to the sheet bottom; only the home-indicator padding swaps
	// out while the keyboard is up.
	const inputBarPaddingStyle = useAnimatedStyle(() => ({
		paddingBottom: interpolate(
			keyboard.progress.value,
			[0, 1],
			[insets.bottom, 8],
		),
	}));
	// In an inverted list the header renders at the visual bottom; it reserves
	// room for the input bar.
	const bottomSpacerStyle = useAnimatedStyle(() => ({
		height: inputBarHeight.value,
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

	// UIKit silently drops a modal presented while the sheet's own view
	// controller is presenting, so the sheet has to come down first.
	const openSettings = async () => {
		await sheetRef.current?.dismiss();
		router.push("/settings");
	};

	// Bubbles are measured in window coordinates, but the overlay fills this
	// screen, which sits inside a sheet offset from the window's top.
	const handleLongPress = useCallback((message: Message, layout: BubbleLayout) => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		containerRef.current?.measureInWindow((containerX, containerY) => {
			setOverlay({
				message,
				layout: { ...layout, x: layout.x - containerX, y: layout.y - containerY },
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

	// The footer is a native layer above the content view, so the tapback
	// overlay (inside the content) can't cover it — hide it while focused.
	const footer = (
		<View
			pointerEvents={overlay ? "none" : "box-none"}
			style={overlay ? styles.footerHidden : null}
		>
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
		</View>
	);

	return (
		<TrueSheet
			ref={sheetRef}
			detents={[CHAT_SHEET_DETENT]}
			dimmed={false}
			cornerRadius={28}
			backgroundColor={colors.background}
			scrollable
			scrollableOptions={{ topScrollEdgeEffect: "soft" }}
			insetAdjustment="never"
			onWillDismiss={onWillDismiss}
			footer={thread ? footer : undefined}
		>
			{thread ? (
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
							ListFooterComponent={<View style={{ height: SHEET_HEADER_HEIGHT + 16 }} />}
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
							<GlassView isInteractive glassEffectStyle="regular" style={styles.glassButton}>
								{replyTo ? (
									<Pressable
										hitSlop={12}
										onPress={() => setReplyTo(undefined)}
										style={styles.glassPressable}
									>
										<SymbolView name="xmark" size={18} weight="semibold" tintColor={colors.blue} />
									</Pressable>
								) : (
									<Pressable
										hitSlop={12}
										onPress={() => void openSettings()}
										style={styles.glassPressable}
									>
										<SymbolView name="ellipsis" size={20} weight="semibold" tintColor={colors.blue} />
									</Pressable>
								)}
							</GlassView>
							<GlassView isInteractive glassEffectStyle="regular" style={styles.glassButton}>
								<Pressable
									hitSlop={12}
									onPress={() => void sheetRef.current?.dismiss()}
									style={styles.glassPressable}
								>
									<SymbolView name="chevron.down" size={20} weight="semibold" tintColor={colors.blue} />
								</Pressable>
							</GlassView>
						</View>
					</View>

					{plusOpen ? (
						<Pressable
							style={StyleSheet.absoluteFill}
							onPress={() => setPlusOpen(false)}
						/>
					) : null}

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
				</View>
			) : null}
		</TrueSheet>
	);
}

const styles = StyleSheet.create({
	// Clipped to the sheet's rounded top so scrolled bubbles can't paint over
	// the corner notches or the sheet's top edge.
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
	footerHidden: {
		opacity: 0,
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
	},
	glassPressable: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
});
