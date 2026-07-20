import { type ReactNode } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable } from "../Pressable";
import { PrimaryButton } from "../PrimaryButton";
import { type AuthMethods } from "./useAuthMethods";

// The email/phone OTP sub-steps (entry + 6-digit code), lifted verbatim from
// SignInScreen so the sign-in screen and the onboarding auth phase share one
// implementation. Both render their own "methods" list, then hand off here for
// the destination-entry and code screens once a method is chosen.

export function ErrorText({ message }: { message: string }) {
  return <Text className="text-[14px] leading-[1.4] text-red-500 text-center">{message}</Text>;
}

/** White sheet chrome for the entry + code steps: dark status bar + back affordance. */
function StepScreen({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-white px-8"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <StatusBar style="dark" />
      <Pressable hitSlop={12} className="self-start py-2" onPress={onBack}>
        <Text className="text-[15px] text-ink/55">← back</Text>
      </Pressable>
      {children}
    </View>
  );
}

/**
 * Renders the active OTP sub-step for the shared auth flow, or `null` while the
 * host is still on its methods list. `m` is the `useAuthMethods` hook value.
 */
export function AuthOtpSteps({ m }: { m: AuthMethods }) {
  if (m.screen === "methods") {
    return null;
  }

  const active = m.active;

  if (active.step === "code") {
    return (
      <StepScreen onBack={m.backToEntry}>
        <View className="flex-1 justify-center gap-5 pb-24 w-full max-w-md self-center">
          <Text className="text-[24px] font-semibold text-ink text-center">enter your code</Text>
          <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
            we sent a 6-digit code to{"\n"}
            <Text className="text-ink font-semibold">{active.destination}</Text>
          </Text>
          <TextInput
            className="bg-field rounded-full px-6 py-4 text-[22px] text-ink text-center tracking-[8px]"
            value={m.code}
            onChangeText={m.handleCodeChange}
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
            <Text className="text-[14px] text-ink/45 text-center">didn’t get it? send a new code</Text>
          </Pressable>
        </View>
      </StepScreen>
    );
  }

  return (
    <StepScreen onBack={m.backToMethods}>
      <View className="flex-1 justify-center gap-5 pb-24 w-full max-w-md self-center">
        <Text className="text-[24px] font-semibold text-ink text-center">
          {m.screen === "email" ? "what’s your email?" : "what’s your number?"}
        </Text>
        <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
          {m.screen === "email"
            ? "we’ll email you a code — no passwords."
            : "we’ll text you a code — no passwords."}
        </Text>
        {m.screen === "email" ? (
          <TextInput
            className="bg-field rounded-full px-6 py-4 text-[16px] text-ink"
            value={m.emailInput}
            onChangeText={m.setEmailInput}
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
            value={m.phoneInput}
            onChangeText={m.setPhoneInput}
            placeholder="(555) 123-4567"
            placeholderTextColor="rgba(17,17,17,0.35)"
            keyboardType="phone-pad"
            autoComplete="tel"
            autoFocus
          />
        )}
        <PrimaryButton
          label="Send me a code"
          onPress={m.sendCode}
          disabled={!m.canSend}
          loading={active.isLoading}
        />
        {active.error ? <ErrorText message={active.error} /> : null}
      </View>
    </StepScreen>
  );
}
