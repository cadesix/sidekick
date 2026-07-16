import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, {
	type EntryAnimationsValues,
	type ExitAnimationsValues,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { colors } from "../theme";
import { Glass } from "./Glass";
import { Icon, type IconName } from "./Icon";

interface DrawerItem {
	key: string;
	label: string;
	icon: IconName;
}

const ITEMS: DrawerItem[] = [
	{ key: "camera", label: "Camera", icon: "camera" },
	{ key: "photos", label: "Photos", icon: "photo" },
	{ key: "stickers", label: "Stickers", icon: "smile" },
	{ key: "audio", label: "Audio", icon: "audio" },
	{ key: "location", label: "Location", icon: "location" },
	{ key: "more", label: "More", icon: "ellipsis" },
];

interface PlusDrawerProps {
	onSelectAudio: () => void;
	onClose: () => void;
}

// The whole panel grows out of the plus button as one piece, rather than the
// rows animating in one by one.
const drawerEnter = (_values: EntryAnimationsValues) => {
	"worklet";
	return {
		initialValues: {
			opacity: 0,
			transform: [{ scale: 0.82 }, { translateY: 10 }],
		},
		animations: {
			opacity: withTiming(1, { duration: 140 }),
			transform: [
				{ scale: withSpring(1, { duration: 420, dampingRatio: 0.72 }) },
				{ translateY: withSpring(0, { duration: 420, dampingRatio: 0.72 }) },
			],
		},
	};
};

const drawerExit = (_values: ExitAnimationsValues) => {
	"worklet";
	return {
		initialValues: {
			opacity: 1,
			transform: [{ scale: 1 }, { translateY: 0 }],
		},
		animations: {
			opacity: withTiming(0, { duration: 130 }),
			transform: [
				{ scale: withTiming(0.9, { duration: 130 }) },
				{ translateY: withTiming(8, { duration: 130 }) },
			],
		},
	};
};

// NativeWind's css-interop drops FUNCTION-form Pressable styles, so the pressed
// tint is tracked in state rather than via `({ pressed }) => ...`.
function DrawerRow({ item, onPress }: { item: DrawerItem; onPress: () => void }) {
	const [pressed, setPressed] = useState(false);
	return (
		<Pressable
			style={[styles.item, pressed ? styles.itemPressed : null]}
			onPressIn={() => setPressed(true)}
			onPressOut={() => setPressed(false)}
			onPress={onPress}
		>
			<Icon name={item.icon} size={22} color={colors.label} />
			<Text style={styles.label}>{item.label}</Text>
		</Pressable>
	);
}

// The iOS 26 plus menu: a Liquid Glass sheet floating just above the plus
// button, riding the keyboard with the input bar.
export function PlusDrawer({ onSelectAudio, onClose }: PlusDrawerProps) {
	return (
		<Animated.View entering={drawerEnter} exiting={drawerExit} style={styles.container}>
			<Glass style={styles.panel}>
				{ITEMS.map((item) => (
					<DrawerRow
						key={item.key}
						item={item}
						onPress={() => {
							Haptics.selectionAsync();
							if (item.key === "audio") {
								onSelectAudio();
								return;
							}
							onClose();
						}}
					/>
				))}
			</Glass>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	container: {
		position: "absolute",
		left: 12,
		bottom: "100%",
		marginBottom: 4,
		zIndex: 30,
		transformOrigin: "bottom left",
		shadowColor: "#000000",
		shadowOpacity: 0.12,
		shadowRadius: 24,
		shadowOffset: { width: 0, height: 8 },
	},
	panel: {
		paddingVertical: 8,
		paddingHorizontal: 8,
		minWidth: 218,
		borderRadius: 26,
		borderCurve: "continuous",
	},
	item: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		paddingVertical: 11,
		paddingHorizontal: 12,
		borderRadius: 18,
	},
	itemPressed: {
		backgroundColor: "rgba(120,120,128,0.12)",
	},
	label: {
		fontSize: 17,
		color: colors.label,
	},
});
