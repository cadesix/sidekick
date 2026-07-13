import { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import type { AdView } from "~/lib/chat-thread";
import { dismissAd, recordAdClick, recordAdImpression } from "~/lib/api";
import { colors } from "~/imessage/theme";

/**
 * The one monetization surface (05 / 07 §8): a compact sponsored row rendered
 * below the composer — round brand logo, "Brand · Ad" line, one line of copy,
 * disclosure chevron. Taps use Gravity's tracked URL and long-press offers the
 * "hide ads like this" dismissal (05 §ad feedback loop).
 */
export function SponsoredCard({ ad }: { ad: AdView }) {
  const [dismissed, setDismissed] = useState(false);
  const [impressionRecorded, setImpressionRecorded] = useState(false);
  // css-interop silently drops function-form Pressable styles, so pressed
  // feedback is tracked as state and styled with a plain array.
  const [pressed, setPressed] = useState(false);

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

  const confirmHide = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Hide ads like this?", `You'll see fewer ads about ${ad.brandName}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Hide", style: "destructive", onPress: hide },
    ]);
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
        accessibilityLabel={`${ad.brandName}, Ad, ${ad.title}`}
        accessibilityHint="Long press to hide ads like this"
        onPress={open}
        onLongPress={confirmHide}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[styles.card, pressed ? styles.cardPressed : null]}
      >
        {ad.faviconUrl ? (
          <Image source={{ uri: ad.faviconUrl }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoFallback]}>
            <Text style={styles.logoInitial}>{ad.brandName.slice(0, 1)}</Text>
          </View>
        )}
        <View style={styles.copy}>
          <View style={styles.brandRow}>
            <Text style={styles.brand} numberOfLines={1}>
              {ad.brandName}
            </Text>
            <Text style={styles.adBadge}>· Ad</Text>
          </View>
          <Text style={styles.text} numberOfLines={1}>
            {ad.body ? ad.body : ad.title}
          </Text>
        </View>
        <SymbolView name="chevron.right" size={14} weight="semibold" tintColor={colors.gray3} />
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
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.gray5,
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardPressed: {
    backgroundColor: colors.gray6,
  },
  logo: {
    height: 40,
    width: 40,
  },
  logoFallback: {
    alignItems: "center",
    backgroundColor: colors.gray5,
    borderRadius: 20,
    justifyContent: "center",
  },
  logoInitial: {
    color: colors.secondaryLabel,
    fontSize: 18,
    fontWeight: "600",
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  brand: {
    color: colors.label,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  adBadge: {
    color: colors.secondaryLabel,
    fontSize: 14,
  },
  text: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
});
