/**
 * SatvAAh Metro Config
 * Turborepo monorepo support · pnpm symlink fix · asset extensions
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

// Prevent Metro from watching Docker service files (services/, packages/)
// ts-node-dev touching these files causes spurious hot reloads that break
// the expo-font singleton deduplication
config.resolver.blockList = [
  /.*\/services\/.*/,
  /.*\/packages\/.*/,
  /.*\/scripts\/.*/,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules/.pnpm/node_modules'),
];

config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = false; // SDK 51 + pnpm: packageExports causes registry duplication

config.resolver.assetExts = [
  ...config.resolver.assetExts,
  'ttf', 'otf', 'png', 'jpg', 'webp', 'svg', 'lottie',
];

config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'tsx', 'ts', 'jsx', 'js', 'json',
];

// Native-only packages → pure-JS stubs for Expo Go
const STUBS = {
  'react-native-branch':            path.resolve(__dirname, 'src/__stubs__/branch.ts'),
  'react-native-mmkv':              path.resolve(__dirname, 'src/__stubs__/mmkv.ts'),
  'react-native-maps':              path.resolve(__dirname, 'src/__stubs__/maps.ts'),
  'react-native-razorpay':          path.resolve(__dirname, 'src/__stubs__/razorpay.ts'),
  '@gorhom/bottom-sheet':           path.resolve(__dirname, 'src/__stubs__/bottom-sheet.tsx'),
  '@shopify/flash-list':            path.resolve(__dirname, 'src/__stubs__/flash-list.tsx'),
  'react-native-get-random-values': path.resolve(__dirname, 'src/__stubs__/get-random-values.ts'),
  '@react-native-firebase/auth':    path.resolve(__dirname, 'src/__stubs__/firebase-auth.ts'),
  'react-native-uuid':              path.resolve(__dirname, 'src/__stubs__/react-native-uuid.ts'),
  'expo-crypto':                    path.resolve(__dirname, 'src/__stubs__/expo-crypto.ts'),
};

// Deduplicate React — pnpm creates multiple copies (react@18.2.0 for mobile,
// react@18.3.1 for admin-web/Next.js). Metro picks up both, causing
// "Invalid hook call" and "dispatcher is null" errors.
// Force ALL 'react' and 'react-native' imports to resolve from projectRoot.
const DEDUPE = [
  'react',
  'react-dom',
  'react-native',
  'expo-asset',                    // prevent registry duplication across monorepo
  '@react-native/assets-registry', // owns the actual registry Map — must be singleton
  'expo-font',                     // font registry must be singleton — prevents
                                   // "Cannot read property 'set' of undefined" crash
  'expo-modules-core',             // core native module registry — must be singleton
  '@react-native-async-storage',   // async storage singleton for MMKV stub persistence
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // 0. Deduplicate critical packages — resolve from project root.
  // IMPORTANT: Use prefix matching, not exact matching.
  // Metro's asset pipeline imports sub-paths like 'expo-asset/build/Asset',
  // 'expo-asset/build/AssetRegistry' etc. Exact matching misses these,
  // causing two separate registry instances → selectAssetSource crash.
  const isDeduped = DEDUPE.some(
    (pkg) => moduleName === pkg || moduleName.startsWith(pkg + '/'),
  );
  if (isDeduped) {
    return context.resolveRequest(
      { ...context, originModulePath: path.resolve(projectRoot, 'index.js') },
      moduleName,
      platform,
    );
  }

  // 1. Top-level stub packages
  if (STUBS[moduleName]) {
    return { filePath: STUBS[moduleName], type: 'sourceFile' };
  }

  // 2. expo-crypto internal native modules — redirect to .web.js versions.
  // When any file inside expo-crypto imports './ExpoCrypto' or './ExpoCryptoAES',
  // those resolve to native-only files. We redirect to their .web.js siblings.
  const origin = context.originModulePath || '';
  if (origin.includes('expo-crypto')) {
    const resolved = context.resolveRequest(context, moduleName, platform);
    if (resolved && resolved.filePath) {
      const fp = resolved.filePath;
      // If the resolved file is a native-only ExpoCrypto file, use .web.js instead
      if (fp.includes('ExpoCrypto.js') && !fp.includes('.web.js')) {
        const webPath = fp.replace('ExpoCrypto.js', 'ExpoCrypto.web.js');
        if (fs.existsSync(webPath)) {
          return { filePath: webPath, type: 'sourceFile' };
        }
      }
      if (fp.includes('ExpoCryptoAES.js') && !fp.includes('.web.js')) {
        const webPath = fp.replace('ExpoCryptoAES.js', 'ExpoCryptoAES.web.js');
        if (fs.existsSync(webPath)) {
          return { filePath: webPath, type: 'sourceFile' };
        }
      }
    }
    return resolved;
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
