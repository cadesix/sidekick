import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { formatSeparator } from "../lib/time";
import { isEmojiOnly } from "../lib/emoji";
import { bubble, colors, type } from "../theme";
import type { Message } from "../types";
import { AudioBubble } from "./AudioBubble";
import { MessageBubble } from "./MessageBubble";
import { TapbackBadge } from "./TapbackBadge";
import { TimestampSeparator } from "./TimestampSeparator";

// The focused reply thread shown above the input while composing a reply
// (iOS 26 blurs the transcript and keeps only these messages sharp).
export function ReplyChain({ messages }: { messages: Message[] }) {
	const label = formatSeparator(messages[0].createdAt, Date.now());
	return (
		<Animated.View
			entering={FadeInDown.duration(280)}
			exiting={FadeOut.duration(200)}
			style={styles.container}
		>
			<TimestampSeparator day={label.day} time={label.time} />
			{messages.map((message, index) => {
				const sent = message.role === "me";
				const next = messages[index + 1];
				const tail = !next || next.role !== message.role;
				const gapAbove = index === 0 ? 0 : 8;
				const reactionRoom = message.reactions.length > 0 ? 14 : 0;
				return (
					<View
						key={message.id}
						style={[
							styles.row,
							sent ? styles.rowSent : styles.rowReceived,
							{ marginTop: gapAbove + reactionRoom },
						]}
					>
						<View style={styles.bubbleHolder}>
							{message.kind === "audio" && message.audio ? (
								<MessageBubble from={message.role} tail={tail}>
									<AudioBubble audio={message.audio} sent={sent} />
								</MessageBubble>
							) : isEmojiOnly(message.text) ? (
								<Text style={styles.bigEmoji}>{message.text}</Text>
							) : (
								<MessageBubble from={message.role} tail={tail}>
									<Text
										style={[
											styles.text,
											sent ? styles.textSent : styles.textReceived,
										]}
									>
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
						</View>
					</View>
				);
			})}
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	container: {
		paddingHorizontal: bubble.edgeMargin + 8,
		paddingBottom: 12,
		transformOrigin: "bottom center",
	},
	row: {
		flexDirection: "row",
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
	text: {
		fontSize: type.body.fontSize,
		lineHeight: type.body.lineHeight,
	},
	textSent: {
		color: colors.sentText,
	},
	textReceived: {
		color: colors.receivedText,
	},
	bigEmoji: {
		fontSize: 46,
		lineHeight: 54,
	},
});
