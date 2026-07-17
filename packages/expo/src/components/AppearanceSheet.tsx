import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SLOT_LABEL, WARDROBE_SLOTS, type Product } from '@sidekick/core';

import { setSkinColor } from '../lib/api';
import { PRODUCTS } from '../lib/products';
import { patchSnapshot, useSnapshot } from '../lib/state';
import { shopRender } from '../three/shop-renders';
import { loadSettings, saveSettings, type SidekickSettings } from '../three/settings';
import { useDeferredFlag } from '../lib/useDeferredFlag';
import { takeOffProduct, wearProduct } from '../lib/wardrobe-sync';
import { useCosmeticVersion } from '../store/cosmeticVersion';
import { applySkin, currentSkinId, saveSkinMirror, SKIN_COLORS, type SkinColor } from '../store/skin';
import { type CosmeticsControls, type Wardrobe } from '../three/wardrobe';

// Appearance / Closet — opened from the avatar button. Presented like the Shop
// (host swaps to the studio backdrop and frames the character above), but this
// is a COMPACT ~52% bottom sheet: skin-color swatches up top, then the Closet
// (owned cosmetics only, one horizontal shelf per slot). Tapping an owned item
// wears it; tapping again takes it off. Buying still happens in the Shop.
//
// Parity note vs web (appearance-sheet.tsx): the skin swatch persists via
// applySkin() and hands the patched settings up through onSkinChange so the
// HOME can re-apply them to the live controller (this sheet can't reach it).

const SHEET_H = Math.round(Dimensions.get('window').height * 0.52);

