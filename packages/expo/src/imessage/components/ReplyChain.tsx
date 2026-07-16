import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { formatSeparator } from "../lib/time";
import { bubble } from "../theme";
import type { Message } from "../types";
import { MessageContent } from "./MessageContent";
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
							<MessageContent message={message} tail={tail} />
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
});
