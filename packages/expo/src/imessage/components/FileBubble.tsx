import { StyleSheet, Text, View } from "react-native";
import { fileTypeLabel, formatBytes, truncateFilename } from "../lib/attachments";
import { colors } from "../theme";
import type { FileAttachment } from "../types";
import { Icon } from "./Icon";

/**
 * File message content (09 §file bubble), rendered inside the normal message
 * bubble: doc glyph + filename + a `PDF · 2.3 MB` caption.
 */
export function FileBubble({ file, sent }: { file: FileAttachment; sent: boolean }) {
	const tint = sent ? "#FFFFFF" : colors.label;
	const caption = sent ? "rgba(255,255,255,0.8)" : colors.secondaryLabel;
	return (
		<View style={styles.row}>
			<View style={[styles.iconHolder, { backgroundColor: sent ? "rgba(255,255,255,0.25)" : colors.gray4 }]}>
				<Icon name="doc" size={20} color={tint} />
			</View>
			<View style={styles.info}>
				<Text style={[styles.name, { color: tint }]} numberOfLines={1}>
					{truncateFilename(file.filename, 28)}
				</Text>
				<Text style={[styles.caption, { color: caption }]}>
					{fileTypeLabel(file.mime, file.filename)} · {formatBytes(file.bytes)}
				</Text>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		paddingVertical: 3,
		minWidth: 170,
	},
	iconHolder: {
		width: 38,
		height: 38,
		borderRadius: 19,
		alignItems: "center",
		justifyContent: "center",
	},
	info: {
		flexShrink: 1,
	},
	name: {
		fontSize: 15,
		fontWeight: "600",
	},
	caption: {
		fontSize: 12,
		marginTop: 1,
	},
});
