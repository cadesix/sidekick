import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsGroup, SettingsRow } from "~/components/SettingsRow";
import { SolidShadow } from "~/components/SolidShadow";
import { ConnectedSettings } from "~/features/connections/ConnectedSettings";

function SignInRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View className="mb-2.5">
      <SolidShadow onPress={onPress}>
        <View className="bg-white rounded-2xl py-3.5 items-center">
          <Text className="text-[16px] font-bold text-ink">{label}</Text>
        </View>
      </SolidShadow>
    </View>
  );
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const [weeklyRecap, setWeeklyRecap] = useState(false);
  const [personalizedAds, setPersonalizedAds] = useState(false);

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
        <Text className="text-[20px] font-extrabold text-ink ml-1">Settings</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <SettingsGroup title="Account">
          <Text className="text-[15px] leading-[1.6] text-ink/55 mb-3">
            Save your progress so it's never lost.
          </Text>
          <SignInRow label="Continue with Apple" onPress={() => {}} />
          <SignInRow label="Continue with Google" onPress={() => {}} />
        </SettingsGroup>

        <SettingsGroup title="Email">
          <SettingsRow
            label="Weekly recap"
            subtitle="A short note from your sidekick every week."
            right={<Switch value={weeklyRecap} onValueChange={setWeeklyRecap} />}
          />
        </SettingsGroup>

        <SettingsGroup title="Ads & privacy">
          <SettingsRow
            label="Personalized ads"
            subtitle="Use your interests to show more relevant ads."
            right={<Switch value={personalizedAds} onValueChange={setPersonalizedAds} />}
          />
          <SettingsRow label="Do not sell or share my info" onPress={() => {}} />
          <SettingsRow label="Delete my account & data" destructive onPress={() => {}} />
        </SettingsGroup>

        <ConnectedSettings />

        <SettingsGroup title="Focus">
          <SettingsRow
            label="Focus mode"
            subtitle="Pick the apps I guard and set a daily budget."
            onPress={() => router.push("/focus-setup")}
          />
        </SettingsGroup>

        <SettingsGroup title="Reminders">
          <SettingsRow label="Reminders" subtitle="Everything you asked me to remember." onPress={() => router.push("/reminders")} />
        </SettingsGroup>

        <SettingsGroup title="Cosmetics">
          <SettingsRow label="Documents" subtitle="Notes and plans your sidekick made." onPress={() => router.push("/documents")} />
          <SettingsRow label="Locker" subtitle="Dress up your sidekick." onPress={() => router.push("/locker")} />
        </SettingsGroup>
      </ScrollView>
    </View>
  );
}
