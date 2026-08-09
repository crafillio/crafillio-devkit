#!/usr/bin/env node
/**
 * Generates docs/index.html — the project showcase, ready for GitHub Pages.
 *
 * Fonts are inlined so the page is one self-contained file that renders
 * identically offline and on Pages, with no CDN and nothing to go stale.
 * Feature copy lives in this file so the page is regenerated, never
 * hand-edited into drift.
 *
 *   npm run site
 *   npm run site -- --artifact --out <path>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactMode = process.argv.includes('--artifact');
const outArg = process.argv.indexOf('--out');
const outPath = outArg !== -1 ? process.argv[outArg + 1] : join(root, 'docs/index.html');

const AUTHOR = 'Amit Singh';
const HANDLE = 'crafillio';
const REPO = 'https://github.com/crafillio/crafillio-devkit';
const GH_USER = `https://github.com/${HANDLE}`;
const RELEASES = `${REPO}/releases/latest`;
/**
 * Direct asset links. `/releases/latest/download/<name>` always resolves to the
 * newest release's asset of that name, so these survive every version bump —
 * which is why the installers are named without a version in them.
 */
const DL = `${REPO}/releases/latest/download`;
const DOWNLOAD = {
  macArm: `${DL}/APIDevkit-mac-arm64.dmg`,
  macIntel: `${DL}/APIDevkit-mac-x64.dmg`,
  windows: `${DL}/APIDevkit-windows-setup.exe`,
  windowsPortable: `${DL}/APIDevkit-windows-portable-x64.zip`,
};
/** GitHub serves every account's avatar here; no API call needed. */
const AVATAR = `https://github.com/${HANDLE}.png?size=240`;

/**
 * About copy.
 *
 * Deliberately about the work rather than the person: biography, employer and
 * location are the author's to write, and are marked in github-profile/SETUP.md
 * rather than invented here.
 */
const ROLE = 'Full-stack developer · Open-source professional';

const ABOUT = [
  'I work across the stack — services, data and the interfaces on top of them — and I build developer tools for the work I do every day.',
  'Everything I release runs on your own machine. No account, no telemetry, no service in the middle deciding what it may keep. Your work stays as plain files you can read, diff and commit.',
];

/** Grouped so the list reads as areas of work, not a keyword dump. */
const STACK = [
  { group: 'Languages', items: ['Java', 'Python', 'TypeScript', 'JavaScript'] },
  { group: 'Frontend', items: ['Angular', 'React', 'Electron'] },
  { group: 'Data', items: ['PostgreSQL', 'Oracle', 'Neo4j'] },
  { group: 'Platform', items: ['Docker', 'Kubernetes', 'Camunda'] },
];

/** The avatar is copied into docs/assets so the page needs nothing remote. */
const AVATAR_LOCAL = 'assets/avatar.jpg';

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

const FONTS = [
  { family: 'Space Grotesk Variable', pkg: 'space-grotesk', range: '300 700' },
  { family: 'Inter Tight Variable', pkg: 'inter-tight', range: '100 900' },
  { family: 'JetBrains Mono Variable', pkg: 'jetbrains-mono', range: '100 800' },
];

