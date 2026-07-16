import { Image } from "expo-image";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import {
	fileTypeLabel,
	formatBytes,
	type PendingAttachment,
	truncateFilename,
} from "../lib/attachments";
import { colors } from "../theme";
import { Icon } from "./Icon";

function RemoveBadge({ onPress }: { onPress: () => void }) {
	return (
		<Pressable
			onPress={onPress}
			hitSlop={8}
			style={styles.removeBadge}
			accessibilityLabel="Remove attachment"
		>
			<Icon name="xmark" size={10} color="#FFFFFF" strokeWidth={3} />
		</Pressable>
	);
}

/** An iMessage-style file chip: an icon tile, the filename, and "PDF · 2.3 MB". */
function FileCard({ attachment }: { attachment: PendingAttachment }) {
	return (
		<View style={styles.fileCard}>
			<View style={styles.fileIconTile}>
				<Icon name="doc" size={20} color={colors.blue} />
			</View>
			<View style={styles.fileText}>
				<Text style={styles.fileName} numberOfLines={1}>
					{truncateFilename(attachment.filename, 16)}
				</Text>
				<Text style={styles.fileMeta} numberOfLines={1}>
					{fileTypeLabel(attachment.mime, attachment.filename)} · {formatBytes(attachment.bytes)}
				</Text>
			</View>
		</View>
	);
}

/**
 * Picked attachments waiting above the input bar (09 §composer): image
 * thumbnails and file cards, dimmed with a spinner only while ingest is still
 * settling; a failed chip's caption becomes the tappable retry line.
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
									<View style={settling ? styles.dimmed : null}>
										<FileCard attachment={attachment} />
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

const THUMBNAIL = 62;

const styles = StyleSheet.create({
	chips: {
		gap: 10,
		alignItems: "center",
		paddingHorizontal: 14,
		paddingTop: 10,
		paddingBottom: 4,
	},
	thumbnail: {
		width: THUMBNAIL,
		height: THUMBNAIL,
		borderRadius: 16,
		borderCurve: "continuous",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "rgba(0,0,0,0.08)",
		backgroundColor: colors.gray6,
	},
	fileCard: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		height: THUMBNAIL,
		width: 168,
		paddingHorizontal: 10,
		borderRadius: 16,
		borderCurve: "continuous",
		backgroundColor: colors.gray6,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "rgba(0,0,0,0.08)",
	},
	fileIconTile: {
		width: 40,
		height: 40,
		borderRadius: 10,
		borderCurve: "continuous",
		backgroundColor: "#FFFFFF",
		alignItems: "center",
		justifyContent: "center",
	},
	fileText: {
		flex: 1,
		gap: 2,
	},
	fileName: {
		fontSize: 14,
		fontWeight: "600",
		color: colors.label,
	},
	fileMeta: {
		fontSize: 12,
		color: colors.secondaryLabel,
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
		top: -6,
		right: -6,
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: "rgba(0,0,0,0.55)",
		borderWidth: 1.5,
		borderColor: "#FFFFFF",
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
