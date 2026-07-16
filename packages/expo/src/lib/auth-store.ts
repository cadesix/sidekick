import { create } from "zustand";

/** Storage keys shared by the auth gate (lib/auth.tsx) and the 401 handler (lib/api.ts). */
export const DEVICE_STORAGE_KEY = "sidekick.deviceId";
export const TOKEN_STORAGE_KEY = "sidekick.token";

/**
 * Signed-in state (19-auth.md): "loading" until the storage bootstrap resolves,
 * then flipped by applyAuthResult/signOut (lib/auth.tsx) and by the consecutive-401
 * handler (lib/api.ts). AuthGate renders the SignInScreen whenever this is
 * "signedOut" — sessions are the only credential, there is no anonymous mode.
 */
type AuthState = {
  status: "loading" | "signedIn" | "signedOut";
  /** Install id minted on first launch — identifies this device for push tokens. */
  deviceId: string | null;
};

export const useAuthStore = create<AuthState>(() => ({
  status: "loading",
  deviceId: null,
}));