const fontFaces = FONTS.map(({ family, pkg, range }) => {
  const file = join(root, `node_modules/@fontsource-variable/${pkg}/files/${pkg}-latin-wght-normal.woff2`);
  if (!existsSync(file)) return '';
  const data = readFileSync(file).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${range};src:url(data:font/woff2;base64,${data}) format('woff2-variations');}`;
}).join('\n');

/* ------------------------------------------------------------------ */
/* Content — every number here is one this repository can prove         */
/* ------------------------------------------------------------------ */

/** Small line glyphs, one per capability. Simple enough to read at 20px. */
const ICONS = {
  rest: '<path d="M4 7h16M4 12h10M4 17h13" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  grpc: '<circle cx="6" cy="12" r="2.6" fill="currentColor"/><circle cx="18" cy="6.5" r="2.6" fill="currentColor"/><circle cx="18" cy="17.5" r="2.6" fill="currentColor"/><path d="M8.4 11 15.6 7.4M8.4 13l7.2 3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  s3: '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3v10c0 1.7-3.6 3-8 3s-8-1.3-8-3V7Z" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M4 7c0 1.7 3.6 3 8 3s8-1.3 8-3" stroke="currentColor" stroke-width="1.9" fill="none"/>',
  workflow: '<rect x="3" y="4" width="7" height="5.5" rx="1.6" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="14" y="14.5" width="7" height="5.5" rx="1.6" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M10 6.8h4.5a3 3 0 0 1 3 3v4.7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  load: '<path d="M4 18V9M9.3 18V5M14.7 18v-6M20 18v-9" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" fill="none"/>',
  report: '<path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M14 3v4h4M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
};

const TOOLS = [
  {
    name: 'API Devkit',
    status: 'v1.0.0',
    tagline: 'REST, gRPC, S3, workflows and load testing in one offline-first desktop app.',
    blurb:
      'Most teams keep three tools open — one for HTTP, one for gRPC, a browser tab for buckets — ' +
      'then reach for a fourth when someone asks how fast it is. API Devkit puts all four behind ' +
      'one tab strip, one set of environment variables and one collection format, and never sends ' +
      'your data anywhere.',
    repo: REPO,
    tags: ['Electron', 'TypeScript', 'React', 'MIT'],
    features: [
      {
        icon: 'rest',
        title: 'REST that shows its working',
        body:
          'Five body kinds including multipart with file parts, three auth schemes, and redirects ' +
          'followed manually so you see the whole hop chain rather than just the final response. ' +
          'Timing splits into total and time-to-first-byte.',
      },
      {
        icon: 'grpc',
        title: 'gRPC that knows your schema',
        body:
          'Server reflection (v1, falling back to v1alpha) or local .proto files, unified onto one ' +
          'root. All four call types. Editors prefilled from the schema, with enums as names and ' +
          'int64 as strings so nothing is lost through JSON.',
      },
      {
        icon: 's3',
        title: 'S3 without losing your headers',
        body:
          'Browse, upload, download, batch and recursive delete, presigned URLs. Metadata editing ' +
          'reads the object first and passes through what you did not change — S3 has no in-place ' +
          'update, and the copy-based one silently drops headers you omit.',
      },
      {
        icon: 'workflow',
        title: 'Visual workflows',
        body:
          'Drag nodes on a canvas and wire them together; the wires set execution order. Steps mix ' +
          'REST and gRPC freely, so you can authenticate over HTTP then call a gRPC service with ' +
          'the token. Every stage stays clickable during and after a run.',
      },
      {
        icon: 'load',
        title: 'Load testing built in',
        body:
          'Duration or iteration runs with ramp-up, an RPS ceiling and an error-rate circuit ' +
          'breaker. Percentiles come from a reservoir sample, so a long run keeps flat memory ' +
          'without discarding the tail — where the interesting latency lives.',
      },
      {
        icon: 'report',
        title: 'Reports you can hand over',
        body:
          'A run renders as one self-contained HTML file — or a PDF — reproducing the canvas you ' +
          'drew, every request and response, and any file the run produced, embedded so it ' +
          'downloads straight from the page.',
      },
    ],
    proof: [
      { figure: '302', label: 'assertions', note: 'against real servers, not mocks' },
      { figure: '0', label: 'vulnerabilities', note: 'in shipped dependencies' },
      { figure: '0', label: 'telemetry calls', note: 'it makes none of its own' },
      { figure: '5', label: 'import formats', note: 'Postman, OpenAPI, Bruno, Hoppscotch, curl' },
    ],
    principles: [
      ['Offline by default', 'No telemetry, no analytics, no update ping, no account. The only traffic is the requests you make.'],
      ['Your data, your disk', 'Collections are plain JSON under your home directory. Secrets are encrypted before they touch it.'],
      ['Honest numbers', 'A 4xx counts as a failure in a load test. Reporting it as success would hide a broken target.'],
      ['No silent failure', 'An undefined variable is reported, not replaced with an empty string.'],
    ],
  },
];

/* ------------------------------------------------------------------ */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LOGO = (size, cls = '') => `
<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="currentColor" class="${cls}" aria-hidden="true">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M 21.24 14.52 L 21.51 12.37 A 11.4 11.4 0 0 1 26.49 12.37 L 26.76 14.52 A 9.4 9.4 0 0 1 28.40 15.19 L 30.11 13.87 A 11.4 11.4 0 0 1 33.63 17.39 L 32.31 19.10 A 9.4 9.4 0 0 1 32.98 20.74 L 35.13 21.01 A 11.4 11.4 0 0 1 35.13 25.99 L 32.98 26.26 A 9.4 9.4 0 0 1 32.31 27.90 L 33.63 29.61 A 11.4 11.4 0 0 1 30.11 33.13 L 28.40 31.81 A 9.4 9.4 0 0 1 26.76 32.48 L 26.49 34.63 A 11.4 11.4 0 0 1 21.51 34.63 L 21.24 32.48 A 9.4 9.4 0 0 1 19.60 31.81 L 17.89 33.13 A 11.4 11.4 0 0 1 14.37 29.61 L 15.69 27.90 A 9.4 9.4 0 0 1 15.02 26.26 L 12.87 25.99 A 11.4 11.4 0 0 1 12.87 21.01 L 15.02 20.74 A 9.4 9.4 0 0 1 15.69 19.10 L 14.37 17.39 A 11.4 11.4 0 0 1 17.89 13.87 L 19.60 15.19 A 9.4 9.4 0 0 1 21.24 14.52 Z M 30.9 23.5 A 6.9 6.9 0 1 0 17.1 23.5 A 6.9 6.9 0 1 0 30.9 23.5 Z"/>
  <circle cx="5.9" cy="13.88" r="3.6"/><line x1="15.17" y1="18.81" x2="8.6" y2="15.32" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  <circle cx="4.5" cy="23.5" r="3.3"/><line x1="14" y1="23.5" x2="7.3" y2="23.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  <circle cx="9.14" cy="36.88" r="3.4"/><line x1="16.57" y1="30.19" x2="11.29" y2="34.95" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  <circle cx="42.1" cy="13.88" r="3.6"/><line x1="32.83" y1="18.81" x2="39.4" y2="15.32" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  <circle cx="38.86" cy="36.88" r="3.4"/><line x1="31.43" y1="30.19" x2="36.71" y2="34.95" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
  <text x="24" y="23.5" text-anchor="middle" dominant-baseline="central" font-family="'Space Grotesk Variable',system-ui" font-size="6.6" font-weight="700">API</text>
</svg>`;

const toolSection = (tool, index) => `
<section class="tool" id="tool-${index}">
  <div class="tool-head">
    <div class="tool-mark">${LOGO(46)}</div>
    <div>
      <div class="tool-status">${esc(tool.status)}</div>
      <h2>${esc(tool.name)}</h2>
      <p class="tool-tagline">${esc(tool.tagline)}</p>
    </div>
  </div>

  <p class="tool-blurb">${esc(tool.blurb)}</p>

  <div class="tags">
    ${tool.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
    <a class="tag tag-link" href="${esc(tool.repo)}">Source →</a>
  </div>

  <div class="proof">
    ${tool.proof.map((p) => `
      <div class="proof-item">
        <div class="proof-figure">${esc(p.figure)}</div>
        <div class="proof-label">${esc(p.label)}</div>
        <div class="proof-note">${esc(p.note)}</div>
      </div>`).join('')}
  </div>

  <h3 class="sub">What it does</h3>
  <div class="features">
    ${tool.features.map((f) => `
      <article class="feature">
        <span class="feature-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24">${ICONS[f.icon] ?? ''}</svg>
        </span>
        <h4>${esc(f.title)}</h4>
        <p>${esc(f.body)}</p>
      </article>`).join('')}
  </div>

  <h3 class="sub">How it behaves</h3>
  <dl class="principles">
    ${tool.principles.map(([term, def]) => `
      <div class="principle">
        <dt>${esc(term)}</dt>
        <dd>${esc(def)}</dd>
      </div>`).join('')}
  </dl>

  <div class="cta">
    <a class="btn btn-primary" href="${esc(tool.repo)}">View on GitHub</a>
    <a class="btn" href="${esc(tool.repo)}#getting-started">Build from source</a>
  </div>
</section>`;

const body = `
<a class="skip" href="#main">Skip to content</a>

<header class="top">
  <div class="wrap top-inner">
    <a class="brand" href="#main">
      <span class="brand-mark">${LOGO(24)}</span>
      <span>${esc(AUTHOR)}</span>
    </a>
    <nav>
      <a href="#tools">Tools</a>
      <a href="#download">Download</a>
      <a href="how-it-works.html">How it works</a>
      <a href="${esc(GH_USER)}">GitHub</a>
    </nav>
  </div>
</header>

<main id="main">
  <section class="wrap intro" id="about">
    <div class="intro-grid">
      <div class="intro-photo">
        <img src="${esc(AVATAR_LOCAL)}" alt="${esc(AUTHOR)}" width="120" height="120"
             onerror="this.closest('.intro-photo').classList.add('no-photo')">
        <span class="intro-initials" aria-hidden="true">AS</span>
      </div>

      <div>
        <h1>${esc(AUTHOR)}</h1>
        <p class="role">${esc(ROLE)}</p>
        ${ABOUT.map((p) => `<p class="intro-copy">${esc(p)}</p>`).join('')}

        <div class="stack">
          ${STACK.map((g) => `
            <div class="stack-row">
              <span class="stack-label">${esc(g.group)}</span>
              <span class="stack-items">
                ${g.items.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}
              </span>
            </div>`).join('')}
          <p class="stack-more">…and whatever the problem needs.</p>
        </div>

        <div class="cta">
          <a class="btn btn-primary" href="${esc(GH_USER)}">GitHub profile</a>
          <a class="btn" href="${esc(REPO)}">Source</a>
        </div>
      </div>
    </div>
  </section>

  <section class="wrap tools-section" id="tools">
    <h2 class="section-title">Tools I build</h2>
    <p class="lede small">
      Open source, offline-first, and made to be read. More are on the way.
    </p>

    <div class="tool-grid">
      ${TOOLS.map((tool, i) => `
        <article class="tool-card">
          <div class="tool-card-head">
            <span class="tool-card-mark">${LOGO(30)}</span>
            <div>
              <h3>${esc(tool.name)}</h3>
              <span class="tool-card-status">${esc(tool.status)} · MIT</span>
            </div>
          </div>
          <p class="tool-card-tagline">${esc(tool.tagline)}</p>
          <ul class="tool-card-list">
            ${tool.features.map((f) => `
              <li>
                <span class="li-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24">${ICONS[f.icon] ?? ''}</svg>
                </span>
                ${esc(f.title)}
              </li>`).join('')}
          </ul>
          <div class="tool-card-foot">
            <a class="btn btn-primary btn-sm" href="#download">Download</a>
            <a class="btn btn-sm" href="how-it-works.html">How it works</a>
            <a class="btn btn-sm" href="${esc(tool.repo)}">Source</a>
          </div>
        </article>`).join('')}

      <article class="tool-card tool-card-next">
        <div class="next-mark" aria-hidden="true">+</div>
        <h3>More coming</h3>
        <p>
          Other tools are in progress. They will appear here as they are released, with the same
          rule: they run on your machine and keep your data there.
        </p>
      </article>
    </div>
  </section>

  <section class="wrap download" id="download">
    <h2 class="section-title">Get API Devkit</h2>
    <p class="lede small">
      Free and open source. Nothing to sign up for, and it works with no network at all.
    </p>

    <div class="dl-grid">
      <a class="dl" href="${esc(DOWNLOAD.macArm)}" data-os="mac" download>
        <span class="dl-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M16.1 12.6c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.6 2.2-1.6 2.7-.4 6.7 1.1 8.9.7 1.1 1.6 2.3 2.7 2.2 1.1 0 1.5-.7 2.8-.7 1.3 0 1.6.7 2.8.7 1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.2-.9-2.2-3.4ZM14 5.9c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1 1.6-.9 2.6 1 .1 2-.5 2.6-1.2Z"/></svg>
        </span>
        <span class="dl-text"><strong>macOS</strong><small>Apple silicon · .dmg</small></span>
      </a>

      <a class="dl" href="${esc(DOWNLOAD.macIntel)}" data-os="mac-intel" download>
        <span class="dl-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M16.1 12.6c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.6 2.2-1.6 2.7-.4 6.7 1.1 8.9.7 1.1 1.6 2.3 2.7 2.2 1.1 0 1.5-.7 2.8-.7 1.3 0 1.6.7 2.8.7 1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.2-.9-2.2-3.4ZM14 5.9c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1 1.6-.9 2.6 1 .1 2-.5 2.6-1.2Z"/></svg>
        </span>
        <span class="dl-text"><strong>macOS</strong><small>Intel · .dmg</small></span>
      </a>

      <a class="dl" href="${esc(DOWNLOAD.windows)}" data-os="windows" download>
        <span class="dl-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.6 10.2 4.6v7H3v-6ZM11.3 4.4 21 3v8.6h-9.7v-7.2ZM3 12.4h7.2v7L3 18.4v-6ZM11.3 12.4H21V21l-9.7-1.4v-7.2Z"/></svg>
        </span>
        <span class="dl-text"><strong>Windows</strong><small>x64 &amp; ARM · installer</small></span>
      </a>

      <a class="dl" href="${esc(DOWNLOAD.windowsPortable)}" data-os="windows-portable" download>
        <span class="dl-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.6 10.2 4.6v7H3v-6ZM11.3 4.4 21 3v8.6h-9.7v-7.2ZM3 12.4h7.2v7L3 18.4v-6ZM11.3 12.4H21V21l-9.7-1.4v-7.2Z"/></svg>
        </span>
        <span class="dl-text"><strong>Windows</strong><small>portable · unzip and run, no install</small></span>
      </a>

    </div>

    <p class="dl-note">
      Every build is on the <a href="${esc(RELEASES)}">releases page</a>, including checksums.
      They are unsigned for now: macOS asks you to confirm the first launch (right-click → Open),
      and Windows shows a SmartScreen notice and may flag <code>ffmpeg.dll</code> — a standard
      Electron component, and a known false positive. If Attack Surface Reduction blocks it,
      choose “Anyone who uses this computer” when installing.
      <a href="${esc(REPO)}/blob/main/docs/WINDOWS.md">What that means and how to verify the
      download</a>.
    </p>
  </section>
</main>

<script>
  // Nudge toward the build that matches the machine, without hiding the others.
  (function () {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var os = /mac/i.test(p) ? 'mac' : /win/i.test(p) ? 'windows' : null;
    if (!os) return;
    var el = document.querySelector('.dl[data-os="' + os + '"]');
    if (el) el.classList.add('suggested');
  })();
</script>

<footer>
  <div class="wrap footer-inner">
    <span>© ${new Date().getFullYear()} ${esc(AUTHOR)} · Made by a developer, for developers, with <span class="heart">&hearts;</span></span>
    <span class="footer-links">
      <a href="${esc(GH_USER)}">GitHub</a>
      <a href="${esc(REPO)}">Source</a>
    </span>
  </div>
</footer>`;

const css = `
${fontFaces}

:root{
  --bg:#f6f6f9; --surface:#fff; --surface-2:#f1f2f6;
  --border:#e3e5ec; --border-strong:#c6cad6;
  --text:#12131a; --muted:#555b6b; --dim:#6a7183;
  --brand:#c2006c; --brand-fill:#e4007f; --brand-soft:rgba(228,0,127,.09);
  --accent2:#0369a1;
  --display:'Space Grotesk Variable','Space Grotesk',system-ui,sans-serif;
  --ui:'Inter Tight Variable','Inter Tight',system-ui,-apple-system,sans-serif;
  --mono:'JetBrains Mono Variable','JetBrains Mono',ui-monospace,Menlo,monospace;
  --maxw:1080px;
  --shadow:0 1px 2px rgba(18,19,26,.05);
  --shadow-lg:0 18px 50px rgba(18,19,26,.10);
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0c0d12; --surface:#14151c; --surface-2:#1b1d26;
    --border:#262833; --border-strong:#3a3d4c;
    --text:#eceef4; --muted:#a2a7b8; --dim:#828899;
    --brand:#ff5fae; --brand-fill:#e4007f; --brand-soft:rgba(255,95,174,.13);
    --accent2:#4fb8f0;
    --shadow:0 1px 2px rgba(0,0,0,.4);
    --shadow-lg:0 18px 50px rgba(0,0,0,.5);
  }
}
:root[data-theme='dark']{
  --bg:#0c0d12; --surface:#14151c; --surface-2:#1b1d26;
  --border:#262833; --border-strong:#3a3d4c;
  --text:#eceef4; --muted:#a2a7b8; --dim:#828899;
  --brand:#ff5fae; --brand-fill:#e4007f; --brand-soft:rgba(255,95,174,.13);
  --accent2:#4fb8f0;
  --shadow:0 1px 2px rgba(0,0,0,.4); --shadow-lg:0 18px 50px rgba(0,0,0,.5);
}
:root[data-theme='light']{
  --bg:#f6f6f9; --surface:#fff; --surface-2:#f1f2f6;
  --border:#e3e5ec; --border-strong:#c6cad6;
  --text:#12131a; --muted:#555b6b; --dim:#6a7183;
  --brand:#c2006c; --brand-fill:#e4007f; --brand-soft:rgba(228,0,127,.09);
  --accent2:#0369a1;
  --shadow:0 1px 2px rgba(18,19,26,.05); --shadow-lg:0 18px 50px rgba(18,19,26,.10);
}

*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
body{background:var(--bg);color:var(--text);font-family:var(--ui);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
code,.mono{font-family:var(--mono)}
a{color:var(--brand)}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}

.skip{position:absolute;left:-9999px}
.skip:focus{left:16px;top:16px;z-index:50;background:var(--surface);padding:10px 14px;border-radius:8px;border:1px solid var(--border-strong)}
:focus-visible{outline:2px solid var(--brand);outline-offset:3px;border-radius:4px}

/* Header */
.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.top-inner{display:flex;align-items:center;justify-content:space-between;padding-top:14px;padding-bottom:14px;gap:16px}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--display);font-weight:650;font-size:16px;letter-spacing:-.02em;color:var(--text);text-decoration:none}
.brand-mark{color:var(--brand);display:flex}
nav{display:flex;gap:20px;font-size:14.5px}
nav a{color:var(--muted);text-decoration:none}
nav a:hover{color:var(--brand)}

