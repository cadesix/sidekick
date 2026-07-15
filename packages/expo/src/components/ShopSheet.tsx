import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import {
  buildProducts,
  localDay,
  rarityOf,
  todaysShop,
  type Product,
} from '@sidekick/core';

import { MANIFEST } from '../three/cosmetics-manifest';
import { shopRender } from '../three/shop-renders';
import { useEconomy } from '../store/economy';
import {
  SHOP_COLORS,
  SLOT_LABEL,
  WARDROBE_SLOTS,
  type CosmeticsControls,
  type Wardrobe,
  type WardrobeSlot,
} from '../three/wardrobe';

// Full-screen RN "Shop", restyled to visual parity with the web reference
// (packages/web/src/components/shop-sheet.tsx). A date-seeded "Today's Shop"
// (2 featured + a daily row that restocks at local midnight, with a countdown)
// sits above the full catalog, which is one horizontal shelf per slot
// ("Browse all"). Rarity tiers are price-derived and give each card its color
// identity — the web's CSS `linear-gradient(160deg, …)` card/modal fills are
// reproduced here with expo-linear-gradient (RARITIES.grad is a 2-stop tuple).
// Tapping a product opens a detail modal: Buy (deducts coins → inventory) when
// unowned, else Equip / Take off, which drive the live 3D character.
//
// Parity notes vs web (things RN can't 1:1):
//  - Product art is a STATIC pre-rendered PNG (from three/shop-renders). The
//    web's live spinning ItemTurntable (featured cards + detail modal) is a
//    static render here — reads fine and avoids a second GL context in the sheet.
//  - Web's sticky header also hosts a live spinning CharacterPreview "dressing
//    mirror" (h-190). That needs a GL/preview handle this component isn't given
//    (props are {open, onClose, controls}), so it's omitted here.

const { height: SCREEN_H } = Dimensions.get('window');

// CSS `linear-gradient(160deg, …)` → expo-linear-gradient start/end. 160deg
// points mostly down, tilted slightly right (matches the web card fills).
const GRAD_START = { x: 0.33, y: 0.03 } as const;
const GRAD_END = { x: 0.67, y: 0.97 } as const;

// ---- product art: pre-rendered PNG, else a tinted / neutral placeholder ------
function ProductArt({ p, size, radius = 16 }: { p: Product; size: number; radius?: number }) {
  const render = shopRender(p.renderKey);
  if (render != null) {
    return <Image source={render} style={{ width: size, height: size }} contentFit="contain" />;
  }
  if (p.tint) {
    return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: p.tint }} />;
  }
  if (p.tex != null) {
    return (
      <Image
        source={p.tex as number}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
      />
    );
  }
  return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#e9edf1' }} />;
}

// exact replica of the web inline-SVG coin (gold disc + two concentric rings)
function Coin({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Circle cx={8} cy={8} r={7} fill="#f4c634" />
      <Circle cx={8} cy={8} r={7} fill="none" stroke="#d99e1b" strokeWidth={1.6} />
      <Circle cx={8} cy={8} r={4.2} fill="none" stroke="#d99e1b" strokeWidth={1.2} />
    </Svg>
  );
}

