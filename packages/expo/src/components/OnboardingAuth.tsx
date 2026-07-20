import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthOtpSteps, ErrorText } from "./auth/AuthOtpSteps";
import { useAuthMethods } from "./auth/useAuthMethods";

// Auth phase-0 of the 3D onboarding: the same sign-in flow as SignInScreen
// (shared via useAuthMethods) but with the methods list styled over the evening
// stage — white copy up top, blue/white pills down low, matching onboarding.tsx.
// The email/phone sub-steps hand off to the shared <AuthOtpSteps /> (a white
// sheet that covers the stage). Completion isn't signalled here — onboarding
// watches the auth store's `status` and advances when it flips to signedIn.

const ACCENT = "#4F46F0";
// Dev login shows in any non-production build (incl. Expo Web dev, where __DEV__
// is false — same reason DevPanel gates on its own flag). Stripped in prod.
const SHOW_DEV = process.env.NODE_ENV !== "production";

export function OnboardingAuth() {
  const insets = useSafeAreaInsets();
  const m = useAuthMethods();

  // email/phone entry + code steps render as a full white sheet over the stage
  if (m.screen !== "methods") {
    return (
      <View style={StyleSheet.absoluteFill}>
        <AuthOtpSteps m={m} />
      </View>
    );
  }

  const PhonePill = Platform.OS === "ios" ? WhitePill : BluePill;

  return (
    <>
      <Animated.View
        entering={FadeInUp.duration(500)}
        style={[styles.topCopy, { top: insets.top + 48 }]}
        pointerEvents="none"
      >
        <Text style={styles.h1}>someone’s excited{"\n"}to meet you.</Text>
        <Text style={styles.sub}>sign in to meet your sidekick.</Text>
      </Animated.View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.col}>
          {Platform.OS === "ios" ? (
            <BluePill
              label="continue with apple"
              onPress={m.apple.signInWithApple}
              disabled={m.providerBusy}
            />
          ) : null}
          <PhonePill
            label="continue with phone number"
            onPress={() => m.openMethod("phone")}
            disabled={m.providerBusy}
          />
          {m.showMoreOptions ? (
            <>
              <WhitePill
                label="continue with google"
                onPress={m.google.signInWithGoogle}
                disabled={m.providerBusy || !m.google.isGoogleAvailable}
              />
              <WhitePill
                label="continue with email"
                onPress={() => m.openMethod("email")}
                disabled={m.providerBusy}
              />
            </>
          ) : (
            <Pressable hitSlop={8} onPress={() => m.setShowMoreOptions(true)}>
              <Text style={styles.moreOptions}>more options</Text>
            </Pressable>
          )}
          {m.apple.error ? <ErrorText message={m.apple.error} /> : null}
          {m.google.error ? <ErrorText message={m.google.error} /> : null}
          {SHOW_DEV ? (
            <Pressable
              hitSlop={8}
              disabled={m.providerBusy}
              onPress={m.dev.signInAsDev}
              style={{ paddingVertical: 8 }}
            >
              <Text style={styles.devText}>{m.dev.isLoading ? "signing in…" : "dev login"}</Text>
              {m.dev.error ? <ErrorText message={m.dev.error} /> : null}
            </Pressable>
          ) : null}
        </View>
      </View>
    </>
  );
}

function BluePill({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  // Static style array (pressed via state) — css-interop drops the `({pressed}) =>`
  // callback form of `style` on native, leaving the pill with no fill.
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      style={[
        styles.blue,
        disabled ? styles.pillDisabled : null,
        pressed && !disabled ? styles.bluePressed : null,
      ]}
    >
      <Text style={styles.blueText}>{label}</Text>
    </Pressable>
  );
}

function WhitePill({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      style={[
        styles.white,
        disabled ? styles.pillDisabled : null,
        pressed && !disabled ? styles.whitePressed : null,
      ]}
    >
      <Text style={styles.whiteText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topCopy: { position: "absolute", left: 0, right: 0, paddingHorizontal: 32, alignItems: "center" },
  h1: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.1,
    lineHeight: 37,
    textAlign: "center",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  sub: {
    marginTop: 12,
    fontSize: 17,
    lineHeight: 22,
    textAlign: "center",
    color: "rgba(255,255,255,0.88)",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 28 },
  col: { width: "100%", maxWidth: 420, alignSelf: "center", gap: 12 },
  blue: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: ACCENT,
    alignItems: "center",
    shadowColor: "#372FC9",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  bluePressed: { transform: [{ translateY: 3 }], shadowOffset: { width: 0, height: 2 } },
  blueText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  white: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: "#fff",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 0,
    elevation: 3,
  },
  whitePressed: { transform: [{ translateY: 2 }], shadowOffset: { width: 0, height: 2 } },
  whiteText: { color: "#111", fontSize: 16, fontWeight: "600" },
  pillDisabled: { opacity: 0.5 },
  moreOptions: {
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    paddingVertical: 4,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  devText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});