/* Intro */
.intro{padding:64px 0 52px;position:relative}
.intro:before{content:'';position:absolute;inset:-30% 60% 55% -10%;background:var(--brand-soft);filter:blur(90px);pointer-events:none}
.intro-grid{display:grid;grid-template-columns:auto 1fr;gap:34px;align-items:start;position:relative}
.intro-photo{position:relative;width:120px;height:120px;border-radius:24px;overflow:hidden;background:var(--surface-2);border:1px solid var(--border);display:grid;place-items:center;box-shadow:var(--shadow-lg)}
.intro-photo img{width:100%;height:100%;object-fit:cover;display:block;position:relative;z-index:1}
.intro-initials{position:absolute;font-family:var(--display);font-size:38px;font-weight:650;color:var(--brand);z-index:0}
.intro-photo.no-photo img{display:none}
h1{font-family:var(--display);font-size:clamp(32px,5vw,46px);font-weight:650;letter-spacing:-.03em;line-height:1.06;margin-bottom:8px;text-wrap:balance}
.role{color:var(--brand);font-size:16px;font-weight:550;margin-bottom:18px}
.intro-copy{color:var(--muted);max-width:62ch;margin-bottom:12px;font-size:16.5px}
.lede{font-size:17px;color:var(--muted);max-width:62ch}
.lede.small{font-size:15.5px}
.cta{display:flex;gap:11px;flex-wrap:wrap;margin-top:24px}

