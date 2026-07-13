import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text } from "react-native";
import { colors } from "../theme";

interface AvatarProps {
	initials: string;
	size: number;
	colorTop?: string;
	colorBottom?: string;
}

export function Avatar({ initials, size, colorTop, colorBottom }: AvatarProps) {
	return (
		<LinearGradient
			colors={[colorTop ?? colors.monogramTop, colorBottom ?? colors.monogramBottom]}
			style={[
				styles.circle,
				{ width: size, height: size, borderRadius: size / 2 },
			]}
		>
			<Text
				allowFontScaling={false}
				style={[styles.initials, { fontSize: size * 0.42 }]}
			>
				{initials}
			</Text>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	circle: {
		alignItems: "center",
		justifyContent: "center",
	},
	initials: {
		color: "#FFFFFF",
		fontWeight: "500",
	},
});
