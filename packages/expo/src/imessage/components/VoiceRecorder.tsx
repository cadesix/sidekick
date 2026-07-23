import {
	AudioModule,
	RecordingPresets,
	setAudioModeAsync,
	useAudioRecorder,
	useAudioRecorderState,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import { type ReactNode, useEffect, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { formatDuration } from "../lib/time";
import { colors, font } from "../theme";
import { Glass } from "./Glass";
import { Icon } from "./Icon";
import type { AudioAttachment } from "../types";
import {
	WAVEFORM_BAR_COUNT,
	WAVEFORM_BAR_GAP,
	WAVEFORM_BAR_WIDTH,
	WAVEFORM_MIN_BAR,
	Waveform,
	usePlayback,
	waveformBarCount,
} from "./AudioBubble";

const RECORDING_ORANGE = "#FF9500";
const WAVEFORM_HEIGHT = 22;

/** Metering poll interval. Also the beat the bars animate on, so they flow rather than step. */
const METER_INTERVAL_MS = 50;

/** Weight of each new meter reading against the previous one; damps the mic's jitter. */
const METER_SMOOTHING = 0.45;

const normalizeMeter = (db: number | undefined): number => {
	if (db === undefined) {
		return 0.15;
	}
	return Math.min(1, Math.max(0.08, (db + 50) / 50));
};

const downsample = (samples: number[], buckets: number): number[] => {
	if (samples.length === 0) {
		return Array.from({ length: buckets }, () => 0.2);
	}
	const result: number[] = [];
	for (let i = 0; i < buckets; i += 1) {
		const start = Math.floor((i * samples.length) / buckets);
		const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / buckets));
		const slice = samples.slice(start, end);
		result.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
	}
	return result;
};

/** Keeps the waveform full-width from the first frame: history sits at the right, flat bars fill the rest. */
const padToWidth = (samples: number[], bars: number): number[] => {
	const tail = samples.slice(-bars);
	return [...Array.from({ length: bars - tail.length }, () => 0), ...tail];
};

/** A bar that eases to its new height instead of jumping, so the waveform reads as one flowing wave. */
function LiveBar({ level, color }: { level: number; color: string }) {
	const animated = useAnimatedStyle(() => ({
		height: withTiming(Math.max(WAVEFORM_MIN_BAR, level * WAVEFORM_HEIGHT), {
			duration: METER_INTERVAL_MS * 2,
			easing: Easing.out(Easing.quad),
		}),
	}));
	return <Animated.View style={[styles.liveBar, { backgroundColor: color }, animated]} />;
}

/** Measures itself so the waveform spans the whole input, however wide it ends up. */
function MeasuredWaveform({
	children,
}: {
	children: (bars: number) => ReactNode;
}) {
	const [width, setWidth] = useState(0);
	const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
	return (
		<View style={styles.waveformHolder} onLayout={onLayout}>
			{width === 0 ? null : children(waveformBarCount(width))}
		</View>
	);
}

interface VoiceRecorderProps {
	onCancel: () => void;
	onSend: (audio: AudioAttachment) => void;
}

interface Preview {
	uri: string;
	durationSec: number;
	samples: number[];
}

function PreviewBar({
	preview,
	onSend,
}: {
	preview: Preview;
	onSend: () => void;
}) {
	const { playing, currentTime, toggle, seek } = usePlayback(preview.uri, preview.durationSec);

	return (
		<Glass style={styles.bar}>
			<Pressable hitSlop={8} onPress={toggle} style={styles.playButton}>
				<Icon name={playing ? "pause" : "play"} size={19} color={colors.blue} filled />
			</Pressable>
			<MeasuredWaveform>
				{(bars) => (
					<Waveform
						samples={downsample(preview.samples, bars)}
						playing={playing}
						currentTime={currentTime}
						durationSec={preview.durationSec}
						onSeek={seek}
						playedColor={colors.blue}
						unplayedColor={colors.gray3}
						height={WAVEFORM_HEIGHT}
					/>
				)}
			</MeasuredWaveform>
			<Text style={styles.timer}>{formatDuration(preview.durationSec)}</Text>
			<Pressable onPress={onSend} style={styles.sendButton} hitSlop={6}>
				<Icon name="arrowUp" size={16} color="#FFFFFF" strokeWidth={3} />
			</Pressable>
		</Glass>
	);
}

