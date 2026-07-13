import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	Easing,
	cancelAnimation,
	interpolateColor,
	runOnJS,
	type SharedValue,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import { formatDuration } from "../lib/time";
import { colors } from "../theme";
import type { AudioAttachment } from "../types";

export const WAVEFORM_BAR_COUNT = 36;
export const WAVEFORM_BAR_WIDTH = 2.5;
export const WAVEFORM_BAR_GAP = 1.5;
export const WAVEFORM_BAR_PITCH = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
export const WAVEFORM_MIN_BAR = 3;

/** How many bars of pitch `WAVEFORM_BAR_PITCH` fit in `width` (the last bar needs no trailing gap). */
export function waveformBarCount(width: number): number {
	return Math.max(1, Math.floor((width + WAVEFORM_BAR_GAP) / WAVEFORM_BAR_PITCH));
}

/** Playback for one clip: play/pause (replaying from the top once it has ended) and seeking. */
export function usePlayback(uri: string, durationSec: number) {
	const player = useAudioPlayer(uri);
	const status = useAudioPlayerStatus(player);
	const ended = status.didJustFinish || status.currentTime >= durationSec - 0.05;

	const toggle = async () => {
		if (status.playing) {
			player.pause();
			return;
		}
		if (ended) {
			await player.seekTo(0);
		}
		player.play();
	};

	const seek = (seconds: number) => {
		player.seekTo(seconds).catch(() => undefined);
	};

	return { playing: status.playing, currentTime: status.currentTime, toggle, seek };
}

interface WaveformProps {
	samples: number[];
	playing: boolean;
	currentTime: number;
	durationSec: number;
	onSeek: (seconds: number) => void;
	playedColor: string;
	unplayedColor: string;
	height?: number;
}

const fractionAt = (x: number, width: number): number => {
	"worklet";
	if (width <= 0) {
		return 0;
	}
	return Math.min(1, Math.max(0, x / width));
};

/** Crossfades as the playhead sweeps across it, so the fill glides rather than snapping bar to bar. */
function PlaybackBar({
	sample,
	index,
	count,
	height,
	progress,
	playedColor,
	unplayedColor,
}: {
	sample: number;
	index: number;
	count: number;
	height: number;
	progress: SharedValue<number>;
	playedColor: string;
	unplayedColor: string;
}) {
	const animated = useAnimatedStyle(() => {
		const swept = Math.min(1, Math.max(0, progress.value * count - index));
		return { backgroundColor: interpolateColor(swept, [0, 1], [unplayedColor, playedColor]) };
	});
	return (
		<Animated.View
			style={[
				{
					width: WAVEFORM_BAR_WIDTH,
					borderRadius: WAVEFORM_BAR_WIDTH / 2,
					height: Math.max(WAVEFORM_MIN_BAR, sample * height),
				},
				animated,
			]}
		/>
	);
}

export function Waveform({
	samples,
	playing,
	currentTime,
	durationSec,
	onSeek,
	playedColor,
	unplayedColor,
	height = 26,
}: WaveformProps) {
	const progress = useSharedValue(0);
	const width = useSharedValue(0);
	const [scrubbing, setScrubbing] = useState(false);
	const [seekTarget, setSeekTarget] = useState<number | null>(null);

	// A seek takes a beat to land, so the fill is held at where it was dropped
	// until the player reports it — otherwise it snaps back to the old time.
	const landed = seekTarget === null || Math.abs(currentTime - seekTarget) < 0.3;
	const time = landed ? currentTime : seekTarget;

	useEffect(() => {
		if (landed && seekTarget !== null) {
			setSeekTarget(null);
		}
	}, [landed, seekTarget]);

	// The player only reports its time every few hundred ms, so the fill is run as
	// its own linear animation to the end of the clip and re-synced on each report.
	useEffect(() => {
		if (scrubbing) {
			return;
		}
		cancelAnimation(progress);
		progress.value = Math.min(1, time / Math.max(0.1, durationSec));
		if (playing) {
			progress.value = withTiming(1, {
				duration: Math.max(0, (durationSec - time) * 1000),
				easing: Easing.linear,
			});
		}
	}, [playing, time, durationSec, scrubbing, progress]);

	const dropAt = (fraction: number) => {
		const seconds = fraction * durationSec;
		setSeekTarget(seconds);
		setScrubbing(false);
		onSeek(seconds);
	};

	// Scrub with a drag, jump with a tap. The drag beats the row's swipe-to-reply
	// (which needs 22px) but leaves its long-press for tapbacks alone.
	const drag = Gesture.Pan()
		.activeOffsetX([-8, 8])
		.failOffsetY([-12, 12])
		.onStart(() => {
			cancelAnimation(progress);
			runOnJS(setScrubbing)(true);
		})
		.onUpdate((event) => {
			progress.value = fractionAt(event.x, width.value);
		})
		.onEnd((event) => {
			runOnJS(dropAt)(fractionAt(event.x, width.value));
		});

	const jump = Gesture.Tap().onEnd((event) => {
		runOnJS(dropAt)(fractionAt(event.x, width.value));
	});

	return (
		<GestureDetector gesture={Gesture.Race(drag, jump)}>
			<View
				style={[styles.waveform, { height }]}
				hitSlop={{ top: 10, bottom: 10 }}
				onLayout={(event) => {
					width.value = event.nativeEvent.layout.width;
				}}
			>
				{samples.map((sample, index) => (
					<PlaybackBar
						key={index}
						sample={sample}
						index={index}
						count={samples.length}
						height={height}
						progress={progress}
						playedColor={playedColor}
						unplayedColor={unplayedColor}
					/>
				))}
			</View>
		</GestureDetector>
	);
}

interface AudioBubbleProps {
	audio: AudioAttachment;
	sent: boolean;
}

export function AudioBubble({ audio, sent }: AudioBubbleProps) {
	const { playing, currentTime, toggle, seek } = usePlayback(audio.uri, audio.durationSec);

	const tint = sent ? "#FFFFFF" : "rgba(60,60,67,0.7)";
	const playedColor = sent ? "#FFFFFF" : colors.blue;
	const unplayedColor = sent ? "rgba(255,255,255,0.4)" : colors.gray2;
	const remaining = playing
		? Math.max(0, audio.durationSec - currentTime)
		: audio.durationSec;

	return (
		<View style={styles.container}>
			<Pressable onPress={toggle} hitSlop={8}>
				<SymbolView
					name={playing ? "pause.fill" : "play.fill"}
					size={20}
					tintColor={tint}
				/>
			</Pressable>
			<Waveform
				samples={audio.waveform}
				playing={playing}
				currentTime={currentTime}
				durationSec={audio.durationSec}
				onSeek={seek}
				playedColor={playedColor}
				unplayedColor={unplayedColor}
			/>
			<Text
				style={[
					styles.duration,
					{ color: sent ? "rgba(255,255,255,0.8)" : colors.secondaryLabel },
				]}
			>
				{formatDuration(remaining)}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingVertical: 4,
		paddingHorizontal: 2,
	},
	waveform: {
		flexDirection: "row",
		alignItems: "center",
		gap: WAVEFORM_BAR_GAP,
	},
	duration: {
		fontSize: 13,
		fontVariant: ["tabular-nums"],
		minWidth: 32,
		textAlign: "right",
	},
});