.stack{margin-top:22px;display:flex;flex-direction:column;gap:9px}
.stack-row{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
.stack-label{font-family:var(--display);font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);min-width:74px}
.stack-items{display:flex;gap:7px;flex-wrap:wrap}
.chip{padding:3px 10px;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-family:var(--mono);font-size:12px;color:var(--muted)}
.stack-more{font-size:13.5px;color:var(--dim);margin-top:2px;padding-left:86px}

.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);text-decoration:none;font-weight:550;font-size:15px;box-shadow:var(--shadow);transition:transform .12s,border-color .12s}
.btn:hover{transform:translateY(-1px);border-color:var(--brand)}
.btn-primary{background:var(--brand-fill);border-color:var(--brand-fill);color:#fff}
.btn-primary:hover{filter:brightness(1.07)}
.btn-sm{padding:7px 13px;font-size:13.5px}

/* Tools */
.tools-section{padding:52px 0;border-top:1px solid var(--border)}
.section-title{font-family:var(--display);font-size:clamp(24px,3.4vw,32px);font-weight:650;letter-spacing:-.025em;margin-bottom:10px}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:28px}
.tool-card{padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);border-top:3px solid var(--brand);display:flex;flex-direction:column}
.tool-card-head{display:flex;gap:13px;align-items:center;margin-bottom:12px}
.tool-card-mark{color:var(--brand);display:flex;flex-shrink:0}
.tool-card h3{font-family:var(--display);font-size:20px;font-weight:650;letter-spacing:-.02em}
.tool-card-status{font-family:var(--mono);font-size:11.5px;color:var(--dim)}
.tool-card-tagline{color:var(--muted);font-size:15px;margin-bottom:16px}
.tool-card-list{list-style:none;display:flex;flex-direction:column;gap:9px;margin-bottom:20px}
.tool-card-list li{display:flex;align-items:center;gap:10px;font-size:14.5px;color:var(--text)}
.li-icon{display:inline-flex;padding:5px;border-radius:8px;background:var(--brand-soft);color:var(--brand);flex-shrink:0}
.tool-card-foot{display:flex;gap:9px;flex-wrap:wrap;margin-top:auto}

