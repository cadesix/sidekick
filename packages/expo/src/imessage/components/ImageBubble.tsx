import { Image } from "expo-image";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Gallery from "react-native-awesome-gallery";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { bubble } from "../theme";
import type { ImageAttachment } from "../types";
import { Icon } from "./Icon";

const MAX_WIDTH = 240;
const MAX_SINGLE_HEIGHT = 320;
const GRID_GAP = 3;

/** A single photo keeps its aspect ratio inside the 240×320 box. */
function singleSize(image: ImageAttachment): { width: number; height: number } {
	if (!image.width || !image.height) {
		return { width: MAX_WIDTH, height: MAX_WIDTH };
	}
	const scale = Math.min(MAX_WIDTH / image.width, MAX_SINGLE_HEIGHT / image.height, 1);
	return { width: image.width * scale, height: image.height * scale };
}

/**
 * Photo message content (09 §image bubble): the image itself with the bubble's
 * corner rounding and no gray backing; 2–4 photos become a 2-col grid. Tap
 * opens a black full-screen pinch-zoom viewer.
 */
export function ImageBubble({ images }: { images: ImageAttachment[] }) {
	const insets = useSafeAreaInsets();
	const [viewerIndex, setViewerIndex] = useState<number | null>(null);

	const single = images.length === 1;
	const cell = (MAX_WIDTH - GRID_GAP) / 2;

	return (
		<View style={{ maxWidth: MAX_WIDTH }}>
			<View style={styles.grid}>
				{images.map((image, index) => (
					<Pressable
						key={image.uri}
						onPress={() => setViewerIndex(index)}
						accessibilityRole="imagebutton"
						accessibilityLabel="Open photo"
					>
						<Image
							source={{ uri: image.uri }}
							style={[
								styles.image,
								single ? singleSize(image) : { width: cell, height: cell },
							]}
							contentFit="cover"
						/>
					</Pressable>
				))}
			</View>

			<Modal
				visible={viewerIndex !== null}
				transparent
				onRequestClose={() => setViewerIndex(null)}
			>
				<View style={styles.viewer}>
					<Gallery
						data={images.map((image) => image.uri)}
						initialIndex={viewerIndex ?? 0}
						onSwipeToClose={() => setViewerIndex(null)}
					/>
					<Animated.View
						entering={FadeIn}
						style={[styles.closeHolder, { top: insets.top + 8 }]}
					>
						<Pressable
							onPress={() => setViewerIndex(null)}
							style={styles.closeButton}
							accessibilityLabel="Close photo viewer"
						>
							<Icon name="xmark" size={18} color="#000000" strokeWidth={2.5} />
						</Pressable>
					</Animated.View>
				</View>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	grid: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "flex-end",
		gap: GRID_GAP,
	},
	image: {
		borderRadius: bubble.radius,
		borderCurve: "continuous",
	},
	viewer: {
		flex: 1,
		backgroundColor: "#000000",
	},
	closeHolder: {
		position: "absolute",
		left: 16,
	},
	closeButton: {
		width: 38,
		height: 38,
		borderRadius: 19,
		backgroundColor: "rgba(255,255,255,0.9)",
		alignItems: "center",
		justifyContent: "center",
	},
});
