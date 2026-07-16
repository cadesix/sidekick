import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withDelay,
	withRepeat,
	withSequence,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { colors } from "../theme";
import { MessageBubble } from "./MessageBubble";

const CYCLE = 1150;

function Dot({ index }: { index: number }) {
	const pulse = useSharedValue(0);

	useEffect(() => {
		pulse.value = withDelay(
			index * 180,
			withRepeat(
				withSequence(
					withTiming(1, { duration: CYCLE / 2, easing: Easing.inOut(Easing.ease) }),
					withTiming(0, { duration: CYCLE / 2, easing: Easing.inOut(Easing.ease) }),
				),
				-1,
			),
		);
	}, [index, pulse]);

	const style = useAnimatedStyle(() => ({
		opacity: 0.3 + pulse.value * 0.6,
		transform: [{ scale: 0.82 + pulse.value * 0.18 }],
	}));

	return <Animated.View style={[styles.dot, style]} />;
}

export function TypingIndicator() {
	const scale = useSharedValue(0);

	useEffect(() => {
		scale.value = withSpring(1, { duration: 420, dampingRatio: 0.68 });
	}, [scale]);

	const style = useAnimatedStyle(() => ({
		transform: [{ scale: scale.value }],
	}));

	return (
		<Animated.View style={[styles.container, style]}>
			<MessageBubble from="them" tail>
				<View style={styles.dots}>
					<Dot index={0} />
					<Dot index={1} />
					<Dot index={2} />
				</View>
			</MessageBubble>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	container: {
		alignSelf: "flex-start",
		marginTop: 8,
		transformOrigin: "bottom left",
	},
	dots: {
		flexDirection: "row",
		alignItems: "center",
		gap: 5,
		paddingVertical: 4,
		paddingHorizontal: 1,
	},
	dot: {
		width: 9,
		height: 9,
		borderRadius: 4.5,
		backgroundColor: colors.gray,
	},
});