export function AppearanceSheet({
  open,
  onClose,
  controls,
  onSkinChange,
}: {
  open: boolean;
  onClose: () => void;
  controls: CosmeticsControls | null;
  // live recolor of the mounted scene happens in the home from these settings;
  // persistence is ours (applySkin)
  onSkinChange?: (settings: SidekickSettings) => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  // server-driven progression (plan 20): the owned set comes from the snapshot
  const snapshot = useSnapshot().data;
  const ownedKeys = useMemo(
    () => new Set((snapshot?.inventory ?? []).map((item) => item.itemKey)),
    [snapshot],
  );

  const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);
  const [skin, setSkin] = useState<string | null>(null);

  // slide up from the bottom; opacity-gate so it can't peek when closed
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 300 });
  }, [open, progress]);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SHEET_H }],
    opacity: progress.value < 0.001 ? 0 : 1,
  }));

  // snapshot worn outfit + current skin when the sheet opens
  useEffect(() => {
    if (!open) return;
    setSkin(currentSkinId(loadSettings()));
    if (controls) setWardrobe(controls.getState());
  }, [open, controls]);

  // Defer the owned-closet shelves (each item a decoded thumbnail; the whole
  // catalog with DEV "Own all") until the slide-in finishes, so the open frame
  // isn't competing with the image mount + studio crossfade. The Color row
  // renders immediately.
  const showCloset = useDeferredFlag(open, { onDelay: 340 });

  // full catalog (static, core data + bundled art), then keep only owned items
  const owned = useMemo(
    () => PRODUCTS.filter((p) => ownedKeys.has(p.renderKey)),
    [ownedKeys],
  );

  const sync = () => {
    if (controls) setWardrobe(controls.getState());
    useCosmeticVersion.getState().bump(); // regenerate the live head avatars
  };
  const isWorn = (p: Product) => {
    const st = wardrobe?.[p.slot];
    if (!st?.equipped) return false;
    return p.variantId
      ? st.variantId === p.variantId && !st.color
      : st.color?.toLowerCase() === p.color?.toLowerCase();
  };
  const toggleWear = (p: Product) => {
    if (!controls) return;
    if (isWorn(p)) takeOffProduct(queryClient, controls, p, sync);
    else wearProduct(queryClient, controls, p, sync);
  };
  // scene + mirror first, then the setSkin mutation; a failure rolls both back
  // to the colors the server last approved and surfaces why
  const pickSkin = (c: SkinColor) => {
    const previous = loadSettings();
    setSkin(c.id);
    const next = applySkin(c.id); // local scene state; home re-applies it live
    onSkinChange?.(next);
    useCosmeticVersion.getState().bump(); // avatar body color follows the skin
    saveSkinMirror({ body: c.body, shadow: c.shadow });
    setSkinColor(c.body, c.shadow)
      .then(({ stateVersion }) =>
        patchSnapshot(queryClient, { stateVersion, skin: { body: c.body, shadow: c.shadow } }),
      )
      .catch((error: unknown) => {
        setSkin(currentSkinId(previous));
        const rolled: SidekickSettings = {
          ...loadSettings(),
          celBodyColor: previous.celBodyColor,
          celShadowColor: previous.celShadowColor,
        };
        saveSettings(rolled);
        onSkinChange?.(rolled);
        useCosmeticVersion.getState().bump();
        saveSkinMirror({ body: previous.celBodyColor, shadow: previous.celShadowColor });
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'something went wrong — try again';
        Alert.alert("Couldn't save that color", message);
      });
  };

  return (
    <Animated.View
      style={[styles.sheet, { height: SHEET_H }, sheetStyle]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <View style={styles.card}>
        {/* grabber + header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Appearance</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close appearance" style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#737373" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingBottom: Math.max(insets.bottom, 20),
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* skin color */}
          <Text style={styles.sectionTitle}>Color</Text>
          <View style={styles.swatchRow}>
            {SKIN_COLORS.map((c) => {
              const selected = skin === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => pickSkin(c)}
                  accessibilityLabel={c.id}
                  style={styles.swatch}
                >
                  {/* ring-2 + ring-offset-2: a 2px ring sitting 2px outside the
                      44px dot, drawn as an overlay so it doesn't take layout
                      space (matches web's box-shadow ring). Selected only
                      changes ring color; width stays 2px. */}
                  <View
                    pointerEvents="none"
                    style={[
                      styles.swatchRing,
                      { borderColor: selected ? '#171717' : 'rgba(0,0,0,0.1)' },
                    ]}
                  />
                  <View style={[styles.swatchBody, { backgroundColor: c.body }]}>
                    {selected ? <Ionicons name="checkmark" size={20} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* closet: owned items, tap to wear / take off (deferred until the
              sheet settles) */}
          <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Closet</Text>
          {!showCloset || snapshot == null ? null : owned.length ? (
            WARDROBE_SLOTS.map((slot) => {
              const items = owned.filter((p) => p.slot === slot);
              if (!items.length) return null;
              return (
                <View key={slot} style={{ paddingTop: 20 }}>
                  <Text style={styles.shelfLabel}>{SLOT_LABEL[slot]}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 16, paddingHorizontal: 24 }}
                    style={{ marginHorizontal: -24 }}
                  >
                    {items.map((p) => {
                      const render = shopRender(p.renderKey);
                      const worn = isWorn(p);
                      return (
                        <Pressable key={p.renderKey} onPress={() => toggleWear(p)} style={styles.tile}>
                          <View>
                            {render != null ? (
                              <Image
                                source={render}
                                style={[styles.tileArt, styles.tileArtShadow]}
                                contentFit="contain"
                              />
                            ) : (
                              <View style={[styles.tileArt, styles.tilePlaceholder]} />
                            )}
                            {worn ? (
                              <View style={styles.wornBadge}>
                                <Ionicons name="checkmark" size={14} color="#fff" />
                              </View>
                            ) : null}
                          </View>
                          <Text numberOfLines={1} style={styles.tileName}>
                            {p.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              );
            })
          ) : (
            <Text style={styles.empty}>Nothing here yet — grab something in the Shop!</Text>
          )}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40 },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 12,
  },
  grabber: {
    alignSelf: 'center',
    height: 6,
    width: 40,
    borderRadius: 999,
    backgroundColor: '#e5e5e5',
  },
  headerRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '800', color: '#171717' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionTitle: { marginTop: 12, fontSize: 17, fontWeight: '800', color: '#171717' },

  swatchRow: { marginTop: 10, flexDirection: 'row', gap: 12 },
  // 44px layout footprint (matches web's h-11 w-11 box); the ring overflows
  // into the gap via an absolute overlay, so gap-3 (12) still measures dot→dot.
  swatch: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchBody: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 2px ring, 2px gap (ring-offset) outside the 44px dot → outer Ø 52.
  swatchRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 2,
    borderRadius: 26,
  },

  shelfLabel: {
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: '#a3a3a3',
  },
  tile: { width: 112 },
  tileArt: { width: 112, height: 112 },
  // web: drop-shadow-[0_8px_10px_rgba(0,0,0,0.18)]. On iOS the shadow follows
  // the PNG's alpha (hugs the item silhouette); Android renders it via elevation.
  tileArtShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  tilePlaceholder: { borderRadius: 16, backgroundColor: '#e9edf1' },
  tileName: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#404040' },
  wornBadge: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { marginTop: 24, textAlign: 'center', fontSize: 14, fontWeight: '500', color: '#a3a3a3' },
});
