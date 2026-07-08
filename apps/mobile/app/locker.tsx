import { useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Check, ChevronLeft, Lock, Sparkles } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CosmeticDefinition, type CosmeticSlot, REDEEM_COST } from "@sidekick/shared";
import { MascotView } from "~/components/MascotView";
import { Skeleton } from "~/components/Skeleton";
import { SolidShadow } from "~/components/SolidShadow";
import {
  equipCosmetic,
  fetchInventory,
  fetchMe,
  redeemCosmetic,
  unequipCosmetic,
} from "~/lib/api";
import { RARITY_STYLE, SLOT_TABS, catalogForSlot, earnCaption } from "~/lib/cosmetics";

function useInventory() {
  return useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
}

export default function Locker() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [slot, setSlot] = useState<CosmeticSlot>("head");
  const queryClient = useQueryClient();
  const inventory = useInventory();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Number.POSITIVE_INFINITY });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["inventory"] });
  const equip = useMutation({ mutationFn: equipCosmetic, onSuccess: invalidate });
  const unequip = useMutation({ mutationFn: unequipCosmetic, onSuccess: invalidate });
  const redeem = useMutation({ mutationFn: redeemCosmetic, onSuccess: invalidate });

  const owned = new Map((inventory.data?.items ?? []).map((i) => [i.itemKey, i.equipped]));
  const equippedGlyphs = (inventory.data?.items ?? [])
    .filter((i) => i.equipped)
    .map((i) => {
      const def = catalogForSlot(i.slot as CosmeticSlot).find((c) => c.key === i.itemKey);
      return { slot: i.slot, glyph: def?.glyph ?? "" };
    })
    .filter((g) => g.glyph.length > 0);
  const sparks = inventory.data?.sparks ?? 0;
  const preview = Math.min(width * 0.55, 240);
  const tile = (width - 40 - 30) / 4;

  function onTileTap(item: CosmeticDefinition) {
    const isOwned = owned.has(item.key);
    if (!isOwned) {
      if (sparks >= REDEEM_COST) {
        redeem.mutate(item.key);
      }
      return;
    }
    if (owned.get(item.key)) {
      unequip.mutate(item.key);
      return;
    }
    equip.mutate(item.key);
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center active:opacity-60"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={26} color="#111" strokeWidth={2.5} />
        </Pressable>
        <Text className="text-[20px] font-extrabold text-ink ml-1 flex-1">Locker</Text>
        <View className="flex-row items-center gap-1.5 rounded-full bg-field px-3 py-1.5">
          <Sparkles size={15} color="#F2C94C" strokeWidth={2.5} />
          <Text className="text-[15px] font-bold text-ink">{sparks}</Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center py-4">
          <MascotView colorId={me.data?.sidekickColor ?? null} equipped={equippedGlyphs} size={preview} />
        </View>

        <View className="flex-row gap-2 mb-4">
          {SLOT_TABS.map((tab) => (
            <Pressable
              key={tab.slot}
              onPress={() => setSlot(tab.slot)}
              className={`flex-1 items-center rounded-full py-2 ${
                slot === tab.slot ? "bg-ink" : "bg-field"
              }`}
            >
              <Text
                className={`text-[14px] font-bold ${slot === tab.slot ? "text-white" : "text-ink/55"}`}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {inventory.isPending ? (
          <View className="flex-row flex-wrap gap-2.5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <View key={i} style={{ width: tile, height: tile }}>
                <Skeleton className="w-full h-full rounded-2xl" />
              </View>
            ))}
          </View>
        ) : (
          <View className="flex-row flex-wrap gap-2.5">
            {catalogForSlot(slot).map((item) => (
              <CosmeticTile
                key={item.key}
                item={item}
                size={tile}
                owned={owned.has(item.key)}
                equipped={owned.get(item.key) ?? false}
                canRedeem={sparks >= REDEEM_COST}
                onPress={() => onTileTap(item)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function CosmeticTile({
  item,
  size,
  owned,
  equipped,
  canRedeem,
  onPress,
}: {
  item: CosmeticDefinition;
  size: number;
  owned: boolean;
  equipped: boolean;
  canRedeem: boolean;
  onPress: () => void;
}) {
  const rarity = RARITY_STYLE[item.rarity];
  return (
    <Animated.View entering={FadeIn.duration(250)} style={{ width: size }}>
      <SolidShadow onPress={onPress}>
        <View
          style={{ height: size, opacity: owned ? 1 : 0.45 }}
          className="rounded-2xl bg-white items-center justify-center"
        >
          <Text style={{ fontSize: size * 0.42 }}>{item.glyph}</Text>
          {owned && equipped ? (
            <View className="absolute top-1 right-1 w-5 h-5 rounded-full bg-ink items-center justify-center">
              <Check size={12} color="#fff" strokeWidth={3.5} />
            </View>
          ) : null}
          {owned ? null : (
            <View className="absolute top-1 right-1">
              <Lock size={13} color="#111" strokeWidth={2.5} />
            </View>
          )}
        </View>
      </SolidShadow>
      <Text numberOfLines={1} className="text-[11px] font-bold text-ink text-center mt-1">
        {item.name}
      </Text>
      {owned ? (
        <Text style={{ color: rarity.color }} className="text-[10px] font-bold text-center">
          {rarity.label}
        </Text>
      ) : (
        <Text className="text-[10px] font-medium text-ink/40 text-center">
          {canRedeem ? "tap · ✨100" : earnCaption(item.source)}
        </Text>
      )}
    </Animated.View>
  );
}
