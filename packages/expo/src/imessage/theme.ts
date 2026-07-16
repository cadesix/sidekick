// Values measured from iOS Messages (see plans/research-visual.md).
export const colors = {
	blue: "#007AFF",
	sentBubble: "#007AFF",
	sentText: "#FFFFFF",
	receivedBubble: "#E9E9EB",
	receivedText: "#000000",
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

export const bubble = {
	radius: 18,
	paddingHorizontal: 13,
	paddingVertical: 7,
	maxWidthFraction: 0.75,
	edgeMargin: 8,
	gapWithinGroup: 2,
	gapBetweenGroups: 8,
	tailWidth: 6,
} as const;

export const type = {
	body: { fontSize: 17, lineHeight: 22 },
	listName: { fontSize: 17, fontWeight: "600" as const },
	listPreview: { fontSize: 15, lineHeight: 20 },
	listTime: { fontSize: 15 },
	navName: { fontSize: 11 },
	separator: { fontSize: 12 },
	delivered: { fontSize: 11 },
} as const;
