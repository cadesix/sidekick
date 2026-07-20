import { useState } from "react";
import {
  useAppleAuth,
  useDevLogin,
  useEmailAuth,
  useGoogleAuth,
  usePhoneAuth,
} from "~/lib/auth-providers";

// The auth state machine, lifted out of SignInScreen so both the sign-in screen
// and the 3D onboarding's auth phase drive the exact same flow (same provider
// hooks, same email/phone OTP sub-steps). Hosts render their own "methods"
// chrome (cream card vs. onboarding stage) and delegate the entry/code steps to
// <AuthOtpSteps />, which reads this hook's state.

export const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * Minimal E.164 normalizer: strip formatting, assume +1 for a bare 10-digit
 * (US) number. Returns null while the input can't be a valid E.164 number yet.
 */
export function normalizePhone(raw: string): string | null {
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

export type AuthMethods = ReturnType<typeof useAuthMethods>;

export function useAuthMethods() {
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

  // code step → back to the entry step (same method)
  const backToEntry = () => {
    setCode("");
    active.reset();
  };

  // entry step → back to the methods list
  const backToMethods = () => {
    active.reset();
    setScreen("methods");
  };

  return {
    apple,
    google,
    dev,
    email,
    phone,
    active,
    screen,
    showMoreOptions,
    setShowMoreOptions,
    emailInput,
    setEmailInput,
    phoneInput,
    setPhoneInput,
    code,
    providerBusy,
    canSend,
    sendCode,
    handleCodeChange,
    openMethod,
    backToEntry,
    backToMethods,
  };
}
