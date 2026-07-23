import { FONT, FONT_BOLD, FONT_MEDIUM } from "~/lib/tokens";

// Layout metrics measured from iOS Messages (plans/research-visual.md); the
// look itself is the BRAND's (06-design-system §3.3): cream sidekick bubbles,
// usergray user bubbles, ink text, Diatype Rounded throughout — not iOS blue.
export const colors = {
	blue: "#007AFF",
	sentBubble: "#E9E9EC", // usergray — the user's bubbles
	sentText: "#111111",
	receivedBubble: "#FBEFC9", // cream — the sidekick's bubbles
	receivedText: "#111111",
	field: "#F0F0F2", // input backgrounds (06 §1.1)
	background: "#FFFFFF",
	label: "#000000",
	secondaryLabel: "rgba(60,60,67,0.6)",
	tertiaryLabel: "rgba(60,60,67,0.3)",
	separator: "rgba(60,60,67,0.29)",
	opaqueSeparator: "#C6C6C8",
	fieldBorder: "#D5D5DA",
	searchFill: "rgba(118,118,128,0.12)",
	gray: "#8E8E93",
	gray2: "#AEAEB2",
	gray3: "#C7C7CC",
	gray4: "#D1D1D6",
	gray5: "#E5E5EA",
	gray6: "#F2F2F7",
	green: "#34C759",
	red: "#FF3B30",
	monogramTop: "#A7B1E1",
	monogramBottom: "#7B86C6",
} as const;

// 06 §3.3: 24px corners with the ONE corner nearest the sender flattened to
// 6px (tailRadius) on a group's last bubble; px-4 py-2.5 padding.
export const bubble = {
	radius: 24,
	tailRadius: 6,
	paddingHorizontal: 16,
	paddingVertical: 10,
	maxWidthFraction: 0.8,
	edgeMargin: 8,
	gapWithinGroup: 2,
	gapBetweenGroups: 8,
} as const;

// One family, ABC Diatype Rounded (06 §1.2). iOS won't faux-bold a custom
// font, so weights are separate families — set the family, never fontWeight.
export const font = {
	regular: FONT,
	medium: FONT_MEDIUM,
	bold: FONT_BOLD,
} as const;

export const type = {
	body: { fontSize: 16, lineHeight: 22, fontFamily: font.regular }, // chat role, bumped one step
	listName: { fontSize: 17, fontFamily: font.bold },
	listPreview: { fontSize: 15, lineHeight: 20, fontFamily: font.regular },
	listTime: { fontSize: 15, fontFamily: font.regular },
	navName: { fontSize: 11, fontFamily: font.medium },
	separator: { fontSize: 12, fontFamily: font.medium },
	delivered: { fontSize: 11, fontFamily: font.medium },
} as const;
