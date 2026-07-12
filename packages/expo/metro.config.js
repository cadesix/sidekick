// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Monorepo note: no explicit watchFolders/nodeModulesPaths needed here.
// @expo/metro-config (SDK 52+) auto-detects the pnpm workspace root and adds
// it to watchFolders, and .npmrc's node-linker=hoisted lets hierarchical
// lookup resolve everything from the root node_modules. If a future SDK
// upgrade breaks workspace-package resolution, this is the place to add them.
const config = getDefaultConfig(__dirname);

// Let Metro bundle 3D model + texture assets as static files (require()-able).
config.resolver.assetExts.push('glb', 'gltf', 'obj', 'mtl', 'bin', 'hdr');

module.exports = withNativeWind(config, { input: './global.css' });
