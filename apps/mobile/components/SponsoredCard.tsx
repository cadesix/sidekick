import { useState } from "react";
import { Image, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import type { AdView } from "~/lib/chat-thread";
import { dismissAd, recordAdClick } from "~/lib/api";
import { SolidShadow } from "./SolidShadow";

/**
 * The one monetization surface (05 / 07 §8): a sponsored suggestion card rendered
 * below the sidekick's reply for ad message rows. Unmistakably an ad — SolidShadow
 * card chrome (never bubble geometry), an always-visible «Sponsored» label (FTC +
 * Gravity policy), never in the sidekick's voice. Tap opens the click url in an
 * in-app browser; long-press dismisses ("hide ads like this"). Frequency and
 * eligibility are server-decided — this only renders what arrived (05).
 *
 * The impression pixel is NOT fired here: it fires from the chat FlatList's
 * `onViewableItemsChanged` at ≥50% visibility (ChatSheet), never on render.
 */
export function SponsoredCard({ ad }: { ad: AdView }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  const open = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void recordAdClick(ad.adUnitId).catch(() => {});
    void WebBrowser.openBrowserAsync(ad.clickUrl).catch(() => {});
  };

  const hide = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDismissed(true);
    void dismissAd(ad.adUnitId).catch(() => {});
  };

  return (
    <View className="mx-4 my-1">
      <SolidShadow radius={16} onPress={open} onLongPress={hide}>
        <View className="bg-white rounded-2xl p-3.5">
          <View className="flex-row items-center gap-1.5">
            {ad.faviconUrl ? (
              <Image source={{ uri: ad.faviconUrl }} className="w-4 h-4 rounded" />
            ) : null}
            <Text className="text-[12px] text-ink/45" numberOfLines={1}>
              {ad.brandName}
            </Text>
            <Text className="text-[12px] text-ink/45">· Sponsored</Text>
          </View>
          <Text className="text-[15px] font-bold text-ink mt-1.5">{ad.title}</Text>
          <Text className="text-[14px] text-ink/55 mt-0.5" numberOfLines={1}>
            {ad.body}
          </Text>
          <View className="flex-row justify-end mt-2.5">
            <SolidShadow radius={999} onPress={open}>
              <View className="bg-white rounded-full px-3 py-1.5">
                <Text className="text-[13px] font-bold text-ink">{ad.cta} →</Text>
              </View>
            </SolidShadow>
          </View>
        </View>
      </SolidShadow>
    </View>
  );
}