export function VoiceRecorder({ onCancel, onSend }: VoiceRecorderProps) {
	const recorder = useAudioRecorder({
		...RecordingPresets.HIGH_QUALITY,
		isMeteringEnabled: true,
	});
	const recorderState = useAudioRecorderState(recorder, METER_INTERVAL_MS);
	const [samples, setSamples] = useState<number[]>([]);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const start = async () => {
			const permission = await AudioModule.requestRecordingPermissionsAsync();
			if (!permission.granted) {
				setFailed(true);
				return;
			}
			await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
			if (cancelled) {
				return;
			}
			await recorder.prepareToRecordAsync();
			recorder.record();
		};
		start().catch(() => setFailed(true));
		return () => {
			cancelled = true;
			setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
				() => undefined,
			);
		};
		// The recorder instance is stable for the component lifetime.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!recorderState.isRecording) {
			return;
		}
		const level = normalizeMeter(recorderState.metering);
		setSamples((previous) => {
			const last = previous.at(-1) ?? level;
			return [...previous, last + (level - last) * METER_SMOOTHING];
		});
	}, [recorderState.durationMillis, recorderState.isRecording, recorderState.metering]);

	useEffect(() => {
		if (failed) {
			onCancel();
		}
	}, [failed, onCancel]);

	const stop = async () => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		if (!recorderState.isRecording) {
			recorder.stop().catch(() => undefined);
			onCancel();
			return;
		}
		await recorder.stop();
		const uri = recorder.uri;
		if (!uri) {
			onCancel();
			return;
		}
		setPreview({
			uri,
			durationSec: Math.max(1, Math.round(recorderState.durationMillis / 1000)),
			samples,
		});
	};

	if (preview) {
		return (
			<PreviewBar
				preview={preview}
				onSend={() =>
					onSend({
						uri: preview.uri,
						durationSec: preview.durationSec,
						waveform: downsample(preview.samples, WAVEFORM_BAR_COUNT),
					})
				}
			/>
		);
	}

	return (
		<Glass style={styles.bar}>
			<MeasuredWaveform>
				{(bars) =>
					padToWidth(samples, bars).map((level, index) => (
						<LiveBar key={index} level={level} color={RECORDING_ORANGE} />
					))
				}
			</MeasuredWaveform>
			<Text style={styles.timer}>
				{formatDuration(recorderState.durationMillis / 1000)}
			</Text>
			<Pressable onPress={stop} style={styles.stopButton} hitSlop={6}>
				<View style={styles.stopSquare} />
			</Pressable>
		</Glass>
	);
}

const styles = StyleSheet.create({
	bar: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		height: 40,
		borderRadius: 20,
		borderCurve: "continuous",
		paddingLeft: 14,
		paddingRight: 4,
	},
	playButton: {
		width: 24,
		alignItems: "center",
	},
	// The waveform spans the whole bar; while recording, new samples stream in at
	// the right edge and push the wave leftward, matching iMessage.
	waveformHolder: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: WAVEFORM_BAR_GAP,
		height: WAVEFORM_HEIGHT,
		overflow: "hidden",
	},
	liveBar: {
		width: WAVEFORM_BAR_WIDTH,
		borderRadius: WAVEFORM_BAR_WIDTH / 2,
	},
	timer: {
		fontSize: 13,
		fontFamily: font.regular,
		color: colors.secondaryLabel,
		fontVariant: ["tabular-nums"],
	},
	stopButton: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.red,
		alignItems: "center",
		justifyContent: "center",
	},
	stopSquare: {
		width: 11,
		height: 11,
		borderRadius: 2,
		backgroundColor: "#FFFFFF",
	},
	sendButton: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.blue,
		alignItems: "center",
		justifyContent: "center",
	},
});
