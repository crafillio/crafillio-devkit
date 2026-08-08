/**
 * Re-signs an unsigned build ad-hoc.
 *
 * Without a certificate, electron-builder skips signing altogether — which
 * leaves Electron's own signature on the bundle. That signature seals the
 * resources Electron shipped with, and packaging replaces them, so macOS finds
 * a signature promising files that are no longer there and reports the app as
 * "damaged". That message is not about corruption and gives the user nothing
 * to act on.
 *
 * An ad-hoc signature does not make the app trusted — Gatekeeper still asks
 * before first launch, which is correct for an unsigned build — but it makes
 * the bundle internally consistent, so the prompt is the honest "unidentified
 * developer" one that a user can actually get past.
 *
 * Skipped entirely when a real identity is configured, since electron-builder
 * has then already signed properly.
 */

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  if (!existsSync(appPath)) throw new Error(`Nothing to sign at ${appPath}`);

  // Nested code must be signed before the bundle that contains it, otherwise
  // the outer signature seals a frame that is about to change.
  execFileSync('codesign', [
    '--force',
    '--deep',
    '--sign', '-',
    '--timestamp=none',
    appPath,
  ], { stdio: 'inherit' });

  // Fail the build rather than ship something that will greet the user as
  // "damaged" — this is exactly the check that was missing before.
  execFileSync('codesign', ['--verify', '--strict', appPath], { stdio: 'inherit' });

  console.log(`  • ad-hoc signed and verified  ${appPath}`);
};
