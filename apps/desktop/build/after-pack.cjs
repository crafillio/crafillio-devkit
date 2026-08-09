/**
 * Post-packaging signing.
 *
 * Ad-hoc signs macOS builds when no certificate is configured.
 *
 * Without this, electron-builder skips signing entirely and leaves Electron's
 * own signature on a bundle whose contents have changed, which macOS reports
 * as "damaged" — a dead end for the user rather than the ordinary
 * "unidentified developer" prompt they can get past.
 *
 * A note for anyone tempted by the obvious size win: do NOT delete
 * ffmpeg.dll / libffmpeg.dylib. This app plays no audio or video, so the
 * library looks like 2.9 MB of dead weight and removing it is widely
 * suggested as a way to dodge antivirus false positives. It is not optional.
 * The Electron Framework links it at load time, so the app dies before it
 * starts:
 *
 *     Library not loaded: @rpath/libffmpeg.dylib
 *     Termination Reason: DYLD, Code 1 — Library missing
 *
 * Windows behaves the same way. Antivirus flags are a signing problem, not a
 * payload problem.
 */

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) throw new Error(`Nothing to sign at ${appPath}`);

  // Nested code must be signed before the bundle containing it, otherwise the
  // outer signature seals a frame that is about to change.
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  );

  // Fail the build rather than ship something macOS will call damaged.
  execFileSync('codesign', ['--verify', '--strict', appPath], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed and verified  ${appPath}`);
};
