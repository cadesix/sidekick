import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, withSpring, ZoomIn, ZoomOut } from "react-native-reanimated";
import { colors } from "../theme";
import { Glass } from "./Glass";
import { Icon } from "./Icon";
import type { AudioAttachment } from "../types";
import { VoiceRecorder } from "./VoiceRecorder";

interface ChatInputBarProps {
	replyActive: boolean;
	onSendText: (text: string) => void;
	onSendAudio: (audio: AudioAttachment) => void;
	onTogglePlusMenu: () => void;
	plusMenuOpen: boolean;
	recording: boolean;
	onRecordingChange: (recording: boolean) => void;
}

export const INPUT_BAR_MIN_HEIGHT = 56;

export function ChatInputBar({
	replyActive,
	onSendText,
	onSendAudio,
	onTogglePlusMenu,
	plusMenuOpen,
	recording,
	onRecordingChange,
}: ChatInputBarProps) {
	const [text, setText] = useState("");
	const hasText = text.trim().length > 0;
	const inputRef = useRef<TextInput>(null);

	useEffect(() => {
		if (replyActive) {
			inputRef.current?.focus();
		}
	}, [replyActive]);

	const send = () => {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}
		setText("");
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		onSendText(trimmed);
	};

	const startRecording = () => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		onRecordingChange(true);
	};

	// While recording, the detached button becomes an X that discards the take.
	const handleLeftButton = () => {
		if (recording) {
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			onRecordingChange(false);
			return;
		}
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
				<Glass isInteractive style={styles.plusButton}>
					<Pressable onPress={handleLeftButton} style={styles.plusPressable} hitSlop={6}>
						<Animated.View style={plusIconStyle}>
							<Icon name="plus" size={19} color={colors.label} />
						</Animated.View>
					</Pressable>
				</Glass>
				{recording ? (
					<VoiceRecorder
						onCancel={() => onRecordingChange(false)}
						onSend={(audio) => {
							onRecordingChange(false);
							onSendAudio(audio);
						}}
					/>
				) : (
					<Glass style={styles.field}>
						<TextInput
							ref={inputRef}
							value={text}
							onChangeText={setText}
							placeholder={replyActive ? "Reply" : "Message"}
							placeholderTextColor={colors.tertiaryLabel}
							multiline
							style={styles.input}
							keyboardAppearance="light"
						/>
						{hasText ? (
							<Animated.View
								entering={ZoomIn.springify().duration(300)}
								exiting={ZoomOut.duration(120)}
								style={styles.sendWrapper}
							>
								<Pressable onPress={send} style={styles.sendButton} hitSlop={6}>
									<Icon name="arrowUp" size={16} color="#FFFFFF" strokeWidth={3} />
								</Pressable>
							</Animated.View>
						) : (
							<Pressable onPress={startRecording} style={styles.micButton} hitSlop={8}>
								<Icon name="audio" size={22} color={colors.gray} />
							</Pressable>
						)}
					</Glass>
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
		flexDirection: "row",
		alignItems: "flex-end",
		minHeight: 40,
		maxHeight: 132,
		borderRadius: 20,
		borderCurve: "continuous",
	},
	input: {
		flex: 1,
		fontSize: 17,
		lineHeight: 21,
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
});