export function ShopSheet({
  open,
  onClose,
  controls,
}: {
  open: boolean;
  onClose: () => void;
  controls: CosmeticsControls | null;
}) {
  const insets = useSafeAreaInsets();

  // economy store (reactive: reading coins + inventory re-renders on change)
  const coins = useEconomy((s) => s.coins);
  const inventory = useEconomy((s) => s.inventory);
  const spendCoins = useEconomy((s) => s.spendCoins);
  const addToInventory = useEconomy((s) => s.addToInventory);

  const [detail, setDetail] = useState<Product | null>(null);
  const [wardrobe, setWardrobe] = useState<Wardrobe | null>(null);

  // slide the whole takeover up from the bottom
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 300 });
  }, [open, progress]);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SCREEN_H }],
    // fully hide when closed (RN-web root can be taller than SCREEN_H, so the
    // slide alone leaves a peeking sliver)
    opacity: progress.value < 0.001 ? 0 : 1,
  }));

  // snapshot the worn outfit when the sheet opens
  useEffect(() => {
    if (!open) return;
    setDetail(null);
    if (controls) setWardrobe(controls.getState());
  }, [open, controls]);

  // catalog is static (manifest is bundled); products/rotation derive from it
  const products = useMemo(
    () =>
      buildProducts({
        slots: WARDROBE_SLOTS,
        slotLabel: SLOT_LABEL,
        colors: SHOP_COLORS,
        manifest: MANIFEST,
      }),
    [],
  );
  const seed = localDay(Date.now());
  const { featured, daily } = useMemo(() => todaysShop(products, seed), [products, seed]);

  // countdown to the local-midnight restock (ticks every 30s while open)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open]);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const minsLeft = Math.max(0, Math.floor((midnight.getTime() - now) / 60_000));
  const restockIn = `${Math.floor(minsLeft / 60)}h ${String(minsLeft % 60).padStart(2, '0')}m`;

  const sync = () => {
    if (controls) setWardrobe(controls.getState());
  };
  const isWorn = (p: Product) => {
    const st = wardrobe?.[p.slot as WardrobeSlot];
    if (!st?.equipped) return false;
    return p.variantId
      ? st.variantId === p.variantId && !st.color
      : st.color?.toLowerCase() === p.color?.toLowerCase();
  };
  const owns = (p: Product) => inventory.includes(p.renderKey);
  const wear = (p: Product) => {
    if (!controls) return;
    if (p.variantId) controls.equipVariant(p.slot as WardrobeSlot, p.variantId);
    else if (p.color) controls.setColor(p.slot as WardrobeSlot, p.color);
    sync();
  };
  const takeOff = (p: Product) => {
    controls?.remove(p.slot as WardrobeSlot);
    sync();
  };
  const buy = (p: Product) => {
    if (!spendCoins(p.cost)) return;
    addToInventory(p.renderKey);
  };

  // ---- little building blocks -----------------------------------------------
  const PriceOrOwned = ({ p }: { p: Product }) =>
    owns(p) ? (
      <Text style={styles.ownedText}>Owned</Text>
    ) : (
      <View style={styles.priceRow}>
        <Coin size={14} />
        <Text style={styles.priceText}>{p.cost}</Text>
      </View>
    );

  const WornBadge = ({ small }: { small?: boolean }) => (
    <View style={[styles.wornBadge, small && styles.wornBadgeSmall]}>
      <Ionicons name="checkmark" size={small ? 13 : 15} color="#fff" />
    </View>
  );

  // a featured (big) / daily card. Featured carries the rarity chip; the daily
  // row omits it (matching web). Gradient fill + hard "0 4px 0" bottom shadow
  // give the squishy card look; press depresses it toward the shadow.
  const RotationCard = ({ p, big }: { p: Product; big?: boolean }) => {
    const r = rarityOf(p.cost);
    return (
      <Pressable
        onPress={() => setDetail(p)}
        style={({ pressed }) => [pressed && styles.pressed2]}
      >
        <LinearGradient
          colors={r.grad}
          start={GRAD_START}
          end={GRAD_END}
          style={big ? styles.featuredCard : styles.dailyCard}
        >
          {big ? (
            <View style={[styles.rarityChip, { backgroundColor: r.chip }]}>
              <Text style={styles.rarityChipText}>{r.label.toUpperCase()}</Text>
            </View>
          ) : null}
          <View style={{ alignItems: 'center', marginTop: big ? 4 : 0 }}>
            <ProductArt p={p} size={big ? 144 : 96} />
          </View>
          <Text numberOfLines={1} style={big ? styles.featuredName : styles.dailyName}>
            {p.name}
          </Text>
          <PriceOrOwned p={p} />
        </LinearGradient>
        {isWorn(p) ? <WornBadge small={!big} /> : null}
      </Pressable>
    );
  };

  // a per-slot horizontal shelf (art bleeds to the screen edge, then re-pads)
  const Shelf = ({ slot }: { slot: WardrobeSlot }) => {
    const items = products.filter((p) => p.slot === slot);
    if (!items.length) return null;
    return (
      <View style={{ paddingTop: 32 }}>
        <Text style={styles.shelfTitle}>{SLOT_LABEL[slot]}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 16, paddingHorizontal: 24 }}
          style={{ marginHorizontal: -24 }}
        >
          {items.map((p) => (
            <Pressable key={p.renderKey} onPress={() => setDetail(p)} style={styles.shelfItem}>
              <View>
                <ProductArt p={p} size={128} />
                {isWorn(p) ? <WornBadge small /> : null}
              </View>
              <Text numberOfLines={1} style={styles.shelfItemName}>
                {p.name}
              </Text>
              <PriceOrOwned p={p} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  };

  const detailWorn = detail ? isWorn(detail) : false;
  const detailOwned = detail ? owns(detail) : false;
  const canAfford = detail ? coins >= detail.cost : false;
  const detailRarity = detail ? rarityOf(detail.cost) : null;

  return (
    <Animated.View
      style={[styles.takeover, sheetStyle]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      {/* sticky header: title + coin balance + close */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Text style={styles.title}>Shop</Text>
        <View style={styles.headerRight}>
          <View style={styles.coinPill}>
            <Coin size={16} />
            <Text style={styles.coinPillText}>{coins}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityLabel="Close shop" style={styles.closeBtn}>
            <Ionicons name="close" size={20} color="#737373" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 20) + 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Today's Shop header + restock countdown */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Today&apos;s Shop</Text>
          <View style={styles.restockPill}>
            <Ionicons name="time-outline" size={14} color="#ff7a3d" />
            <Text style={styles.restockText}>New stock in {restockIn}</Text>
          </View>
        </View>

        {/* featured (premium, larger) */}
        <View style={styles.grid}>
          {featured.map((p) => (
            <View key={p.renderKey} style={styles.gridCell}>
              <RotationCard p={p} big />
            </View>
          ))}
        </View>

        {/* daily row */}
        <View style={[styles.grid, { marginTop: 14 }]}>
          {daily.map((p) => (
            <View key={p.renderKey} style={styles.gridCell}>
              <RotationCard p={p} />
            </View>
          ))}
        </View>

        {/* full catalog: one shelf per slot */}
        <Text style={styles.browseAll}>Browse all</Text>
        {WARDROBE_SLOTS.map((slot) => (
          <Shelf key={slot} slot={slot} />
        ))}
      </ScrollView>

      {/* item detail modal */}
      <Modal visible={detail != null} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDetail(null)}>
          {detail && detailRarity ? (
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <LinearGradient
                colors={detailRarity.grad}
                start={GRAD_START}
                end={GRAD_END}
                style={styles.modalArt}
              >
                <View style={[styles.rarityChip, { backgroundColor: detailRarity.chip }]}>
                  <Text style={styles.rarityChipText}>{detailRarity.label.toUpperCase()}</Text>
                </View>
                <View style={{ alignItems: 'center', marginTop: 6 }}>
                  <ProductArt p={detail} size={208} />
                </View>
              </LinearGradient>
              <Text style={styles.modalName}>{detail.name}</Text>

              {detailOwned ? (
                detailWorn ? (
                  <Pressable
                    onPress={() => takeOff(detail)}
                    style={({ pressed }) => [styles.btnNeutral, pressed && styles.pressed3]}
                  >
                    <Text style={styles.btnNeutralText}>Take off</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => wear(detail)}
                    style={({ pressed }) => [styles.btnEquip, pressed && styles.pressed3]}
                  >
                    <Text style={styles.btnEquipText}>Equip</Text>
                  </Pressable>
                )
              ) : (
                <Pressable
                  disabled={!canAfford}
                  onPress={() => buy(detail)}
                  style={({ pressed }) => [
                    styles.btnBuy,
                    !canAfford && styles.btnDisabled,
                    pressed && canAfford && styles.pressed3,
                  ]}
                >
                  <Coin size={16} />
                  <Text style={[styles.btnBuyText, !canAfford && styles.btnDisabledText]}>
                    Buy for {detail.cost}
                  </Text>
                </Pressable>
              )}
            </Pressable>
          ) : (
            <View />
          )}
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

// hard "0 Npx 0" bottom shadows (the squishy-card / 3D-button look on web)
const hardShadow = (height: number, color: string, opacity: number) => ({
  shadowColor: color,
  shadowOffset: { width: 0, height },
  shadowOpacity: opacity,
  shadowRadius: 0,
  elevation: height,
});

const styles = StyleSheet.create({
  takeover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#171717' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    ...hardShadow(2, '#000', 0.08),
  },
  coinPillText: { fontSize: 14, fontWeight: '800', color: '#262626' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#171717' },
  restockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff1e6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  restockText: { fontSize: 12, fontWeight: '700', color: '#ff7a3d' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -7 },
  gridCell: { width: '50%', paddingHorizontal: 7, marginBottom: 14 },

  featuredCard: { borderRadius: 24, padding: 16, ...hardShadow(4, '#000', 0.1) },
  featuredName: { marginTop: 8, fontSize: 14, fontWeight: '700', color: '#171717' },
  dailyCard: { borderRadius: 20, padding: 12, ...hardShadow(3, '#000', 0.08) },
  dailyName: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#262626' },

  pressed2: { transform: [{ translateY: 2 }] },
  pressed3: { transform: [{ translateY: 3 }] },

  rarityChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  rarityChipText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  priceText: { fontSize: 12, fontWeight: '700', color: '#525252' },
  ownedText: { fontSize: 12, fontWeight: '700', color: '#059669', marginTop: 2 },

  wornBadge: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wornBadgeSmall: { right: 4, top: 4, width: 20, height: 20, borderRadius: 10 },

  browseAll: { marginTop: 36, fontSize: 20, fontWeight: '800', color: '#171717' },
  shelfTitle: { marginBottom: 12, fontSize: 17, fontWeight: '800', color: '#171717' },
  shelfItem: { width: 128 },
  shelfItemName: { marginTop: 6, fontSize: 12, fontWeight: '600', color: '#404040' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    width: '100%',
    maxWidth: 384,
    borderRadius: 28,
    backgroundColor: '#fff',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 60,
    elevation: 24,
  },
  modalArt: { borderRadius: 22, padding: 12 },
  modalName: { marginTop: 16, textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#171717' },

  btnBuy: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 14,
    backgroundColor: '#7A5AF8',
    ...hardShadow(4, '#5638c6', 1),
  },
  btnBuyText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnDisabled: { backgroundColor: '#f5f5f5', shadowOpacity: 0, elevation: 0 },
  btnDisabledText: { color: '#a3a3a3' },
  btnEquip: {
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 14,
    backgroundColor: '#0a84ff',
    ...hardShadow(4, '#0868c8', 1),
  },
  btnEquipText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnNeutral: {
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 14,
    backgroundColor: '#f5f5f5',
    ...hardShadow(4, '#000', 0.1),
  },
  btnNeutralText: { fontSize: 15, fontWeight: '700', color: '#525252' },
});
