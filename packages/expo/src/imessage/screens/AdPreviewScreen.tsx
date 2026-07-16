import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SponsoredCard } from "~/components/SponsoredCard";
import { trpc } from "~/lib/api";
import type { AdView } from "~/lib/chat-thread";
import { ChatInputBar } from "../components/ChatInputBar";
import { Icon } from "../components/Icon";
import { MessageBubble } from "../components/MessageBubble";
import { colors, type } from "../theme";
import { Glass } from "../components/Glass";

/**
 * Dev-only (linked from Settings behind __DEV__): renders a `SponsoredCard`
 * inside a replica of the chat composer area so card styling can be iterated
 * without steering a real conversation into an ad fill. Canned samples cover the
 * short and worst-case-long payloads; Live pulls a real fill from Gravity via
 * `ads.preview`.
 */

const SHORT_AD: AdView = {
	adUnitId: "preview",
	brandName: "Brooks",
	faviconUrl: "https://www.brooksrunning.com/favicon.ico",
	title: "Meet the Ghost 16",
	body: "Soft, smooth cushioning for daily miles.",
	cta: "Shop now",
	clickUrl: "https://www.brooksrunning.com",
};

const LONG_AD: AdView = {
	adUnitId: "preview",
	brandName: "The Extremely Long Brand Name Running Company of Greater Boston",
	faviconUrl: null,
	title:
		"The all-new UltraGlide Infinity Max 5000 with responsive nitrogen-infused foam for effortless daily training runs and beyond",
	body: "Engineered with our most advanced midsole geometry yet, the UltraGlide adapts to your stride in real time so every kilometer of your daily 5k feels as fresh as the first, whatever the weather.",
	cta: "Discover the entire UltraGlide Infinity collection today",
	clickUrl: "https://example.com",
};

const SAMPLES = [
	{ key: "short", label: "Short" },
	{ key: "long", label: "Long" },
	{ key: "live", label: "Live" },
] as const;

type SampleKey = (typeof SAMPLES)[number]["key"];

/** The conversation the preview card pretends to follow (matches ads.preview's window). */
const TRANSCRIPT: { from: "me" | "them"; text: string }[] = [
	{ from: "me", text: "my running shoes are falling apart, thinking about replacing them" },
	{
		from: "them",
		text: "Sounds like it's time! Are you open to trying a different style?",
	},
	{ from: "me", text: "open to anything comfortable for daily 5ks" },
];

function LiveAd() {
	const live = useQuery({
		queryKey: ["ad-preview"],
		queryFn: () => trpc.ads.preview.query(),
		staleTime: 0,
	});
	if (live.isPending) {
		return <Text style={styles.liveStatus}>Requesting an ad from Gravity…</Text>;
	}
	if (!live.data) {
		return <Text style={styles.liveStatus}>No fill — is GRAVITY_API_KEY set on the server?</Text>;
	}
	return <SponsoredCard ad={live.data} />;
}

export function AdPreviewScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const [sample, setSample] = useState<SampleKey>("short");
	const [recording, setRecording] = useState(false);

	return (
		<View style={styles.screen}>
			<View style={styles.header}>
				<Glass isInteractive style={styles.glassButton}>
					<Pressable hitSlop={12} onPress={() => router.back()} style={styles.glassPressable}>
						<Icon name="chevronLeft" size={20} color={colors.blue} strokeWidth={2.5} />
					</Pressable>
				</Glass>
				<Text style={styles.title}>Ad Preview</Text>
				<View style={styles.glassButton} />
			</View>

			<View style={styles.samples}>
				{SAMPLES.map((option) => (
					<Pressable
						key={option.key}
						onPress={() => setSample(option.key)}
						style={[styles.sampleChip, sample === option.key ? styles.sampleChipActive : null]}
					>
						<Text
							style={[
								styles.sampleLabel,
								sample === option.key ? styles.sampleLabelActive : null,
							]}
						>
							{option.label}
						</Text>
					</Pressable>
				))}
			</View>

			<View style={styles.transcript}>
				{TRANSCRIPT.map((message, index) => (
					<View
						key={message.text}
						style={message.from === "me" ? styles.rowSent : styles.rowReceived}
					>
						<MessageBubble from={message.from} tail={TRANSCRIPT[index + 1]?.from !== message.from}>
							<Text
								style={[
									styles.bubbleText,
									message.from === "me" ? styles.bubbleTextSent : styles.bubbleTextReceived,
								]}
							>
								{message.text}
							</Text>
						</MessageBubble>
					</View>
				))}
			</View>

			<View style={styles.inputBarWrapper}>
				<LinearGradient
					colors={["rgba(255,255,255,0)", colors.background]}
					locations={[0, 1]}
					style={styles.inputFade}
					pointerEvents="none"
				/>
				<View style={{ paddingBottom: insets.bottom }}>
					{sample === "live" ? (
						<LiveAd key={sample} />
					) : (
						<SponsoredCard key={sample} ad={sample === "short" ? SHORT_AD : LONG_AD} />
					)}
					<ChatInputBar
						replyActive={false}
						attachmentState="none"
						onSendText={() => {}}
						onSendAudio={() => {}}
						onTogglePlusMenu={() => {}}
						plusMenuOpen={false}
						recording={recording}
						onRecordingChange={setRecording}
					/>
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: colors.background,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 12,
		// Fixed, not insets.top: modal sheets start below the status bar
		paddingTop: 12,
		paddingBottom: 10,
	},
	glassButton: {
		width: 42,
		height: 42,
		borderRadius: 21,
		borderCurve: "continuous",
	},
	glassPressable: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	title: {
		fontSize: 17,
		fontWeight: "700",
		color: colors.label,
	},
	samples: {
		flexDirection: "row",
		justifyContent: "center",
		gap: 8,
		paddingVertical: 8,
	},
	sampleChip: {
		paddingHorizontal: 16,
		paddingVertical: 7,
		borderRadius: 16,
		backgroundColor: colors.gray6,
	},
	sampleChipActive: {
		backgroundColor: colors.blue,
	},
	sampleLabel: {
		fontSize: 14,
		fontWeight: "600",
		color: colors.secondaryLabel,
	},
	sampleLabelActive: {
		color: "#FFFFFF",
	},
	transcript: {
		flex: 1,
		justifyContent: "flex-end",
		paddingHorizontal: 12,
		paddingBottom: 16,
		gap: 2,
	},
	rowSent: {
		alignItems: "flex-end",
	},
	rowReceived: {
		alignItems: "flex-start",
	},
	bubbleText: {
		fontSize: type.body.fontSize,
		lineHeight: type.body.lineHeight,
	},
	bubbleTextSent: {
		color: colors.sentText,
	},
	bubbleTextReceived: {
		color: colors.receivedText,
	},
	inputBarWrapper: {
		position: "relative",
	},
	inputFade: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		height: 130,
	},
	liveStatus: {
		fontSize: 13,
		color: colors.secondaryLabel,
		textAlign: "center",
		marginHorizontal: 12,
		marginTop: 4,
		marginBottom: 2,
		paddingVertical: 14,
		backgroundColor: colors.gray6,
		borderRadius: 16,
		borderCurve: "continuous",
		overflow: "hidden",
	},
});
