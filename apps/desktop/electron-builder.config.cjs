/**
 * Packaging configuration.
 *
 * This is JavaScript rather than YAML because signing is conditional: the same
 * build has to produce a correct unsigned app when no certificate is present,
 * and a signed, notarised one when there is. Expressing that as two static
 * files would guarantee they drift apart.
 *
 * Signed macOS builds need, in the environment:
 *   CSC_LINK                  path to or base64 of the .p12
 *   CSC_KEY_PASSWORD          its password
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID   for notarisation
 *
 * Signed Windows builds need CSC_LINK / CSC_KEY_PASSWORD too, or the Azure
 * Trusted Signing variables that electron-builder reads directly.
 */

const signMac = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize =
  Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

module.exports = {
  appId: 'com.crafillio.app',
  productName: 'API Devkit',
  copyright: 'Copyright © 2026 Amit Singh',

  directories: {
    output: 'release',
    buildResources: 'build',
  },

  // The main process is bundled by esbuild, so nothing from node_modules needs
  // to ship. This is what keeps the packaged app close to the Electron baseline.
  files: ['dist/**/*', 'package.json'],

  // Pinned explicitly: electron-builder downloads binaries for one exact
  // release and cannot resolve the "^43.3.0" range from package.json.
  electronVersion: '43.3.0',

  npmRebuild: false,

  // Runs after the app directory is assembled, before the installer is built:
  // strips unused media codecs, then re-signs macOS.
  afterPack: 'build/after-pack.cjs',

  mac: {
    artifactName: 'APIDevkit-mac-${arch}.${ext}',
    category: 'public.app-category.developer-tools',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],

    // `null` tells electron-builder to ad-hoc sign properly. Leaving it unset
    // while hardenedRuntime is on produced a signature that claimed sealed
    // resources it did not have, which macOS reports as "is damaged" — a worse
    // failure than plain "unidentified developer".
    identity: signMac ? undefined : null,

    // The hardened runtime is a prerequisite for notarisation and meaningless
    // without a real certificate, so it follows the certificate.
    hardenedRuntime: signMac,
    gatekeeperAssess: false,
    ...(signMac
      ? {
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.plist',
        }
      : {}),

    ...(notarize
      ? {
          notarize: {
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  },

  win: {
    artifactName: 'APIDevkit-windows-setup.${ext}',

    // Written into the executable's VERSIONINFO. A binary with no company
    // name and a vague description is part of what heuristic scanners weigh,
    // and it is what a user sees in the SmartScreen dialog and the file's
    // Properties tab. Free to get right; misleading to leave blank.
    legalTrademarks: '',
    verifyUpdateCodeSignature: false,
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
  },

  nsis: {
    artifactName: 'APIDevkit-windows-setup.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },

  // macOS and Windows only — the platforms this is distributed for.
};
