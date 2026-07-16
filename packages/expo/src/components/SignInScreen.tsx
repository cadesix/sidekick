import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
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
import {
  useAppleAuth,
  useDevLogin,
  useEmailAuth,
  useGoogleAuth,
  usePhoneAuth,
} from "~/lib/auth-providers";
import { Pressable } from "./Pressable";
import { PrimaryButton } from "./PrimaryButton";
import { SolidShadow } from "./SolidShadow";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * Minimal E.164 normalizer: strip formatting, assume +1 for a bare 10-digit
 * (US) number. Returns null while the input can't be a valid E.164 number yet.
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) {
    if (/^[1-9]\d{7,14}$/.test(digits)) {
      return `+${digits}`;
    }
    return null;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return null;
}

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

function ErrorText({ message }: { message: string }) {
  return <Text className="text-[14px] leading-[1.4] text-red-500 text-center">{message}</Text>;
}

/**
 * The app's front door (19-auth.md), built from sidekick's own world: the
 * cream backdrop and white rounded-top card from the chat surface, with the
 * mascot peeking over the card's edge to greet you — your little friend is
 * already here, waiting to meet you. Primary methods are Apple + phone
 * (Apple is iOS-only, so on web phone is the single primary); Google + email
 * hide behind a quiet "more sign-in options" toggle. Phone/email push a
 * focused entry step, then a 6-digit code step that auto-submits on the 6th
 * digit. AuthGate swaps this for the app the moment a session lands.
 */
export function SignInScreen() {
  const insets = useSafeAreaInsets();
  const apple = useAppleAuth();
  const google = useGoogleAuth();
  const email = useEmailAuth();
  const phone = usePhoneAuth();
  const dev = useDevLogin();

  const [screen, setScreen] = useState<"methods" | "email" | "phone">("methods");
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");

  const active = screen === "email" ? email : phone;
  const providerBusy = apple.isAuthenticating || google.isAuthenticating || dev.isLoading;
  const normalizedPhone = normalizePhone(phoneInput);
  const canSend =
    screen === "email" ? EMAIL_PATTERN.test(emailInput.trim()) : normalizedPhone !== null;

  const sendCode = async () => {
    const destination = screen === "email" ? emailInput.trim().toLowerCase() : normalizedPhone;
    if (!destination) {
      return;
    }
    setCode("");
    await active.requestCode(destination);
  };

  const handleCodeChange = async (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !active.isLoading) {
      const ok = await active.verifyCode(digits);
      if (!ok) {
        setCode("");
      }
    }
  };

  const openMethod = (method: "email" | "phone") => {
    email.reset();
    phone.reset();
    setCode("");
    setScreen(method);
  };

  if (screen !== "methods" && active.step === "code") {
    return (
      <View
        className="flex-1 bg-white px-8"
        style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
      >
        <StatusBar style="dark" />
        <Pressable
          hitSlop={12}
          className="self-start py-2"
          onPress={() => {
            setCode("");
            active.reset();
          }}
        >
          <Text className="text-[15px] text-ink/55">← back</Text>
        </Pressable>
        <View className="flex-1 justify-center gap-5 pb-24 w-full max-w-md self-center">
          <Text className="text-[24px] font-semibold text-ink text-center">enter your code</Text>
          <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
            we sent a 6-digit code to{"\n"}
            <Text className="text-ink font-semibold">{active.destination}</Text>
          </Text>
          <TextInput
            className="bg-field rounded-full px-6 py-4 text-[22px] text-ink text-center tracking-[8px]"
            value={code}
            onChangeText={handleCodeChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            editable={!active.isLoading}
            placeholder="000000"
            placeholderTextColor="rgba(17,17,17,0.2)"
          />
          {active.isLoading ? <ActivityIndicator color="#111111" /> : null}
          {active.error ? <ErrorText message={active.error} /> : null}
          <Pressable hitSlop={8} disabled={active.isLoading} onPress={() => active.resendCode()}>
            <Text className="text-[14px] text-ink/45 text-center">
              didn’t get it? send a new code
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (screen !== "methods") {
    return (
      <View
        className="flex-1 bg-white px-8"
        style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
      >
        <StatusBar style="dark" />
        <Pressable
          hitSlop={12}
          className="self-start py-2"
          onPress={() => {
            active.reset();
            setScreen("methods");
          }}
        >
          <Text className="text-[15px] text-ink/55">← back</Text>
        </Pressable>
        <View className="flex-1 justify-center gap-5 pb-24 w-full max-w-md self-center">
          <Text className="text-[24px] font-semibold text-ink text-center">
            {screen === "email" ? "what’s your email?" : "what’s your number?"}
          </Text>
          <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
            {screen === "email"
              ? "we’ll email you a code — no passwords."
              : "we’ll text you a code — no passwords."}
          </Text>
          {screen === "email" ? (
            <TextInput
              className="bg-field rounded-full px-6 py-4 text-[16px] text-ink"
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="you@example.com"
              placeholderTextColor="rgba(17,17,17,0.35)"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              autoFocus
            />
          ) : (
            <TextInput
              className="bg-field rounded-full px-6 py-4 text-[16px] text-ink"
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="(555) 123-4567"
              placeholderTextColor="rgba(17,17,17,0.35)"
              keyboardType="phone-pad"
              autoComplete="tel"
              autoFocus
            />
          )}
          <PrimaryButton
            label="Send me a code"
            onPress={sendCode}
            disabled={!canSend}
            loading={active.isLoading}
          />
          {active.error ? <ErrorText message={active.error} /> : null}
        </View>
      </View>
    );
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
                onPress={apple.signInWithApple}
                disabled={providerBusy}
              />
            ) : null}
            {Platform.OS === "ios" ? (
              <ProviderButton
                label="continue with phone number"
                onPress={() => openMethod("phone")}
                disabled={providerBusy}
              />
            ) : (
              <PrimaryButton
                label="continue with phone number"
                onPress={() => openMethod("phone")}
                disabled={providerBusy}
              />
            )}
            {showMoreOptions ? (
              <>
                <ProviderButton
                  label="continue with google"
                  onPress={google.signInWithGoogle}
                  disabled={providerBusy || !google.isGoogleAvailable}
                />
                <ProviderButton
                  label="continue with email"
                  onPress={() => openMethod("email")}
                  disabled={providerBusy}
                />
              </>
            ) : (
              <Pressable hitSlop={8} onPress={() => setShowMoreOptions(true)}>
                <Text className="text-[14px] text-ink/45 text-center py-1">
                  more options
                </Text>
              </Pressable>
            )}
            {apple.error ? <ErrorText message={apple.error} /> : null}
            {google.error ? <ErrorText message={google.error} /> : null}
            {__DEV__ ? (
              <Pressable
                hitSlop={8}
                disabled={providerBusy}
                onPress={dev.signInAsDev}
                className="py-2"
              >
                <Text className="text-[13px] text-ink/35 text-center">
                  {dev.isLoading ? "signing in…" : "dev login"}
                </Text>
                {dev.error ? <ErrorText message={dev.error} /> : null}
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
