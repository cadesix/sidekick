import { StyleSheet, Text } from "react-native";
import { colors, font, type } from "../theme";

export function TimestampSeparator({ day, time }: { day: string; time: string }) {
	return (
		<Text style={styles.label}>
			<Text style={styles.day}>{day}</Text> {time}
		</Text>
	);
}

const styles = StyleSheet.create({
	label: {
		textAlign: "center",
		marginTop: 18,
		marginBottom: 6,
		fontSize: type.separator.fontSize,
		fontFamily: font.regular,
		color: colors.secondaryLabel,
	},
	day: {
		fontFamily: font.medium,
	},
});
