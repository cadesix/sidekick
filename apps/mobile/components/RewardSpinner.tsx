import { useEffect, useMemo, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { COSMETIC_CATALOG, REDEEM_COST } from "@sidekick/shared";
import { PrimaryButton } from "~/components/PrimaryButton";
import { SolidShadow } from "~/components/SolidShadow";
import { type SpinResult, equipCosmetic, spinReward } from "~/lib/api";
import { RARITY_STYLE } from "~/lib/cosmetics";

const TILE = 92;
const GAP = 12;
const STEP = TILE + GAP;
const STRIP_LEN = 30;
const RESULT_INDEX = STRIP_LEN - 5;
const FILLER = COSMETIC_CATALOG.map((c) => c.glyph);

/** Haptic on landing — heavy for a legendary, a success tap otherwise (06 §4). */
function landHaptic(isLegendary: boolean): void {
  if (isLegendary) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    return;
  }
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

function Confetti({ run }: { run: boolean }) {
  const { width } = useWindowDimensions();
  const pieces = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        key: i,
        x: (i / 16) * width,
        glyph: ["🎉", "✨", "⭐", "🎊"][i % 4],
        delay: (i % 8) * 60,
      })),
    [width],
  );
  if (!run) {
    return null;
  }
  return (
    <View pointerEvents="none" className="absolute inset-0">
      {pieces.map((p) => (
        <ConfettiPiece key={p.key} x={p.x} glyph={p.glyph} delay={p.delay} />
      ))}
    </View>
  );
}

function ConfettiPiece({ x, glyph, delay }: { x: number; glyph: string; delay: number }) {
  const { height } = useWindowDimensions();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }));
  }, [t, delay]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * height }, { rotate: `${t.value * 360}deg` }],
    opacity: 1 - t.value,
  }));
  return (
    <Animated.View style={[{ position: "absolute", left: x, top: -30 }, style]}>
      <Text style={{ fontSize: 22 }}>{glyph}</Text>
    </Animated.View>
  );
}

/**
 * The variable-reward payoff (04 / 07 §6). The server decides the result; this
 * only animates it. The reel eases to a stop on the granted item, haptics fire on
 * land, and the reward is already in the wardrobe (idempotent, keyed to the
 * check-in) — backgrounding mid-spin never re-rolls.
 */
export function RewardSpinner({
  checkInId,
  onClose,
}: {
  checkInId: string;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const windowWidth = Math.min(width - 40, 360);
  const queryClient = useQueryClient();
  const [landed, setLanded] = useState(false);

  const spin = useQuery<SpinResult>({
    queryKey: ["spin", checkInId],
    queryFn: () => spinReward(checkInId),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const equip = useMutation({
    mutationFn: (itemKey: string) => equipCosmetic(itemKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
  });

  const result = spin.data ?? null;
  const strip = useMemo(() => {
    const glyphs = Array.from({ length: STRIP_LEN }, (_, i) => FILLER[(i * 7) % FILLER.length] ?? "✨");
    if (result) {
      glyphs[RESULT_INDEX] = result.kind === "item" ? (result.item?.glyph ?? "✨") : "✨";
    }
    return glyphs;
  }, [result]);

  const tx = useSharedValue(0);
  useEffect(() => {
    if (!result || landed) {
      return;
    }
    const isLegendary = result.kind === "item" && result.item?.rarity === "legendary";
    tx.value = withTiming(
      -(RESULT_INDEX * STEP),
      { duration: 2600, easing: Easing.bezier(0.16, 1, 0.3, 1) },
      (finished) => {
        if (finished) {
          runOnJS(setLanded)(true);
          runOnJS(landHaptic)(isLegendary);
        }
      },
    );
  }, [result, landed, tx]);

  const reelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <View className="absolute inset-0 z-[60] bg-white items-center justify-center px-5">
      <Confetti run={landed} />
      <Text className="text-[27px] font-extrabold tracking-[-0.02em] text-ink text-center mb-8">
        nice work today 🎉
      </Text>

      <View
        style={{ width: windowWidth, height: TILE + 8 }}
        className="overflow-hidden rounded-2xl bg-field"
      >
        <View
          className="absolute top-0 bottom-0 z-10 border-x-2 border-ink/15"
          style={{ left: windowWidth / 2 - TILE / 2, width: TILE }}
        />
        <Animated.View
          style={[
            { flexDirection: "row", gap: GAP, paddingLeft: windowWidth / 2 - TILE / 2, alignItems: "center", height: TILE + 8 },
            reelStyle,
          ]}
        >
          {strip.map((glyph, i) => (
            <View
              key={i}
              style={{ width: TILE, height: TILE }}
              className="rounded-2xl bg-white items-center justify-center"
            >
              <Text style={{ fontSize: 44 }}>{glyph}</Text>
            </View>
          ))}
        </Animated.View>
      </View>

      {landed && result ? <Landed result={result} onEquip={equip.mutate} onClose={onClose} /> : (
        <Text className="text-[15px] text-ink/45 mt-6">spinning…</Text>
      )}
    </View>
  );
}

function Landed({
  result,
  onEquip,
  onClose,
}: {
  result: SpinResult;
  onEquip: (itemKey: string) => void;
  onClose: () => void;
}) {
  const pop = useSharedValue(0);
  useEffect(() => {
    pop.value = withSequence(withSpring(1.06, { damping: 10, stiffness: 180 }), withSpring(1));
  }, [pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  if (result.kind === "sparks") {
    const remaining = Math.max(0, REDEEM_COST - result.sparksTotal);
    return (
      <Animated.View entering={FadeIn.duration(300)} style={popStyle} className="items-center mt-7">
        <Text className="text-[40px] font-extrabold text-ink">+{result.sparks ?? 0} ✨</Text>
        <Text className="text-[15px] text-ink/55 mt-1 mb-6 text-center">
          {remaining > 0
            ? `${remaining} more to pick anything you want`
            : "you can redeem any item now!"}
        </Text>
        <View className="w-full max-w-xs">
          <PrimaryButton label="Nice" onPress={onClose} />
        </View>
      </Animated.View>
    );
  }

  const item = result.item;
  const rarity = item ? RARITY_STYLE[item.rarity] : RARITY_STYLE.common;
  return (
    <Animated.View entering={FadeIn.duration(300)} style={popStyle} className="items-center mt-7">
      <Text style={{ fontSize: 64 }}>{item?.glyph ?? "✨"}</Text>
      <Text className="text-[22px] font-extrabold text-ink mt-2">{item?.name ?? "New item"}</Text>
      <Text style={{ color: rarity.color }} className="text-[15px] font-bold mt-1 mb-6">
        {rarity.label}
      </Text>
      <View className="w-full max-w-xs flex-row gap-3">
        <View className="flex-1">
          <PrimaryButton label="Equip" onPress={() => item && onEquip(item.key)} />
        </View>
        <SolidShadow radius={999} onPress={onClose}>
          <View className="px-6 py-4 items-center justify-center rounded-full bg-white">
            <Text className="text-[16px] font-semibold text-ink">Later</Text>
          </View>
        </SolidShadow>
      </View>
    </Animated.View>
  );
}
