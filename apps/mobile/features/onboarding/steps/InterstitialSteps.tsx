import { Image, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { iconForSlug, labelForSlug } from "~/lib/goals";
import { PrimaryButton } from "~/components/PrimaryButton";
import { CHEER, MEET as MEET_IMG, SILHOUETTE, STATEMENT_IMAGES, WELCOME_HERO } from "../assets";

export function WelcomeStep({ title, cta, onStart }: { title: string; cta?: string; onStart: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-mint">
      <Image source={WELCOME_HERO} className="w-full h-[42%]" resizeMode="contain" />
      <View className="flex-1 px-7 justify-between" style={{ paddingBottom: insets.bottom + 24 }}>
        <View className="flex-1 justify-center">
          <Text className="text-center text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink">
            {title}
          </Text>
        </View>
        <PrimaryButton label={cta ?? "Yes!"} onPress={onStart} />
      </View>
    </View>
  );
}

export function StatementStep({
  title,
  imageKey,
  cta,
  onContinue,
}: {
  title: string;
  imageKey: string;
  cta?: string;
  onContinue: () => void;
}) {
  return (
    <View className="flex-1 px-6 pb-2">
      <View className="flex-1 items-center justify-center">
        <Image source={STATEMENT_IMAGES[imageKey] ?? CHEER} className="w-60 h-60 mb-6" resizeMode="contain" />
        <Text className="text-center text-[26px] font-extrabold leading-snug tracking-[-0.01em] text-ink">
          {title}
        </Text>
      </View>
      <PrimaryButton label={cta ?? "Continue"} onPress={onContinue} />
    </View>
  );
}

export function QuizIntroStep({
  title,
  imageKey,
  onContinue,
}: {
  title: string;
  imageKey: string;
  onContinue: () => void;
}) {
  return (
    <View className="flex-1 px-6 pb-2">
      <Text className="text-center text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink pt-2">
        {title}
      </Text>
      <View className="flex-1 items-center justify-center">
        <Image source={STATEMENT_IMAGES[imageKey] ?? CHEER} className="w-72 h-72" resizeMode="contain" />
      </View>
      <PrimaryButton label="Continue" onPress={onContinue} />
    </View>
  );
}

export function TransitionStep({
  goals,
  onContinue,
}: {
  goals: string[];
  onContinue: () => void;
}) {
  return (
    <View className="flex-1 px-6 pb-2">
      <View className="flex-1 justify-center">
        {goals.length > 0 ? (
          <View className="mb-8">
            <Text className="text-center text-[12px] font-bold uppercase tracking-wider text-ink/40 mb-3">
              Your goals
            </Text>
            <View className="flex-row flex-wrap gap-2 justify-center">
              {goals.map((slug) => (
                <View key={slug} className="flex-row items-center gap-1.5 rounded-full bg-field pl-1.5 pr-3 py-1">
                  {iconForSlug(slug) ? (
                    <Image source={iconForSlug(slug)!} className="w-5 h-5" resizeMode="contain" />
                  ) : null}
                  <Text className="text-[13px] font-semibold text-ink">{labelForSlug(slug, slug)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <Text className="text-center text-[24px] font-extrabold leading-tight tracking-[-0.01em] text-ink">
          With a sidekick, you're <Text className="text-[#56AE50]">87%</Text> more likely to reach your goals.
        </Text>
        <View className="mt-7 rounded-3xl bg-[#E9F3FC] px-5 py-6">
          <Bar label="On your own" pct={22} tint="#B9C0CC" muted />
          <View className="h-3" />
          <Bar label="With a sidekick" pct={92} tint="#5FB763" />
        </View>
      </View>
      <PrimaryButton label="Continue" onPress={onContinue} />
    </View>
  );
}

function Bar({ label, pct, tint, muted = false }: { label: string; pct: number; tint: string; muted?: boolean }) {
  return (
    <View>
      <Text className={`text-[13px] font-bold mb-1 ${muted ? "text-ink/45" : "text-ink"}`}>{label}</Text>
      <View className="h-3 rounded-full bg-white overflow-hidden">
        <Animated.View
          entering={FadeIn.duration(700)}
          style={{ width: `${pct}%`, backgroundColor: tint }}
          className="h-full rounded-full"
        />
      </View>
    </View>
  );
}

export function FactStep({ title, onContinue }: { title: string; onContinue: () => void }) {
  return (
    <View className="flex-1 px-6 pb-2">
      <View className="flex-1 items-center justify-center">
        <View className="flex-row items-end justify-center gap-10 mb-9">
          <View className="items-center">
            <View className="w-16 rounded-t-xl bg-[#D9DBE2]" style={{ height: 22 }} />
            <Text className="mt-2.5 text-[12px] font-bold text-ink/45">Other apps</Text>
          </View>
          <Animated.View entering={FadeInDown.duration(600)} className="items-center">
            <View className="w-16 rounded-t-xl bg-[#56AE50]" style={{ height: 160 }} />
            <Text className="mt-2.5 text-[12px] font-bold text-ink">Sidekick</Text>
          </Animated.View>
        </View>
        <Text className="text-center text-[24px] font-extrabold leading-snug tracking-[-0.01em] text-ink px-2">
          {renderWithHighlight(title)}
        </Text>
      </View>
      <PrimaryButton label="Continue" onPress={onContinue} />
    </View>
  );
}

function renderWithHighlight(text: string) {
  const marker = "8×";
  const at = text.indexOf(marker);
  if (at < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, at)}
      <Text className="text-[#56AE50]">{marker}</Text>
      {text.slice(at + marker.length)}
    </>
  );
}

export function RevealStep({
  title,
  subtitle,
  cta,
  onContinue,
}: {
  title: string;
  subtitle?: string;
  cta?: string;
  onContinue: () => void;
}) {
  return (
    <View className="flex-1 items-center px-8 pb-2">
      <View className="flex-1 items-center justify-center">
        <Text className="text-[60px] font-black leading-none tracking-[-0.02em] text-ink -rotate-6">{title}</Text>
        <Animated.Image
          entering={FadeIn.duration(500)}
          source={SILHOUETTE}
          className="my-7 h-[38%] w-full"
          resizeMode="contain"
        />
        {subtitle ? (
          <Text className="text-center text-[30px] font-black leading-tight tracking-[-0.01em] text-ink">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View className="w-full">
        <PrimaryButton label={cta ?? "Continue"} onPress={onContinue} />
      </View>
    </View>
  );
}

export function MeetStep({ cta, onDone }: { cta?: string; onDone: () => void }) {
  return (
    <View className="flex-1 px-6 pb-2 bg-periwinkle">
      <View className="flex-1 items-center justify-center">
        <Animated.Image
          entering={FadeInDown.duration(500)}
          source={MEET_IMG}
          className="h-[70%] w-full"
          resizeMode="contain"
        />
      </View>
      <PrimaryButton label={cta ?? "Let's go!"} onPress={onDone} />
    </View>
  );
}
