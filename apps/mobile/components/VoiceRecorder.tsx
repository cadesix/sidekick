import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Audio, type AVPlaybackStatus } from "expo-av";
import { Play, Square, X } from "lucide-react-native";
import {
  bucketWaveform,
  formatDuration,
  meteringToAmplitude,
} from "~/features/chat/attachments";
import { Waveform } from "./Waveform";

const BARS = 24;

export type RecordedVoice = { uri: string; durationMs: number };

function PulseDot() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.2, { duration: 600, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#E11D48" }, style]} />;
}

/**
 * The tap-tap voice recorder (09 §voice recording — hold-to-record deliberately
 * rejected). Replaces the input row while active: a pulsing dot, elapsed time, a
 * live metering waveform, and a stop button; then a preview (play / waveform /
 * duration) with discard + send.
 *
 * `Audio.Recording` / `Audio.Sound` are imperative native handles kept in refs —
 * the expo-av pattern, and the one sanctioned exception to the no-ref guideline.
 */
export function VoiceRecorder({
  onCancel,
  onComplete,
}: {
  onCancel: () => void;
  onComplete: (voice: RecordedVoice) => void;
}) {
  const recording = useRef<Audio.Recording | null>(null);
  const preview = useRef<Audio.Sound | null>(null);
  const [amplitudes, setAmplitudes] = useState<number[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [recorded, setRecorded] = useState<RecordedVoice | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  useEffect(() => {
    async function start(): Promise<void> {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        onCancel();
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      rec.setOnRecordingStatusUpdate((status) => {
        setDurationMs(status.durationMillis ?? 0);
        if (status.metering !== undefined) {
          setAmplitudes((prev) => [...prev, meteringToAmplitude(status.metering ?? -60)]);
        }
      });
      rec.setProgressUpdateInterval(80);
      await rec.startAsync();
      recording.current = rec;
    }
    void start();
    return () => {
      void recording.current?.stopAndUnloadAsync().catch(() => {});
      void preview.current?.unloadAsync();
    };
  }, [onCancel]);

  async function stop(): Promise<void> {
    const rec = recording.current;
    if (!rec) {
      return;
    }
    await rec.stopAndUnloadAsync();
    const uri = rec.getURI();
    recording.current = null;
    if (uri) {
      setRecorded({ uri, durationMs });
    } else {
      onCancel();
    }
  }

  async function togglePreview(): Promise<void> {
    if (!recorded) {
      return;
    }
    if (!preview.current) {
      const created = await Audio.Sound.createAsync({ uri: recorded.uri }, {}, (status: AVPlaybackStatus) => {
        if (status.isLoaded) {
          setPreviewPlaying(status.isPlaying);
          if (status.didJustFinish) {
            setPreviewPlaying(false);
          }
        }
      });
      preview.current = created.sound;
    }
    if (previewPlaying) {
      await preview.current.pauseAsync();
      return;
    }
    await preview.current.setPositionAsync(0);
    await preview.current.playAsync();
  }

  const liveBars = bucketWaveform(amplitudes.slice(-BARS * 3), BARS);

  return (
    <View
      className="flex-row items-center gap-3 px-4 pt-2 pb-2 border-t border-ink/10"
      style={{ minHeight: 56 }}
    >
      <Pressable onPress={onCancel} accessibilityLabel="Discard recording" className="active:opacity-60">
        <X size={22} color="rgba(17,17,17,0.5)" strokeWidth={2.5} />
      </Pressable>

      {recorded === null ? (
        <>
          <PulseDot />
          <Text className="text-[15px] text-ink tabular-nums w-10">{formatDuration(durationMs)}</Text>
          <View className="flex-1 items-start">
            <Waveform bars={liveBars} />
          </View>
          <Pressable
            onPress={() => void stop()}
            className="w-11 h-11 rounded-full bg-ink items-center justify-center active:opacity-80"
            accessibilityLabel="Stop recording"
          >
            <Square size={16} color="#fff" strokeWidth={2.5} fill="#fff" />
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            onPress={() => void togglePreview()}
            className="w-8 h-8 rounded-full bg-ink items-center justify-center active:opacity-80"
            accessibilityLabel="Play recording"
          >
            <Play size={15} color="#fff" strokeWidth={2.5} fill="#fff" />
          </Pressable>
          <View className="flex-1 items-start">
            <Waveform bars={bucketWaveform(amplitudes, BARS)} />
          </View>
          <Text className="text-[12px] font-medium text-ink/60 w-9">{formatDuration(recorded.durationMs)}</Text>
          <Pressable
            onPress={() => onComplete(recorded)}
            className="w-11 h-11 rounded-full bg-sun items-center justify-center active:opacity-80"
            accessibilityLabel="Send voice message"
          >
            <View className="w-0 h-0" />
            <Text className="text-white text-[18px] font-bold">↑</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
