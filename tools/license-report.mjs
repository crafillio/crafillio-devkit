#!/usr/bin/env node
/**
 * Dependency licence audit.
 *
 * Walks node_modules, reads each package's declared licence, and flags
 * anything outside the permissive allowlist. Copyleft licences (GPL/AGPL/SSPL)
 * would impose obligations that an MIT-licensed distribution cannot satisfy,
 * so those exit non-zero and fail CI.
 *
 *   npm run licenses          # everything installed
 *   npm run licenses -- --json
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const asJson = process.argv.includes('--json');

/** Licences that impose no obligations we cannot meet under MIT. */
const PERMISSIVE = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BSD', 'Apache-2.0',
  'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'WTFPL', 'MIT-0',
  'CC-BY-4.0', 'CC-BY-3.0', 'Artistic-2.0', 'Zlib',
  // Fonts. OFL permits bundling and redistribution; it only forbids selling
  // the fonts on their own and requires the reserved name be respected.
  'OFL-1.1', 'SIL-OFL-1.1',
]);

/** Reciprocal / copyleft — a hard failure if it ships. */
const COPYLEFT = /\b(A?GPL|LGPL|SSPL|EUPL|OSL|CDDL|EPL|MPL)\b/i;

function collect(dir, found = new Map()) {
  if (!existsSync(dir)) return found;

  for (const entry of readdirSync(dir)) {
    if (entry === '.bin' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(full)) record(join(full, scoped), `${entry}/${scoped}`, found);
    } else {
      record(full, entry, found);
    }
  }
  return found;
}

function record(dir, name, found) {
  const manifestPath = join(dir, 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const licence =
        typeof manifest.license === 'string'
          ? manifest.license
          : (manifest.license?.type ?? manifest.licenses?.[0]?.type ?? 'UNKNOWN');
      if (!found.has(name)) found.set(name, { licence, version: manifest.version ?? '?' });
    } catch {
      /* Unreadable manifest is reported as UNKNOWN below. */
    }
  }
  // npm nests on version conflicts, so those copies must be audited too.
  collect(join(dir, 'node_modules'), found);
}

const installed = collect(join(root, 'node_modules'));

const byLicence = new Map();
const copyleft = [];
const review = [];
const unknown = [];

for (const [name, info] of [...installed].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (name.startsWith('@crafillio/')) continue;

  const licence = info.licence;
  byLicence.set(licence, (byLicence.get(licence) ?? 0) + 1);

  // "(MIT OR Apache-2.0)" style expressions pass if any branch is permissive.
  const parts = licence.replace(/[()]/g, '').split(/\s+OR\s+|\s+AND\s+/i).map((p) => p.trim());
  const permissive = parts.some((part) => PERMISSIVE.has(part));

  if (licence === 'UNKNOWN') unknown.push({ name, ...info });
  else if (permissive) continue;
  else if (COPYLEFT.test(licence)) copyleft.push({ name, ...info });
  else review.push({ name, ...info });
}

if (asJson) {
  console.log(JSON.stringify(
    { scanned: installed.size, breakdown: Object.fromEntries(byLicence), copyleft, review, unknown },
    null, 2,
  ));
} else {
  console.log('API Devkit — dependency licence report');
  console.log(`Packages scanned: ${installed.size}\n`);
  console.log('Licence breakdown');
  for (const [licence, count] of [...byLicence.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${licence}`);
  }

  if (unknown.length) {
    console.log(`\nUndeclared licence (${unknown.length}) — verify manually:`);
    for (const item of unknown) console.log(`  ${item.name}@${item.version}`);
  }
  if (review.length) {
    console.log(`\nUnrecognised licence (${review.length}) — verify manually:`);
    for (const item of review) console.log(`  ${item.name}@${item.version} — ${item.licence}`);
  }
  if (copyleft.length) {
    console.log(`\nCOPYLEFT — must not ship (${copyleft.length}):`);
    for (const item of copyleft) console.log(`  ${item.name}@${item.version} — ${item.licence}`);
  } else {
    console.log('\nNo copyleft dependencies. Safe to distribute under MIT.');
  }
}

process.exit(copyleft.length ? 1 : 0);
