import { useQueryClient } from "@tanstack/react-query";
import { logout, registerDevice, setAuthToken, signOut, type AuthResult } from "./api";
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY, useAuthStore } from "./auth-store";
import { clearProgressionMirrors } from "./mirror";
import { resetDockBadges } from "../store/dockBadges";
import { setStoredItem } from "./secure-storage";

/**
 * Persist a freshly-minted session and flip the app to signed-in. New users
 * land in the onboarding funnel automatically via `users.me` on the cleared
 * cache — no routing logic lives here. The userId is stored alongside the
 * token: the wardrobe/skin boot mirrors are scoped to it (plan 20 decision 10),
 * and both they and the query cache are wiped here so nothing from a previous
 * account survives the transition.
 */
export function useApplyAuthResult(): (result: AuthResult) => Promise<void> {
  const queryClient = useQueryClient();
  return async ({ token, userId }) => {
    await setStoredItem(TOKEN_STORAGE_KEY, token);
    await setStoredItem(USER_STORAGE_KEY, userId);
    setAuthToken(token);
    const { deviceId } = useAuthStore.getState();
    if (deviceId) {
      registerDevice(deviceId).catch(() => {
        // Fire-and-forget; the next launch's bootstrap retries.
      });
    }
    queryClient.clear();
    await clearProgressionMirrors();
    resetDockBadges(); // dock "seen" stamps are account state too
    useAuthStore.setState({ status: "signedIn", userId });
  };
}

/** Best-effort server logout, then local sign-out back to the SignInScreen. */
export function useSignOut(): () => Promise<void> {
  return async () => {
    try {
      await logout();
    } catch {
      // The session may already be dead server-side; local sign-out proceeds.
    }
    signOut();
  };
}