.tool-card-next{border-top-color:var(--border-strong);border-style:dashed;align-items:flex-start;justify-content:center;text-align:left;color:var(--muted)}
.next-mark{font-family:var(--display);font-size:34px;font-weight:650;color:var(--border-strong);line-height:1;margin-bottom:10px}
.tool-card-next h3{margin-bottom:8px;color:var(--dim)}
.tool-card-next p{font-size:14.5px;line-height:1.6}

/* Downloads */
.download{padding:52px 0;border-top:1px solid var(--border)}
.dl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:26px 0 18px}
.dl{position:relative;display:flex;align-items:center;gap:14px;padding:18px 20px;background:var(--surface);border:1px solid var(--border);border-radius:14px;text-decoration:none;color:var(--text);box-shadow:var(--shadow);transition:transform .12s,border-color .12s;overflow:hidden}
.dl:hover{transform:translateY(-2px);border-color:var(--brand)}
.dl.suggested{border-color:var(--brand);box-shadow:var(--shadow-lg)}
.dl.suggested:after{content:'Your platform';position:absolute;top:10px;right:12px;padding:2px 8px;border-radius:999px;background:var(--brand-soft);font-family:var(--mono);font-size:10px;color:var(--brand);line-height:1.5;pointer-events:none}
.dl.suggested{padding-top:26px}
.dl-icon{color:var(--brand);display:flex;flex-shrink:0}
.dl-text strong{display:block;font-family:var(--display);font-size:16.5px;font-weight:620}
.dl-text small{color:var(--dim);font-size:12.5px;font-family:var(--mono)}
.dl-note{font-size:14px;color:var(--muted);max-width:70ch;line-height:1.6}
.dl-note code{background:var(--surface-2);padding:2px 6px;border-radius:5px;font-size:13px}

