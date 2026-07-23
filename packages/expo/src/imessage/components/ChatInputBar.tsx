import * as Haptics from "expo-haptics";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	Platform,
	Pressable,
	StyleSheet,
	type StyleProp,
	TextInput,
	type TextStyle,
	View,
	type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, withSpring, ZoomIn, ZoomOut } from "react-native-reanimated";
import { colors, font } from "../theme";
import { Glass, liquidGlass } from "./Glass";
import { Icon } from "./Icon";
import type { AudioAttachment } from "../types";
import { VoiceRecorder } from "./VoiceRecorder";

/** The composer's view of its picked attachments: none, still uploading/ingesting, or all ready. */
export type AttachmentState = "none" | "settling" | "ready";

// Composer surface: real iOS-26 liquid glass where available, else a FLAT opaque
// fill in the received-bubble gray. (The blur fallback lightens whatever fill sits
// behind it, so we skip the blur entirely and match the message bubbles exactly.)
function Surface({
	isInteractive,
	style,
	children,
}: {
	isInteractive?: boolean;
	style?: StyleProp<ViewStyle>;
	children: ReactNode;
}) {
	if (liquidGlass) {
		return (
			<Glass isInteractive={isInteractive} style={style}>
				{children}
			</Glass>
		);
	}
	return <View style={[style, styles.receivedFill]}>{children}</View>;
}

// Single-line resting height (matches the 40pt plus button) and the max before the
// field scrolls internally — the field grows between them as text wraps, like iOS.
const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 132;

// react-native-web honors the CSS `outline*` props even though RN's TextStyle omits
// them — used to kill the default blue focus ring on web.
const webInputReset = { outlineStyle: "none" } as unknown as TextStyle;

interface ChatInputBarProps {
	replyActive: boolean;
	attachmentState: AttachmentState;
	/** Staged attachments, rendered inside the bubble above the text row like iMessage. */
	tray: ReactNode;
	onSendText: (text: string) => void;
	onSendAudio: (audio: AudioAttachment) => void;
	onTogglePlusMenu: () => void;
	plusMenuOpen: boolean;
	recording: boolean;
	onRecordingChange: (recording: boolean) => void;
}

