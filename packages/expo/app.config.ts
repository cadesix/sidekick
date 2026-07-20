import type { ExpoConfig } from "expo/config";

const APP_DISPLAY_NAME = "Sidekick";
const APP_SLUG = "sidekick";
const BUNDLE_IDENTIFIER = "com.sanssoftware.sidekick";
const APP_GROUP = `group.${BUNDLE_IDENTIFIER}`;
const APPLE_TEAM_ID = "DNCJ9P24DP";
const EAS_PROJECT_ID = "806b020d-e27e-4adf-9b81-4e6cf7bad44b";

const LOCATION_PERMISSION = `${APP_DISPLAY_NAME} uses only your city while the app is open, so it can understand what's nearby and keep local suggestions relevant.`;
const TRACKING_PERMISSION = `${APP_DISPLAY_NAME} uses your device identifier to personalize your experience.`;

// Screen Time needs the family-controls entitlement, which only exists on
// provisioning profiles Apple has approved. Set EXPO_PUBLIC_DISABLE_DEVICE_ACTIVITY=1
// to build without it (simulator, or before the entitlement is granted).
const deviceActivityEnabled =
  process.env.EXPO_PUBLIC_DISABLE_DEVICE_ACTIVITY !== "1";

// Meta ads attribution. Both values come from the Meta app dashboard; when
// either is missing the SDK is left out entirely rather than half-configured.
const facebookAppId = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
const facebookClientToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN;
const facebookEnabled = Boolean(facebookAppId && facebookClientToken);

export default function defineConfig({
  config,
}: {
  config: ExpoConfig;
}): ExpoConfig {
  return {
    ...config,
    name: APP_DISPLAY_NAME,
    slug: APP_SLUG,
    owner: "sans-software",
    scheme: "sidekickmobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    updates: {
      fallbackToCacheTimeout: 10_000,
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    },
    runtimeVersion: {
      policy: "appVersion",
    },
    ios: {
      bundleIdentifier: BUNDLE_IDENTIFIER,
      supportsTablet: true,
      appleTeamId: APPLE_TEAM_ID,
      infoPlist: {
        NSHealthShareUsageDescription: `${APP_DISPLAY_NAME} reads daily steps, active energy, sleep, and workout summaries for personalized goal support. If you choose to connect, ${APP_DISPLAY_NAME} stores up to 30 days of summaries and processes them with its AI provider.`,
        NSLocationWhenInUseUsageDescription: LOCATION_PERMISSION,
        NSLocalNetworkUsageDescription: `${APP_DISPLAY_NAME} connects to your local development server while you test the app on this iPhone.`,
        NSUserTrackingUsageDescription: TRACKING_PERMISSION,
        UIBackgroundModes: ["remote-notification"],
        ITSAppUsesNonExemptEncryption: false,
        // Allow refresh rates above 60fps so the 3D scene can use the full display.
        CADisableMinimumFrameDurationOnPhone: true,
      },
      entitlements: getEntitlements(),
      usesAppleSignIn: true,
    },
    android: {
      package: BUNDLE_IDENTIFIER,
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
      ],
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    extra: {
      router: {},
      eas: {
        projectId: EAS_PROJECT_ID,
        build: {
          experimental: {
            ios: {
              appExtensions: getAppExtensions(),
            },
          },
        },
      },
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
      buildCacheProvider: "eas",
    },
    plugins: getPlugins(),
  };
}

const getEntitlements = () => {
  const entitlements: NonNullable<ExpoConfig["ios"]>["entitlements"] = {
    "com.apple.security.application-groups": [APP_GROUP],
    // The three.js scene holds large textures; without this iOS kills the app
    // on lower-memory devices.
    "com.apple.developer.kernel.increased-memory-limit": true,
  };

  if (deviceActivityEnabled) {
    entitlements["com.apple.developer.family-controls"] = true;
  }

  return entitlements;
};

type AppExtension = {
  bundleIdentifier: string;
  targetName: string;
  entitlements?: Record<string, boolean | string[]>;
};

const getAppExtensions = (): AppExtension[] => {
  const notificationService: AppExtension = {
    bundleIdentifier: `${BUNDLE_IDENTIFIER}.NotificationService`,
    targetName: "NotificationService",
  };

  if (!deviceActivityEnabled) {
    return [notificationService];
  }

  const screenTime = [
    "ShieldConfiguration",
    "ShieldAction",
    "ActivityMonitorExtension",
  ].map((targetName) => ({
    bundleIdentifier: `${BUNDLE_IDENTIFIER}.${targetName}`,
    targetName,
    entitlements: {
      "com.apple.developer.family-controls": true,
      "com.apple.security.application-groups": [APP_GROUP],
    },
  }));

  return [...screenTime, notificationService];
};

const getPlugins = () => {
  const plugins: ExpoConfig["plugins"] = [];

  plugins.push(
    "expo-router",
    "expo-apple-authentication",
    "expo-asset",
    "expo-secure-store",
    "expo-notifications",
    "expo-web-browser",
    "expo-updates",
    "@react-native-community/datetimepicker",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission: LOCATION_PERMISSION,
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: `${APP_DISPLAY_NAME} uses the microphone so you can send voice notes in chat.`,
      },
    ],
    [
      "@kingstinct/react-native-healthkit",
      {
        background: true,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
        },
        ios: {
          deploymentTarget: "15.1",
        },
      },
    ],
    [
      "@sentry/react-native/expo",
      {
        url: "https://sentry.io/",
        project: `${APP_SLUG}-expo`,
        organization: "sans-software",
      },
    ],
  );

  if (deviceActivityEnabled) {
    plugins.push([
      "react-native-device-activity",
      {
        appleTeamId: APPLE_TEAM_ID,
        appGroup: APP_GROUP,
      },
    ]);
  }

  if (facebookEnabled) {
    plugins.push(
      "expo-tracking-transparency",
      [
        "react-native-fbsdk-next",
        {
          appID: facebookAppId,
          clientToken: facebookClientToken,
          displayName: APP_DISPLAY_NAME,
          scheme: `fb${facebookAppId}`,
          advertiserIDCollectionEnabled: true,
          autoLogAppEventsEnabled: true,
          isAutoInitEnabled: true,
          iosUserTrackingPermission: TRACKING_PERMISSION,
        },
      ],
      ["./with-aem-appdelegate.js"],
    );
  }

  return plugins;
};