/* About */
/* How it works */
.hero-doc{padding:80px 0 44px}
.steps{padding:20px 0 40px}
.step{display:grid;grid-template-columns:auto 1fr;gap:22px;padding:26px 0;border-top:1px solid var(--border)}
.step:first-child{border-top:none}
.step-n{font-family:var(--display);font-size:32px;font-weight:650;color:var(--brand);opacity:.45;line-height:1;font-variant-numeric:tabular-nums}
.step-body h2{font-family:var(--display);font-size:21px;font-weight:620;letter-spacing:-.02em;margin-bottom:8px}
.step-body p{color:var(--muted);max-width:70ch}
.step-body code,.qa code{background:var(--surface-2);padding:2px 6px;border-radius:5px;font-size:13.5px;font-family:var(--mono)}

.arch{padding:44px 0;border-top:1px solid var(--border)}
.tree{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;overflow-x:auto;margin-bottom:18px;box-shadow:var(--shadow)}
.tree code{font-family:var(--mono);font-size:13px;line-height:1.75;color:var(--muted);white-space:pre}

.faq{padding:44px 0;border-top:1px solid var(--border)}
.qa{border:1px solid var(--border);border-radius:12px;background:var(--surface);margin-bottom:10px;overflow:hidden}
.qa summary{padding:15px 18px;cursor:pointer;font-family:var(--display);font-weight:600;font-size:16px;list-style:none}
.qa summary::-webkit-details-marker{display:none}
.qa summary:before{content:'+';color:var(--brand);font-weight:700;margin-right:10px}
.qa[open] summary:before{content:'–'}
.qa p{padding:0 18px 16px 40px;color:var(--muted);font-size:14.5px;max-width:70ch}

