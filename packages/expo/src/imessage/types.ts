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

export type MessageKind = "text" | "audio" | "game";

export type GameType = "eight_ball" | "cup_pong";

export interface GameCardSummary {
	ballsLeft?: { user: number; sidekick: number };
	group?: "solids" | "stripes";
	cupsLeft?: { user: number; sidekick: number };
}

/** The live match payload joined onto a game turn-card row (plan 21). */
export interface GameCard {
	matchId: string;
	gameType: GameType;
	status: string;
	yourMove: boolean;
	winner: "user" | "sidekick" | null;
	/** Only the match's newest row renders the full card; older rows collapse. */
	latest: boolean;
	summary: GameCardSummary;
}

export interface AudioAttachment {
	uri: string;
	durationSec: number;
	waveform: number[];
}

export interface ImageAttachment {
	uri: string;
	width?: number;
	height?: number;
}

export interface FileAttachment {
	url: string;
	filename: string;
	mime: string;
	bytes: number;
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
	images: ImageAttachment[];
	file?: FileAttachment;
	game?: GameCard;
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
