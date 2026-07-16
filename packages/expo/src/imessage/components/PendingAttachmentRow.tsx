import { Image } from "expo-image";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { type PendingAttachment, truncateFilename } from "../lib/attachments";
import { colors } from "../theme";
import { Icon } from "./Icon";

function RemoveBadge({ onPress }: { onPress: () => void }) {
	return (
		<Pressable
			onPress={onPress}
			hitSlop={6}
			style={styles.removeBadge}
			accessibilityLabel="Remove attachment"
		>
			<Icon name="xmark" size={10} color="#FFFFFF" strokeWidth={3} />
		</Pressable>
	);
}

/**
 * Picked attachments waiting above the input bar (09 §composer): image
 * thumbnails and file pills, dimmed with a spinner until ingest finishes; a
 * failed chip's caption becomes the tappable retry line.
 */
export function PendingAttachmentRow({
	attachments,
	error,
	onRemove,
	onRetry,
}: {
	attachments: PendingAttachment[];
	error: string | null;
	onRemove: (id: string) => void;
	onRetry: (id: string) => void;
}) {
	if (attachments.length === 0 && error === null) {
		return null;
	}
	const failed = attachments.filter((attachment) => attachment.status === "failed");
	return (
		<Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(150)}>
			{attachments.length > 0 ? (
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					contentContainerStyle={styles.chips}
				>
					{attachments.map((attachment) => {
						const settling =
							attachment.status === "uploading" || attachment.status === "processing";
						return (
							<View key={attachment.id}>
								{attachment.kind === "image" ? (
									<Image
										source={{ uri: attachment.localUri }}
										style={[styles.thumbnail, settling ? styles.dimmed : null]}
										contentFit="cover"
									/>
								) : (
									<View style={[styles.pill, settling ? styles.dimmed : null]}>
										<Icon name="doc" size={15} color={colors.label} />
										<Text style={styles.pillText} numberOfLines={1}>
											{truncateFilename(attachment.filename, 18)}
										</Text>
									</View>
								)}
								{settling ? (
									<View style={styles.spinner} pointerEvents="none">
										<ActivityIndicator size="small" color={colors.gray} />
									</View>
								) : null}
								<RemoveBadge onPress={() => onRemove(attachment.id)} />
							</View>
						);
					})}
				</ScrollView>
			) : null}
			{failed.map((attachment) => (
				<Pressable key={attachment.id} onPress={() => onRetry(attachment.id)} hitSlop={4}>
					<Text style={styles.errorText}>
						couldn’t send {truncateFilename(attachment.filename, 24)} — tap to try again
					</Text>
				</Pressable>
			))}
			{error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	chips: {
		gap: 10,
		alignItems: "center",
		paddingHorizontal: 14,
		paddingTop: 8,
		paddingBottom: 4,
	},
	thumbnail: {
		width: 56,
		height: 56,
		borderRadius: 12,
	},
	pill: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		height: 34,
		paddingHorizontal: 12,
		borderRadius: 17,
		backgroundColor: colors.gray5,
	},
	pillText: {
		fontSize: 13,
		fontWeight: "500",
		color: colors.label,
		maxWidth: 150,
	},
	dimmed: {
		opacity: 0.5,
	},
	spinner: {
		...StyleSheet.absoluteFillObject,
		alignItems: "center",
		justifyContent: "center",
	},
	removeBadge: {
		position: "absolute",
		top: -5,
		right: -5,
		width: 18,
		height: 18,
		borderRadius: 9,
		backgroundColor: colors.gray,
		alignItems: "center",
		justifyContent: "center",
	},
	errorText: {
		fontSize: 12,
		fontWeight: "500",
		color: colors.red,
		paddingHorizontal: 16,
		paddingBottom: 4,
	},
});
