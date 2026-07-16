export default ({ config }) => {
  if (process.env.EXPO_PUBLIC_DISABLE_DEVICE_ACTIVITY !== "1") {
    return config;
  }

  const plugins = [];

  for (const plugin of config.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === "react-native-device-activity") {
      continue;
    }

    plugins.push(plugin);
  }

  return {
    ...config,
    plugins,
    extra: {
      ...config.extra,
      eas: {
        projectId: "a7d12cd6-d264-465b-9199-fbaacd985bcd",
      },
    },
  };
};