footer{border-top:1px solid var(--border);padding:28px 0;margin-top:20px}
.footer-inner{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--dim)}
.footer-links{display:flex;gap:18px}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--brand)}

footer .heart{color:var(--brand)}

@media (max-width:760px){
  .intro-grid{grid-template-columns:1fr;gap:22px}
  .stack-row{flex-direction:column;gap:6px}
  .stack-more{padding-left:0}
  nav{gap:13px;font-size:13px;flex-wrap:wrap;justify-content:flex-end}
  .about-grid{grid-template-columns:1fr;gap:20px}
}
`;

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    n: '01',
    title: 'Everything happens in one process you control',
    body:
      'The window you see is a renderer with no access to the network or the disk. Every request, ' +
      'every file read and every byte of encryption happens in a separate main process, reached ' +
      'through a single typed bridge. The renderer runs under a policy of <code>default-src ' +
      "'none'</code>, so page code cannot reach the network even if something tried.",
  },
  {
    n: '02',
    title: 'Your work is plain files',
    body:
      'A collection is one JSON file in <code>~/.crafillio/collections</code>. Diff it, commit it, ' +
      'hand it to someone. Workflows, environments, history and settings sit beside it. There is ' +
      'no database and no sync service, because there is no server.',
  },
  {
    n: '03',
    title: 'Variables keep secrets out of what you share',
    body:
      'Write <code>{{token}}</code> anywhere — URL, header, body, gRPC message. The collection ' +
      'stores the placeholder, never the value, so it stays safe to commit. Values live in an ' +
      'environment you switch from the title bar. A name that is not defined is reported rather ' +
      'than quietly replaced with an empty string.',
  },
  {
    n: '04',
    title: 'Secrets are encrypted before they touch the disk',
    body:
      'Anything marked secret is sealed with AES-256-GCM using a key file readable only by you, ' +
      'so nothing ever prompts for a password. Prefer the OS keychain? Switch backend in About. ' +
      'If neither is available, storing the secret is refused rather than silently written in the ' +
      'clear.',
  },
  {
    n: '05',
    title: 'Workflows pass real values between steps',
    body:
      'Drop steps on the canvas and drag a wire between them; the wire is the execution order. A ' +
      'step publishes named values out of its response — a JSON path, a header, a status — and ' +
      'later steps read them as variables. REST and gRPC steps mix, so an HTTP login can feed a ' +
      'gRPC call.',
  },
  {
    n: '06',
    title: 'A run leaves you something to hand over',
    body:
      'Every stage stays clickable during and after a run, showing the request as sent and the ' +
      'response as received. Export the whole run as one self-contained HTML file or a PDF: the ' +
      'canvas you drew, each request and response, and any file produced, embedded so it downloads ' +
      'straight from the page.',
  },
];

const FAQ = [
  ['Does it phone home?',
   'No. It makes no network connection of its own — no telemetry, no analytics, no crash reports, ' +
   'no update check. The only traffic is the requests you ask it to make.'],
  ['Can I use it behind a corporate proxy?',
   'Yes. HTTP, HTTPS, SOCKS4 and SOCKS5, with optional credentials and a bypass list that ' +
   'understands <code>*.</code> wildcards. Private certificate authority? Trust the CA rather than ' +
   'turning verification off, and mutual TLS client certificates can be matched per host.'],
  ['Do I have to start from scratch?',
   'No. Import from Postman, OpenAPI or Swagger (JSON or YAML), Bruno, Hoppscotch, or paste a curl ' +
   'command straight from browser devtools.'],
  ['What happens to my data if I stop using it?',
   'It stays where it always was — readable JSON in your home directory. There is nothing to ' +
   'export from a service, because it never left your machine.'],
  ['Is it really free?',
   'Yes, MIT licensed. No paid tier, no seat count, no feature held back.'],
];

const howBody = `
<a class="skip" href="#main">Skip to content</a>

