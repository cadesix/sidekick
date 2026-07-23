import { useContext } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FloatingChat } from "../floating-chat";
import { isEmojiOnly } from "../lib/emoji";
import { bubble, colors, font, type } from "../theme";
import type { Message } from "../types";
import { AudioBubble } from "./AudioBubble";
import { FileBubble } from "./FileBubble";
import { GameCardBubble, gameName } from "./GameCardBubble";
import { ImageBubble } from "./ImageBubble";
import { MessageBubble } from "./MessageBubble";

/** One-line stand-in for a message with no text (reply quotes, previews). */
export function messageSummary(message: Message): string {
	if (message.kind === "game" && message.game) {
		return gameName(message.game.gameType);
	}
	if (message.kind === "audio") {
		return "Audio Message";
	}
	if (message.text.length > 0) {
		return message.text;
	}
	if (message.images.length > 0) {
		return message.images.length === 1 ? "Photo" : `${message.images.length} Photos`;
	}
	if (message.file) {
		return message.file.filename;
	}
	return "";
}

/**
 * A message's bubble content — big emoji, voice note, or the photo/file/text
 * stack — shared by the transcript row, the tapback overlay's bubble clone, and
 * the reply chain. The tail lands on the stack's last bubble.
 */
export function MessageContent({
	message,
	tail,
	onOpenGame,
}: {
	message: Message;
	tail: boolean;
	onOpenGame?: (matchId: string) => void;
}) {
	const frosted = useContext(FloatingChat);
	const sent = message.role === "me";
	if (message.kind === "game" && message.game) {
		return <GameCardBubble game={message.game} onOpenGame={onOpenGame} />;
	}
	const hasAttachments = message.images.length > 0 || message.file !== undefined;
	if (message.kind === "text" && !hasAttachments && isEmojiOnly(message.text)) {
		return <Text style={styles.bigEmoji}>{message.text}</Text>;
	}
	if (message.kind === "audio" && message.audio) {
		return (
			<MessageBubble from={message.role} tail={tail}>
				<AudioBubble audio={message.audio} sent={sent} />
			</MessageBubble>
		);
	}
	const hasText = message.text.length > 0;
	return (
		<View style={[styles.stack, sent ? styles.stackSent : styles.stackReceived]}>
			{message.images.length > 0 ? <ImageBubble images={message.images} /> : null}
			{message.file ? (
				<MessageBubble
					from={message.role}
					tail={tail && !hasText}
				>
					<FileBubble file={message.file} sent={sent} />
				</MessageBubble>
			) : null}
			{hasText || !hasAttachments ? (
				<MessageBubble from={message.role} tail={tail}>
					<Text style={[styles.text, sent ? styles.textSent : styles.textReceived, frosted ? styles.textFrosted : null]}>
						{message.text}
					</Text>
				</MessageBubble>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	stack: {
		gap: bubble.gapWithinGroup,
	},
	stackSent: {
		alignItems: "flex-end",
	},
	stackReceived: {
		alignItems: "flex-start",
	},
	text: {
		fontSize: type.body.fontSize,
		lineHeight: type.body.lineHeight,
		fontFamily: font.regular,
	},
	textSent: {
		color: colors.sentText,
	},
	textReceived: {
		color: colors.receivedText,
	},
	textFrosted: {
		color: "#FFFFFF",
	},
	bigEmoji: {
		fontSize: 46,
		lineHeight: 54,
	},
});
