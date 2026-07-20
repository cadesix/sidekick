import { useEffect, type ReactNode } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthOtpSteps, ErrorText } from "./auth/AuthOtpSteps";
import { useAuthMethods } from "./auth/useAuthMethods";
import { Pressable } from "./Pressable";
import { PrimaryButton } from "./PrimaryButton";
import { SolidShadow } from "./SolidShadow";

/** Gentle idle bob for the peeking mascot — the screen's one animation. */
function IdleBob({ children }: { children: ReactNode }) {
  const y = useSharedValue(0);

  // Same precedent as SpeechBubble: an effect is the sanctioned way to kick
  // off a reanimated loop on mount.
  useEffect(() => {
    y.value = withRepeat(
      withTiming(-6, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [y]);

  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return <Animated.View style={animated}>{children}</Animated.View>;
}

/**
 * The sidekick's greeting, in its own overhead-speech-bubble style
 * (SpeechBubble.tsx): soft white bubble with the little square tail pointing
 * down at the head.
 */
function GreetingBubble({ text }: { text: string }) {
  return (
    <View style={{ alignItems: "flex-start" }}>
      <View
        style={{
          borderRadius: 16,
          backgroundColor: "rgba(255,255,255,0.95)",
          paddingHorizontal: 14,
          paddingVertical: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 5,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: "700", lineHeight: 17, color: "#111" }}>
          {text}
        </Text>
      </View>
      <View
        style={{
          marginTop: -5,
          marginLeft: 16,
          height: 10,
          width: 10,
          borderRadius: 2,
          backgroundColor: "rgba(255,255,255,0.95)",
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

/**
 * The peeking sidekick (chat-header.webp — the mascot gripping an edge with
 * both paws), bobbing gently as it hangs over the top of the sign-in card,
 * saying hi in its own speech bubble.
 */
function PeekingSidekick() {
  return (
    <IdleBob>
      <View style={{ width: 190, height: 106 }}>
        <View
          style={{ position: "absolute", top: -30, right: -44, transform: [{ rotate: "4deg" }] }}
        >
          <GreetingBubble text="you’re here!!" />
        </View>
        <Image
          source={require("../../assets/chat-header.webp")}
          style={{ width: 190, height: 106 }}
          contentFit="contain"
        />
      </View>
    </IdleBob>
  );
}

/** White brand pill with the hard ink shadow — the outlined counterpart of PrimaryButton. */
function ProviderButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View className={disabled ? "opacity-40" : ""}>
      <SolidShadow radius={999} onPress={onPress} disabled={disabled}>
        <View className="w-full py-4 items-center justify-center rounded-full bg-white">
          <Text className="text-ink text-[16px] font-semibold">{label}</Text>
        </View>
      </SolidShadow>
    </View>
  );
}

/**
 * Phone is a primary method everywhere; on iOS it sits under Apple as the
 * outlined pill, on web it stands alone as the filled primary. Both buttons
 * take the same props, so the only difference is which one renders.
 */
const PhoneButton = Platform.OS === "ios" ? ProviderButton : PrimaryButton;

/**
 * The app's front door (19-auth.md), built from sidekick's own world: the
 * cream backdrop and white rounded-top card from the chat surface, with the
 * mascot peeking over the card's edge to greet you. Primary methods are Apple +
 * phone (Apple is iOS-only, so on web phone is the single primary); Google +
 * email hide behind a quiet "more options" toggle. Phone/email push the shared
 * OTP sub-steps (<AuthOtpSteps />).
 *
 * NOTE: since the 3D onboarding became the front door, the AuthGate no longer
 * routes to this screen — the onboarding auth phase (OnboardingAuth) is the live
 * sign-in surface, sharing the same `useAuthMethods` flow. This is kept as the
 * cream-chrome variant for reference / possible reuse.
 */
export function SignInScreen() {
  const insets = useSafeAreaInsets();
  const m = useAuthMethods();

  if (m.screen !== "methods") {
    return <AuthOtpSteps m={m} />;
  }

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="flex-1 justify-center px-8 gap-3"
          style={{ paddingTop: insets.top + 24, paddingBottom: 56 }}
        >
          <Text className="text-[32px] font-bold text-ink text-center">
            someone’s excited{"\n"}to meet you.
          </Text>
          <Text className="text-[15px] text-ink/55 text-center">
            a friend that grows with you, {"\n"}day by day.
          </Text>
        </View>

        <View className="items-center z-10" style={{ marginBottom: -24 }}>
          <PeekingSidekick />
        </View>

        <View
          className="bg-white rounded-t-[32px] px-8 pt-12"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <View className="w-full max-w-md self-center gap-3">
            {Platform.OS === "ios" ? (
              <PrimaryButton
                label="continue with apple"
                onPress={m.apple.signInWithApple}
                disabled={m.providerBusy}
              />
            ) : null}
            <PhoneButton
              label="continue with phone number"
              onPress={() => m.openMethod("phone")}
              disabled={m.providerBusy}
            />
            {m.showMoreOptions ? (
              <>
                <ProviderButton
                  label="continue with google"
                  onPress={m.google.signInWithGoogle}
                  disabled={m.providerBusy || !m.google.isGoogleAvailable}
                />
                <ProviderButton
                  label="continue with email"
                  onPress={() => m.openMethod("email")}
                  disabled={m.providerBusy}
                />
              </>
            ) : (
              <Pressable hitSlop={8} onPress={() => m.setShowMoreOptions(true)}>
                <Text className="text-[14px] text-ink/45 text-center py-1">more options</Text>
              </Pressable>
            )}
            {m.apple.error ? <ErrorText message={m.apple.error} /> : null}
            {m.google.error ? <ErrorText message={m.google.error} /> : null}
            {__DEV__ ? (
              <Pressable
                hitSlop={8}
                disabled={m.providerBusy}
                onPress={m.dev.signInAsDev}
                className="py-2"
              >
                <Text className="text-[13px] text-ink/35 text-center">
                  {m.dev.isLoading ? "signing in…" : "dev login"}
                </Text>
                {m.dev.error ? <ErrorText message={m.dev.error} /> : null}
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
