// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Let Metro bundle 3D model + texture assets as static files (require()-able).
config.resolver.assetExts.push('glb', 'gltf', 'obj', 'mtl', 'bin', 'hdr');

module.exports = withNativeWind(config, { input: './global.css' });
