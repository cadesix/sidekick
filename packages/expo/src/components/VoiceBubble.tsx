import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Audio, type AVPlaybackStatus } from "expo-av";
import { Pause, Play } from "lucide-react-native";
import { formatDuration, playedBarCount, pseudoWaveform } from "~/features/chat/attachments";
import { Waveform } from "./Waveform";

const USER_CORNERS = { borderRadius: 24, borderBottomRightRadius: 6 } as const;
const BARS = 24;

/**
 * Voice message bubble (09 §voice bubble): a 32px ink play/pause circle, a static
 * waveform whose played portion fills ink, the duration, and a "view transcript"
 * link that reveals the transcript as body text in the same bubble.
 *
 * The `Audio.Sound` handle is an imperative native resource that must persist
 * across renders and is not derived from props/state — a `ref` is expo-av's
 * sanctioned pattern for it (the one place the no-ref guideline yields).
 */
export function VoiceBubble({
  url,
  durationMs,
  transcript,
}: {
  url: string;
  durationMs: number | null;
  transcript: string | null;
}) {
  const sound = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);

  const total = durationMs ?? 0;
  const bars = pseudoWaveform(url, BARS);

  useEffect(() => {
    return () => {
      void sound.current?.unloadAsync();
    };
  }, []);

  function onStatus(status: AVPlaybackStatus): void {
    if (!status.isLoaded) {
      return;
    }
    setPositionMs(status.positionMillis);
    setPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
      void sound.current?.setPositionAsync(0);
    }
  }

  async function toggle(): Promise<void> {
    if (!sound.current) {
      const created = await Audio.Sound.createAsync({ uri: url }, { progressUpdateIntervalMillis: 80 }, onStatus);
      sound.current = created.sound;
    }
    if (playing) {
      await sound.current.pauseAsync();
      return;
    }
    await sound.current.playAsync();
  }

  const displayMs = playing || positionMs > 0 ? positionMs : total;

  return (
    <View className="self-end max-w-[80%]">
      <View className="bg-usergray px-3 py-2.5" style={USER_CORNERS}>
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={() => void toggle()}
            className="w-8 h-8 rounded-full bg-ink items-center justify-center active:opacity-80"
            accessibilityRole="button"
            accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
          >
            {playing ? (
              <Pause size={15} color="#fff" strokeWidth={2.5} fill="#fff" />
            ) : (
              <Play size={15} color="#fff" strokeWidth={2.5} fill="#fff" />
            )}
          </Pressable>
          <Waveform bars={bars} playedCount={playedBarCount(positionMs, total, BARS)} />
          <Text className="text-[12px] font-medium text-ink/60">{formatDuration(displayMs)}</Text>
        </View>
        {showTranscript && transcript ? (
          <Text className="text-[15px] leading-[1.375] text-ink mt-2">{transcript}</Text>
        ) : null}
      </View>
      {transcript ? (
        <Pressable onPress={() => setShowTranscript((v) => !v)} className="self-end mt-1 active:opacity-60">
          <Text className="text-[12px] font-medium text-ink/40">
            {showTranscript ? "hide transcript" : "view transcript"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
