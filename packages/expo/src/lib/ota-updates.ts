/**
 * OTA update lifecycle for Expo (expo-updates).
 *
 * What this hook does:
 * - On mount: schedules an update check after 10 seconds.
 * - On resume: if the app was backgrounded for at least 15 minutes, then either reload a pending update
 *   or schedule a new update check.
 * - On background: records the time and clears any scheduled checks so they don’t run while backgrounded.
 *
 * Design notes:
 * - A 10-second delayed check allows other initialization to settle and avoids early network churn.
 * - `isChecking` prevents concurrent `checkForUpdateAsync`/`fetchUpdateAsync` calls.
 * - `isUpdatePending` is read via a ref to avoid resubscribing AppState listeners as it changes.
 * - Every action is guarded by `expo-updates` being enabled; all errors are reported to Sentry.
 *
 * Usage: call `useOtaUpdates()` once at app startup (e.g., in your root layout). The hook returns nothing.
 */
import { captureException } from "@sentry/react-native";
import {
  checkForUpdateAsync,
  fetchUpdateAsync,
  isEnabled,
  reloadAsync,
  useUpdates,
} from "expo-updates";
import React from "react";
import type { AppStateStatus } from "react-native";
import { Alert, AppState } from "react-native";

/**
 * Minimum background duration (ms) required before doing update work upon resume.
 */
const MINIMUM_MINIMIZE_TIME = 15 * 60 * 1000;

/**
 * Initializes and manages the OTA update flow.
 */
export function useOtaUpdates() {
  const appState = React.useRef<AppStateStatus>(AppState.currentState ?? "active");
  const lastMinimize = React.useRef(0);
  const timeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isChecking = React.useRef(false);
  /** Prevents showing the reload prompt more than once until a reload occurs. */
  const hasPromptedRef = React.useRef(false);
  const { isUpdatePending } = useUpdates();
  const isPendingRef = React.useRef(isUpdatePending);

  // Keep the latest `isUpdatePending` without retriggering subscriptions.
  React.useEffect(() => {
    isPendingRef.current = isUpdatePending;
  }, [isUpdatePending]);

  const checkAndHandleUpdate = React.useCallback(async () => {
    if (!isEnabled) {
      return;
    }
    if (isChecking.current) {
      return;
    }

    try {
      isChecking.current = true;
      const res = await checkForUpdateAsync();
      if (res.isAvailable) {
        if (!isPendingRef.current) {
          await fetchUpdateAsync();
        }

        if (!hasPromptedRef.current) {
          hasPromptedRef.current = true;
          Alert.alert(
            "Update Available",
            "A new version of the app is available. Download now?",
            [
              {
                text: "No",
                style: "cancel",
              },
              {
                text: "Download",
                style: "default",
                onPress: async () => {
                  try {
                    await reloadAsync();
                  } catch (e) {
                    captureException(e, {
                      data: {
                        fn: "reloadAsync:onPress",
                      },
                    });
                  }
                },
              },
            ],
          );
        }
      }
    } catch (e) {
      captureException(e, {
        data: {
          fn: "checkAndHandleUpdate",
        },
      });
    } finally {
      isChecking.current = false;
    }
  }, []);

  /** Clear any scheduled delayed update check. */
  const clearCheckTimeout = React.useCallback(() => {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = null;
    }
  }, []);

  /** Schedule a delayed update check (10s), resetting any existing timer. */
  const setCheckTimeout = React.useCallback(() => {
    if (!isEnabled) {
      return;
    }
    clearCheckTimeout();
    timeout.current = setTimeout(() => {
      checkAndHandleUpdate().catch((e) => {
        captureException(e, {
          data: { fn: "checkAndHandleUpdate:setTimeout" },
        });
      });
    }, 10_000);
  }, [checkAndHandleUpdate, clearCheckTimeout]);

  /** On resume after enough time, reload pending update or schedule a new check. */
  const handleResumeIfEligible = React.useCallback(() => {
    const now = Date.now();
    const enoughTimeElapsed = lastMinimize.current <= now - MINIMUM_MINIMIZE_TIME;
    if (!enoughTimeElapsed) {
      return;
    }
    if (isPendingRef.current) {
      reloadAsync().catch((e) => {
        captureException(e, {
          data: { fn: "reloadAsync:onResume" },
        });
      });
      return;
    }
    setCheckTimeout();
  }, [setCheckTimeout]);

  /** Record background time and clear any scheduled checks. */
  const handleBackgrounding = React.useCallback(() => {
    lastMinimize.current = Date.now();
    clearCheckTimeout();
  }, [clearCheckTimeout]);

  React.useEffect(() => {
    // Schedule an update check after initialization
    setCheckTimeout();
    return () => {
      clearCheckTimeout();
    };
  }, [setCheckTimeout, clearCheckTimeout]);

  // After the app has been minimized for 15 minutes, we want to either A. install an update if one has become available
  // or B check for an update again.
  /** AppState change handler coordinating resume/background flows. */
  const onAppStateChange = React.useCallback(
    (nextAppState: AppStateStatus) => {
      if (!isEnabled) {
        return;
      }
      if (appState.current === nextAppState) {
        return;
      }

      const wasBackgrounded =
        appState.current === "inactive" || appState.current === "background";
      const isNowActive = nextAppState === "active";
      const isNowBackgrounded =
        nextAppState === "inactive" || nextAppState === "background";

      if (isNowBackgrounded) {
        handleBackgrounding();
        appState.current = nextAppState;
        return;
      }

      if (wasBackgrounded && isNowActive) {
        handleResumeIfEligible();
      }

      appState.current = nextAppState;
    },
    [handleBackgrounding, handleResumeIfEligible],
  );

  React.useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => {
      clearCheckTimeout();
      subscription.remove();
    };
  }, [onAppStateChange, clearCheckTimeout]);
}
