module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // three.js (r0.16x+) uses static class blocks in three.core.js; Hermes doesn't
      // support them and preset-expo's targets skip the transform, so force it here.
      '@babel/plugin-transform-class-static-block',
      // reanimated 4 ships its babel plugin via react-native-worklets; must be last.
      'react-native-worklets/plugin',
    ],
  };
};
