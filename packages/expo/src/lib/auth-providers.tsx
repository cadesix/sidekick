import { useEffect, useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import { CodedError } from "expo-modules-core";
import * as WebBrowser from "expo-web-browser";
import { TRPCClientError } from "@trpc/client";
import {
  authenticateWithApple,
  authenticateWithGoogle,
  devLogin,
  requestEmailCode,
  requestPhoneCode,
  verifyEmailCode,
  verifyPhoneCode,
  type AuthResult,
} from "./api";
import { useApplyAuthResult } from "./auth-session";

/** On web the OAuth redirect lands back on the app; this closes the popup loop. */
WebBrowser.maybeCompleteAuthSession();

const GOOGLE_SIGN_IN_ERROR = "couldn’t sign in with Google — mind trying again?";

/** Server auth errors carry user-facing messages; zod issues arrive as JSON blobs we hide. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof TRPCClientError && !error.message.startsWith("[")) {
    return error.message;
  }
  return fallback;
}

/** Native Apple sign-in (iOS only) → `auth.authenticateWithApple` → session. */
export function useAppleAuth() {
  const applyAuthResult = useApplyAuthResult();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithApple = async () => {
    setError(null);
    setIsAuthenticating(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error("Apple returned no identity token");
      }
      const result = await authenticateWithApple(credential.identityToken);
      await applyAuthResult(result);
    } catch (e) {
      if (e instanceof CodedError && e.code === "ERR_REQUEST_CANCELED") {
        return;
      }
      setError(errorMessage(e, "couldn’t sign in with Apple — mind trying again?"));
    } finally {
      setIsAuthenticating(false);
    }
  };

  return { signInWithApple, isAuthenticating, error };
}

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
/**
 * Dev has no Google credentials yet: expo-auth-session throws when every client
 * id is undefined, so a placeholder keeps the hook mounted while
 * `isGoogleAvailable` keeps the button disabled.
 */
const PLACEHOLDER_GOOGLE_CLIENT_ID = "google-signin-unconfigured";

/** Google id-token flow (expo-auth-session) → `auth.authenticateWithGoogle` → session. */
export function useGoogleAuth() {
  const applyAuthResult = useApplyAuthResult();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGoogleAvailable = Boolean(GOOGLE_IOS_CLIENT_ID ?? GOOGLE_WEB_CLIENT_ID);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    clientId: PLACEHOLDER_GOOGLE_CLIENT_ID,
  });

  // The one sanctioned effect (see AGENTS.md carve-out): expo-auth-session
  // delivers the OAuth result as a hook value, so completing the sign-in has
  // to react to `response` changing.
  useEffect(() => {
    if (!response) {
      return;
    }
    if (response.type !== "success") {
      setIsAuthenticating(false);
      if (response.type === "error") {
        setError(GOOGLE_SIGN_IN_ERROR);
      }
      return;
    }
    const idToken = response.params.id_token;
    if (!idToken) {
      setIsAuthenticating(false);
      setError("Google didn’t send back a sign-in token — mind trying again?");
      return;
    }
    authenticateWithGoogle(idToken)
      .then((result) => applyAuthResult(result))
      .catch((e: unknown) => {
        setError(errorMessage(e, GOOGLE_SIGN_IN_ERROR));
      })
      .finally(() => setIsAuthenticating(false));
    // applyAuthResult is recreated per render; keying on it would re-run the
    // sign-in mutation. The response object is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const signInWithGoogle = async () => {
    if (!isGoogleAvailable || !request) {
      return;
    }
    setError(null);
    setIsAuthenticating(true);
    try {
      await promptAsync();
    } catch {
      setIsAuthenticating(false);
      setError(GOOGLE_SIGN_IN_ERROR);
    }
  };

  return { signInWithGoogle, isAuthenticating, isGoogleAvailable, error };
}

export type OtpAuth = {
  step: "destination" | "code";
  /** The email address / E.164 phone number the code was sent to. */
  destination: string;
  isLoading: boolean;
  error: string | null;
  requestCode: (destination: string) => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  resendCode: () => Promise<void>;
  reset: () => void;
};

function useOtpAuth(
  sendCode: (destination: string) => Promise<unknown>,
  verify: (destination: string, code: string) => Promise<AuthResult>,
): OtpAuth {
  const applyAuthResult = useApplyAuthResult();
  const [step, setStep] = useState<"destination" | "code">("destination");
  const [destination, setDestination] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (value: string) => {
    setIsLoading(true);
    setError(null);
    setDestination(value);
    try {
      await sendCode(value);
      setStep("code");
      return true;
    } catch (e) {
      setError(errorMessage(e, "couldn’t send the code — mind trying again?"));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await verify(destination, code);
      await applyAuthResult(result);
      return true;
    } catch (e) {
      setError(errorMessage(e, "that code didn’t work — mind trying again?"));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const resendCode = async () => {
    await requestCode(destination);
  };

  const reset = () => {
    setStep("destination");
    setDestination("");
    setError(null);
  };

  return { step, destination, isLoading, error, requestCode, verifyCode, resendCode, reset };
}

/** Two-step email OTP (19-auth.md): request a 6-digit code, verify it → session. */
export function useEmailAuth(): OtpAuth {
  return useOtpAuth(requestEmailCode, verifyEmailCode);
}

/** Two-step SMS OTP mirroring email (19-auth.md). Pass an E.164 phone number. */
export function usePhoneAuth(): OtpAuth {
  return useOtpAuth(requestPhoneCode, verifyPhoneCode);
}

/** Instant dev session — the button only renders under `__DEV__`, the server env-gates it too. */
export function useDevLogin() {
  const applyAuthResult = useApplyAuthResult();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInAsDev = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await devLogin();
      await applyAuthResult(result);
    } catch (e) {
      setError(errorMessage(e, "dev login failed — is the server running in development?"));
    } finally {
      setIsLoading(false);
    }
  };

  return { signInAsDev, isLoading, error };
}
