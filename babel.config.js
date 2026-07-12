module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // reanimated 4 ships its babel plugin via react-native-worklets; must be last.
      'react-native-worklets/plugin',
    ],
  };
};
