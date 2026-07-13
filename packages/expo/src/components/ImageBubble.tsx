import { useState } from "react";
import { Image, Modal, Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Gallery from "react-native-awesome-gallery";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MAX_WIDTH = 240;

/**
 * Image message bubble (09 §image bubble): the image(s) themselves with a 2px ink
 * border, no gray backing. 1 image → up to 240px wide; 2–4 → a 2-col grid with
 * 4px gaps. Tap opens a black full-screen pinch-zoom viewer.
 */
export function ImageBubble({ uris }: { uris: string[] }) {
  const insets = useSafeAreaInsets();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const single = uris.length === 1;

  return (
    <View className="self-end" style={{ maxWidth: MAX_WIDTH }}>
      <View className="flex-row flex-wrap justify-end" style={{ gap: 4 }}>
        {uris.map((uri, index) => (
          <Pressable
            key={uri}
            onPress={() => setViewerIndex(index)}
            style={{
              width: single ? MAX_WIDTH : (MAX_WIDTH - 4) / 2,
              aspectRatio: 1,
            }}
            accessibilityRole="imagebutton"
            accessibilityLabel="Open image"
          >
            <Image
              source={{ uri }}
              className="w-full h-full rounded-2xl border-2 border-ink"
              resizeMode="cover"
            />
          </Pressable>
        ))}
      </View>

      <Modal visible={viewerIndex !== null} transparent onRequestClose={() => setViewerIndex(null)}>
        <View className="flex-1 bg-black">
          <Gallery
            data={uris}
            initialIndex={viewerIndex ?? 0}
            onSwipeToClose={() => setViewerIndex(null)}
          />
          <Animated.View entering={FadeIn} style={{ position: "absolute", top: insets.top + 8, left: 16 }}>
            <Pressable
              onPress={() => setViewerIndex(null)}
              className="w-10 h-10 rounded-full bg-white/90 items-center justify-center active:bg-white"
              accessibilityLabel="Close image viewer"
            >
              <X size={22} color="#111111" strokeWidth={2.5} />
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}
