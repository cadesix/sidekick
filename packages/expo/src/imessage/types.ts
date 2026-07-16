export type Sender = "me" | "them";

export type ReactionType =
	| "heart"
	| "thumbsUp"
	| "thumbsDown"
	| "haha"
	| "exclamation"
	| "question"
	| `emoji:${string}`;

export interface Reaction {
	type: ReactionType;
	from: Sender;
}

export type MessageStatus = "sending" | "delivered" | "read";

export type MessageKind = "text" | "audio";

export interface AudioAttachment {
	uri: string;
	durationSec: number;
	waveform: number[];
}

export interface Message {
	id: string;
	threadId: string;
	role: Sender;
	text: string;
	createdAt: number;
	status?: MessageStatus;
	replyToId?: string;
	reactions: Reaction[];
	kind: MessageKind;
	audio?: AudioAttachment;
}

export interface Thread {
	id: string;
	name: string;
	avatarInitials?: string;
	avatarColor?: string;
	subtitle?: string;
	systemPrompt: string;
	createdAt: number;
}
