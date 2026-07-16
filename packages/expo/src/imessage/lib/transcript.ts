import type { Message } from "../types";
import { SEPARATOR_GAP, formatSeparator } from "./time";

export interface SeparatorItem {
	type: "separator";
	id: string;
	day: string;
	time: string;
}

export interface MessageItem {
	type: "message";
	id: string;
	message: Message;
	replyTo?: Message;
	tail: boolean;
	gapAbove: number;
	statusLabel?: "Delivered" | "Read";
}

export type TranscriptItem = SeparatorItem | MessageItem;

// Builds the transcript newest-first, ready for an inverted list.
export const buildTranscript = (
	messages: Message[],
	now: number,
): TranscriptItem[] => {
	const byId = new Map(messages.map((message) => [message.id, message]));
	const lastMine = [...messages]
		.reverse()
		.find((message) => message.role === "me" && message.status !== "sending");

	const items: TranscriptItem[] = [];
	messages.forEach((message, index) => {
		const previous = messages[index - 1];
		const needsSeparator =
			!previous || message.createdAt - previous.createdAt > SEPARATOR_GAP;
		if (needsSeparator) {
			const label = formatSeparator(message.createdAt, now);
			items.push({
				type: "separator",
				id: `sep_${message.id}`,
				day: label.day,
				time: label.time,
			});
		}

		const next = messages[index + 1];
		const nextInGroup =
			next &&
			next.role === message.role &&
			next.createdAt - message.createdAt <= SEPARATOR_GAP;
		const previousInGroup =
			previous && previous.role === message.role && !needsSeparator;

		let statusLabel: MessageItem["statusLabel"];
		if (message === lastMine) {
			statusLabel = message.status === "read" ? "Read" : "Delivered";
		}

		items.push({
			type: "message",
			id: message.id,
			message,
			replyTo: message.replyToId ? byId.get(message.replyToId) : undefined,
			tail: !nextInGroup,
			gapAbove: previousInGroup ? 2 : 8,
			statusLabel,
		});
	});

	return items.reverse();
};