<header class="top">
  <div class="wrap top-inner">
    <a class="brand" href="index.html">
      <span class="brand-mark">${LOGO(26)}</span>
      <span>${esc(AUTHOR)}</span>
    </a>
    <nav>
      <a href="index.html#tools">Tools</a>
      <a href="index.html#download">Download</a>
      <a href="how-it-works.html">How it works</a>
      <a href="index.html#about">About</a>
      <a href="${esc(GH_USER)}">GitHub</a>
    </nav>
  </div>
</header>

<main id="main">
  <section class="hero hero-doc">
    <div class="wrap">
      <p class="eyebrow">Documentation</p>
      <h1>How API Devkit<br><em>works.</em></h1>
      <p class="lede">
        A short tour of the moving parts — where your data lives, how values travel between
        requests, and what the app will and will not do behind your back.
      </p>
    </div>
  </section>

  <section class="wrap steps">
    ${STEPS.map((s) => `
      <article class="step">
        <div class="step-n">${esc(s.n)}</div>
        <div class="step-body">
          <h2>${esc(s.title)}</h2>
          <p>${s.body}</p>
        </div>
      </article>`).join('')}
  </section>

  <section class="wrap arch">
    <h3 class="sub">Where the pieces sit</h3>
    <pre class="tree"><code>packages/core     Protocol engines and storage. No Electron imports,
                  so the engines outlive the shell they run in.
  protocols/      rest · grpc · s3
  workflow/       execution engine, extraction, HTML report
  perf/           load generator, reservoir-sampled percentiles
  interop/        curl · Postman · OpenAPI · Bruno · Hoppscotch
  store/          collections · environments · secrets · settings

packages/ui       React renderer. Talks only to the bridge.

apps/desktop      Electron shell.
  api.ts          the one typed contract shared by main, preload and UI
  main.ts         the privileged side: engines, disk, encryption</code></pre>
    <p class="lede small">
      The engines import nothing from Electron, so the same code could sit behind a command line
      or a different shell without being rewritten.
    </p>
  </section>

  <section class="wrap faq">
    <h3 class="sub">Questions</h3>
    ${FAQ.map(([q, a]) => `
      <details class="qa">
        <summary>${esc(q)}</summary>
        <p>${a}</p>
      </details>`).join('')}
  </section>

  <section class="wrap closing">
    <h3 class="sub">Ready?</h3>
    <div class="cta">
      <a class="btn btn-primary" href="index.html#download">Download API Devkit</a>
      <a class="btn" href="${esc(REPO)}">Read the source</a>
    </div>
  </section>
</main>

<footer>
  <div class="wrap footer-inner">
    <span>© ${new Date().getFullYear()} ${esc(AUTHOR)} · MIT licensed</span>
    <span class="footer-links">
      <a href="${esc(GH_USER)}">GitHub</a>
      <a href="${esc(REPO)}">Source</a>
    </span>
  </div>
</footer>`;

const html = artifactMode
  ? `<style>${css}</style>\n${body}`
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(AUTHOR)} — Developer tools</title>
<meta name="description" content="Open-source developer tools by ${esc(AUTHOR)}. API Devkit: REST, gRPC, S3, workflows and load testing in one offline-first desktop app.">
<meta property="og:title" content="${esc(AUTHOR)} — Developer tools">
<meta property="og:description" content="API Devkit: REST, gRPC, S3, workflows and load testing in one offline-first desktop app. Open source, MIT.">
<meta property="og:type" content="website">
<meta name="color-scheme" content="light dark">
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`Site written to ${outPath} (${(html.length / 1024).toFixed(0)} KB${artifactMode ? ', artifact fragment' : ', fonts inlined'})`);

// The documentation page ships alongside, sharing the same stylesheet.
if (!artifactMode) {
  const howPath = join(dirname(outPath), 'how-it-works.html');
  const howHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How API Devkit works</title>
<meta name="description" content="How API Devkit works: where your data lives, how values travel between requests, and what it will not do behind your back.">
<meta name="color-scheme" content="light dark">
<style>${css}</style>
</head>
<body>
${howBody}
</body>
</html>`;
  writeFileSync(howPath, howHtml);
  console.log(`Docs written to ${howPath} (${(howHtml.length / 1024).toFixed(0)} KB)`);
}
