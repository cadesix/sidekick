import { useContext } from "react";
import { FLOATING_META_COLOR, FloatingChat } from "../floating-chat";
import { StyleSheet, Text } from "react-native";
import { colors, font, type } from "../theme";

export function TimestampSeparator({ day, time }: { day: string; time: string }) {
	const floating = useContext(FloatingChat);
	return (
		<Text style={[styles.label, floating ? styles.light : null]}>
			<Text style={[styles.day, floating ? styles.light : null]}>{day}</Text> {time}
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
	light: {
		color: FLOATING_META_COLOR,
	},
});
