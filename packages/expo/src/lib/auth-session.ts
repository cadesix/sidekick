import { useQueryClient } from "@tanstack/react-query";
import { logout, registerDevice, setAuthToken, type AuthResult } from "./api";
import { TOKEN_STORAGE_KEY, useAuthStore } from "./auth-store";
import { removeStoredItem, setStoredItem } from "./secure-storage";

/**
 * Persist a freshly-minted session and flip the app to signed-in. New users
 * land in the onboarding funnel automatically via `users.me` on the cleared
 * cache — no routing logic lives here.
 */
export function useApplyAuthResult(): (result: AuthResult) => Promise<void> {
  const queryClient = useQueryClient();
  return async ({ token }) => {
    await setStoredItem(TOKEN_STORAGE_KEY, token);
    setAuthToken(token);
    const { deviceId } = useAuthStore.getState();
    if (deviceId) {
      registerDevice(deviceId).catch(() => {
        // Fire-and-forget; the next launch's bootstrap retries.
      });
    }
    queryClient.clear();
    useAuthStore.setState({ status: "signedIn" });
  };
}

/** Best-effort server logout, then local sign-out back to the SignInScreen. */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    try {
      await logout();
    } catch {
      // The session may already be dead server-side; local sign-out proceeds.
    }
    await removeStoredItem(TOKEN_STORAGE_KEY);
    setAuthToken(null);
    queryClient.clear();
    useAuthStore.setState({ status: "signedOut" });
  };
}
