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

const nwConfig = withNativeWind(config, { input: './global.css' });

// zustand's ESM build (which Metro selects for web via package exports) uses
// Vite-style `import.meta.env` in its devtools middleware — a SyntaxError in
// Metro's classic web bundle ("Cannot use 'import.meta' outside a module").
// zustand's CommonJS build is import.meta-free (uses process.env), so force
// zustand to CJS on the web platform. Set AFTER withNativeWind so its resolver
// doesn't clobber this. Native is untouched.
const prevResolveRequest = nwConfig.resolver.resolveRequest;
nwConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (moduleName === 'zustand' || moduleName === 'zustand/middleware')) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName) };
  }
  return prevResolveRequest
    ? prevResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = nwConfig;
