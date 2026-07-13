import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { colors } from "../theme";
import type { Thread } from "../types";
import { Avatar } from "./Avatar";

export const CHAT_HEADER_CONTENT_HEIGHT = 108;

interface ChatHeaderProps {
	thread: Thread;
	onPressContact: () => void;
	replyActive: boolean;
	onExitReply: () => void;
}

// iOS 26: no opaque bar — a scroll-edge fade keeps the floating circular
// glass buttons and the contact chip legible over the scrolling transcript.
// While composing a reply the settings button becomes an X that exits the
// focused reply mode.
export function ChatHeader({
	thread,
	onPressContact,
	replyActive,
	onExitReply,
}: ChatHeaderProps) {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	return (
		<View style={styles.container} pointerEvents="box-none">
			<LinearGradient
				colors={["rgba(255,255,255,0.96)", "rgba(255,255,255,0.82)", "rgba(255,255,255,0)"]}
				locations={[0, 0.55, 1]}
				style={[styles.fade, { height: insets.top + CHAT_HEADER_CONTENT_HEIGHT + 22 }]}
				pointerEvents="none"
			/>
			<View style={[styles.content, { marginTop: insets.top }]} pointerEvents="box-none">
				<GlassView isInteractive glassEffectStyle="regular" style={styles.glassButton}>
					<Pressable
						hitSlop={12}
						onPress={() => router.back()}
						style={styles.glassPressable}
					>
						<SymbolView name="chevron.left" size={20} weight="semibold" tintColor={colors.blue} />
					</Pressable>
				</GlassView>
				<Pressable onPress={onPressContact} style={styles.contact} hitSlop={8}>
					<Avatar
						initials={thread.avatarInitials ?? thread.name.slice(0, 1)}
						size={54}
					/>
					<GlassView glassEffectStyle="regular" style={styles.chip}>
						<View style={styles.chipNameRow}>
							<Text numberOfLines={1} style={styles.chipName}>
								{thread.name}
							</Text>
							<SymbolView
								name="chevron.right"
								size={10}
								weight="bold"
								tintColor={colors.gray}
							/>
						</View>
						{thread.subtitle ? (
							<Text numberOfLines={1} style={styles.chipSubtitle}>
								{thread.subtitle}
							</Text>
						) : null}
					</GlassView>
				</Pressable>
				<GlassView isInteractive glassEffectStyle="regular" style={styles.glassButton}>
					{replyActive ? (
						<Pressable hitSlop={12} onPress={onExitReply} style={styles.glassPressable}>
							<SymbolView name="xmark" size={18} weight="semibold" tintColor={colors.blue} />
						</Pressable>
					) : (
						<Pressable
							hitSlop={12}
							onPress={() => router.push("/settings")}
							style={styles.glassPressable}
						>
							<SymbolView name="ellipsis" size={20} weight="semibold" tintColor={colors.blue} />
						</Pressable>
					)}
				</GlassView>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 10,
	},
	fade: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
	},
	content: {
		height: CHAT_HEADER_CONTENT_HEIGHT,
		flexDirection: "row",
		alignItems: "flex-start",
		justifyContent: "space-between",
		paddingHorizontal: 12,
	},
	glassButton: {
		width: 42,
		height: 42,
		borderRadius: 21,
		marginTop: 2,
	},
	glassPressable: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	contact: {
		alignItems: "center",
		gap: 5,
	},
	chip: {
		alignItems: "center",
		maxWidth: 210,
		paddingHorizontal: 14,
		paddingVertical: 6,
		borderRadius: 16,
		borderCurve: "continuous",
	},
	chipNameRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 3,
	},
	chipName: {
		fontSize: 16,
		fontWeight: "700",
		color: colors.label,
	},
	chipSubtitle: {
		fontSize: 13,
		color: colors.secondaryLabel,
	},
});