export function ChatInputBar({
	replyActive,
	attachmentState,
	tray,
	onSendText,
	onSendAudio,
	onTogglePlusMenu,
	plusMenuOpen,
	recording,
	onRecordingChange,
}: ChatInputBarProps) {
	const [text, setText] = useState("");
	const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
	const hasText = text.trim().length > 0;
	const inputRef = useRef<TextInput>(null);

	useEffect(() => {
		if (replyActive) {
			inputRef.current?.focus();
		}
	}, [replyActive]);

	// A message with attachments may send with no text, but never before every
	// attachment is ready — the turn must carry them.
	const showSend = hasText || attachmentState !== "none";
	const canSend =
		attachmentState === "ready" || (hasText && attachmentState === "none");

	const send = () => {
		if (!canSend) {
			return;
		}
		setText("");
		setInputHeight(MIN_INPUT_HEIGHT); // collapse back to one line after sending
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		onSendText(text.trim());
	};

	const startRecording = () => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		onRecordingChange(true);
	};

	// While recording, the detached button becomes an X that discards the take.
	const handleLeftButton = () => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		if (recording) {
			onRecordingChange(false);
			return;
		}
		onTogglePlusMenu();
	};

	// The plus twists 45° into an X while the drawer is open (or a take is
	// recording), like the Messages composer button.
	const closeButton = recording || plusMenuOpen;
	const plusIconStyle = useAnimatedStyle(() => ({
		transform: [
			{ rotate: withSpring(closeButton ? "45deg" : "0deg", { duration: 350, dampingRatio: 0.8 }) },
		],
	}));

	return (
		<View style={styles.container}>
			<View style={styles.row}>
				<Surface isInteractive style={styles.plusButton}>
					<Pressable onPress={handleLeftButton} style={styles.plusPressable} hitSlop={6}>
						<Animated.View style={plusIconStyle}>
							<Icon name="plus" size={19} color={colors.label} />
						</Animated.View>
					</Pressable>
				</Surface>
				{recording ? (
					<VoiceRecorder
						onCancel={() => onRecordingChange(false)}
						onSend={(audio) => {
							onRecordingChange(false);
							onSendAudio(audio);
						}}
					/>
				) : (
					<Surface style={[styles.field, tray ? styles.fieldWithTray : null]}>
						{tray ? (
							<>
								{tray}
								<View style={styles.trayDivider} />
							</>
						) : null}
						<View style={styles.inputRow}>
							<TextInput
								ref={inputRef}
								value={text}
								onChangeText={setText}
								placeholder={replyActive ? "Reply" : "Message"}
								placeholderTextColor={colors.tertiaryLabel}
								multiline
								// Grow with the text like iOS Messages: track content height and
								// clamp between one line (= the plus-button height) and a max, past
								// which the field scrolls internally. Works on iOS and web.
								onContentSizeChange={(e) =>
									setInputHeight(
										Math.min(
											MAX_INPUT_HEIGHT,
											Math.max(MIN_INPUT_HEIGHT, e.nativeEvent.contentSize.height),
										),
									)
								}
								// Web (dev): Enter sends, Shift+Enter inserts a newline. iOS keeps
								// return-as-newline (send is the arrow button).
								onKeyPress={(e) => {
									if (Platform.OS !== "web") {
										return;
									}
									const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
									if (ne.key === "Enter" && !ne.shiftKey) {
										e.preventDefault?.();
										send();
									}
								}}
								style={[
									styles.input,
									{ height: inputHeight },
									Platform.OS === "web" ? webInputReset : null,
								]}
								keyboardAppearance="light"
							/>
							{showSend ? (
								<Animated.View
									entering={ZoomIn.springify().duration(300)}
									exiting={ZoomOut.duration(120)}
									style={styles.sendWrapper}
								>
									<Pressable
										onPress={send}
										style={[styles.sendButton, canSend ? null : styles.sendDisabled]}
										disabled={!canSend}
										hitSlop={6}
									>
										<Icon name="arrowUp" size={16} color="#FFFFFF" strokeWidth={3} />
									</Pressable>
								</Animated.View>
							) : (
								<Pressable onPress={startRecording} style={styles.micButton} hitSlop={8}>
									<Icon name="audio" size={22} color={colors.gray} />
								</Pressable>
							)}
						</View>
					</Surface>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		paddingHorizontal: 12,
		paddingTop: 6,
		paddingBottom: 8,
	},
	row: {
		flexDirection: "row",
		alignItems: "flex-end",
		gap: 10,
	},
	plusButton: {
		width: 40,
		height: 40,
		borderRadius: 20,
	},
	plusPressable: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	field: {
		flex: 1,
		minHeight: 40,
		borderRadius: 20,
		borderCurve: "continuous",
	},
	fieldWithTray: {
		borderRadius: 26,
	},
	// The plus button + input field are filled with the received-bubble gray on all
	// platforms (not the frosted glass), so the composer matches the message bubbles.
	receivedFill: {
		backgroundColor: colors.field,
	},
	trayDivider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: "rgba(0,0,0,0.15)",
		marginHorizontal: 12,
	},
	inputRow: {
		flexDirection: "row",
		alignItems: "flex-end",
		maxHeight: 132,
	},
	input: {
		flex: 1,
		fontSize: 17,
		lineHeight: 21,
		fontFamily: font.regular,
		paddingLeft: 14,
		paddingRight: 4,
		paddingTop: 9,
		paddingBottom: 9,
		color: colors.label,
	},
	micButton: {
		width: 38,
		height: 40,
		alignItems: "center",
		justifyContent: "center",
	},
	sendWrapper: {
		marginRight: 4,
		marginBottom: 4,
	},
	sendButton: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.blue,
		alignItems: "center",
		justifyContent: "center",
	},
	sendDisabled: {
		backgroundColor: colors.gray3,
	},
});
