import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import type { AdView } from "~/lib/chat-thread";
import { dismissAd, recordAdClick, recordAdImpression } from "~/lib/api";
import { colors } from "~/imessage/theme";

/**
 * The one monetization surface (05 / 07 §8): a sponsored suggestion card rendered
 * above the composer. Its neutral system styling keeps it distinct from message
 * bubbles while fitting the surrounding iOS chrome. The sponsored label is
 * always visible; taps use Gravity's tracked URL and the close button dismisses.
 */
export function SponsoredCard({ ad }: { ad: AdView }) {
  const [dismissed, setDismissed] = useState(false);
  const [impressionRecorded, setImpressionRecorded] = useState(false);

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

  const recordImpression = () => {
    if (impressionRecorded) {
      return;
    }
    setImpressionRecorded(true);
    void recordAdImpression(ad.adUnitId).catch(() => {});
  };

  return (
    <View style={styles.container} onLayout={recordImpression}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${ad.brandName}, Sponsored, ${ad.title}, ${ad.cta}`}
        onPress={open}
        style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
      >
          <View style={styles.header}>
            {ad.faviconUrl ? (
              <Image source={{ uri: ad.faviconUrl }} style={styles.favicon} />
            ) : null}
            <Text style={styles.brand} numberOfLines={1}>
              {ad.brandName}
            </Text>
            <Text style={styles.sponsored}>Sponsored</Text>
            <Pressable
              onPress={hide}
              accessibilityLabel="Hide sponsored suggestion"
              hitSlop={10}
              style={styles.close}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.title} numberOfLines={1}>{ad.title}</Text>
          <Text style={styles.body} numberOfLines={1}>
            {ad.body}
          </Text>
          <Text style={styles.cta}>{ad.cta} ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 2,
  },
  card: {
    backgroundColor: colors.gray6,
    borderColor: colors.gray5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardPressed: {
    opacity: 0.65,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  favicon: {
    borderRadius: 3,
    height: 14,
    width: 14,
  },
  brand: {
    color: colors.secondaryLabel,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
  },
  sponsored: {
    color: colors.tertiaryLabel,
    fontSize: 11,
  },
  close: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
    marginLeft: "auto",
    width: 20,
  },
  closeText: {
    color: colors.gray,
    fontSize: 17,
    lineHeight: 18,
  },
  title: {
    color: colors.label,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 3,
  },
  body: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 17,
    marginTop: 1,
  },
  cta: {
    color: colors.blue,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 5,
  },
});
