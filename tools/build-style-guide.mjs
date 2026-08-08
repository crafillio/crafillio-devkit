#!/usr/bin/env node
/**
 * Generates docs/style-guide.html from the real design tokens.
 *
 * The guide is generated rather than hand-written so it can never drift from
 * styles.css: colours, type, shape and motion are all parsed out of the
 * stylesheet the app actually ships. Fonts are inlined as data URIs so the
 * page is a single self-contained file that works offline.
 *
 *   npm run style-guide
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cssPath = join(root, 'packages/ui/src/styles.css');

/*
 * `--artifact` emits a body fragment instead of a whole document: the Artifact
 * host supplies <html>/<head>/<body>, and the viewer's own theme control
 * stamps data-theme on the root element. In that mode the tokens are keyed off
 * prefers-color-scheme first so the page opens in the viewer's scheme rather
 * than always dark.
 */
const artifactMode = process.argv.includes('--artifact');
const outArg = process.argv.indexOf('--out');
const outPath =
  outArg !== -1 ? process.argv[outArg + 1] : join(root, 'docs/style-guide.html');

/* ------------------------------------------------------------------ */
/* Parse tokens                                                        */
/* ------------------------------------------------------------------ */

const css = readFileSync(cssPath, 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Selector not found in styles.css: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  return css.slice(open + 1, close);
}

function parse(text) {
  const out = {};
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const dark = parse(block(':root {'));
const lightOverrides = parse(block(":root[data-theme='light']"));
const light = { ...dark, ...lightOverrides };

/* ------------------------------------------------------------------ */
/* Inline fonts                                                        */
/* ------------------------------------------------------------------ */

const FONTS = [
  { family: 'Space Grotesk Variable', pkg: 'space-grotesk', range: '300 700' },
  { family: 'Inter Tight Variable', pkg: 'inter-tight', range: '100 900' },
  { family: 'JetBrains Mono Variable', pkg: 'jetbrains-mono', range: '100 800' },
];

const fontFaces = FONTS.map(({ family, pkg, range }) => {
  const file = join(
    root,
    `node_modules/@fontsource-variable/${pkg}/files/${pkg}-latin-wght-normal.woff2`,
  );
  if (!existsSync(file)) {
    console.warn(`  ! ${pkg} not installed — the guide will fall back to system fonts.`);
    return '';
  }
  const data = readFileSync(file).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${range};src:url(data:font/woff2;base64,${data}) format('woff2-variations');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}`;
}).join('\n');

/* ------------------------------------------------------------------ */
/* Token groupings — how the system is meant to be read                */
/* ------------------------------------------------------------------ */

const GROUPS = [
  {
    id: 'surfaces',
    title: 'Surfaces',
    blurb:
      'A five-step elevation ramp. Higher numbers sit closer to the viewer. Panels use --surface, ' +
      'inputs and hovers use --surface-2, menus and raised chrome use --surface-3.',
    tokens: ['--bg', '--surface', '--surface-2', '--surface-3', '--surface-4', '--border', '--border-strong'],
  },
  {
    id: 'text',
    title: 'Text',
    blurb:
      'Three tiers only. --text for content, --text-muted for supporting copy and values, ' +
      '--text-dim for labels and placeholders. Every tier clears WCAG AA on its own background.',
    tokens: ['--text', '--text-muted', '--text-dim'],
    contrastAgainst: '--bg',
  },
  {
    id: 'accent',
    title: 'Accent',
    blurb:
      'One indigo carries every interaction. --accent is tuned for use AS text on --bg; ' +
      '--accent-fill is the darker variant buttons use behind white label text. Using --accent ' +
      'as a button background would drop white text below AA.',
    tokens: ['--accent', '--accent-hover', '--accent-press', '--accent-fill', '--accent-soft', '--accent-line', '--on-accent'],
  },
  {
    id: 'protocol',
    title: 'Protocol',
    blurb:
      'Each protocol owns a hue so a tab is identifiable at a glance. These are identity colours, ' +
      'not status — never reuse them to mean success or failure.',
    tokens: ['--rest', '--grpc', '--s3'],
    contrastAgainst: '--bg',
  },
  {
    id: 'semantic',
    title: 'Semantic',
    blurb:
      'Outcome colours. The -soft variants are the low-alpha fills behind pills and banners; the ' +
      'solid colour supplies the text and border on top of them.',
    tokens: ['--green', '--amber', '--red', '--violet', '--cyan', '--green-soft', '--amber-soft', '--red-soft', '--cyan-soft'],
    contrastAgainst: '--bg',
  },
  {
    id: 'syntax',
    title: 'Syntax',
    blurb:
      'Editor highlighting. Declared as tokens rather than literals inside CodeMirror so the ' +
      'editor follows the theme without being rebuilt.',
    tokens: ['--syn-key', '--syn-string', '--syn-number', '--syn-atom', '--syn-comment'],
    contrastAgainst: '--surface',
  },
];

const TYPE_ROLES = [
  { token: '--font-display', name: 'Space Grotesk', role: 'Display', use: 'Brand, headings, section labels, stat figures', sample: 'Throughput 110.2 req/s' },
  { token: '--font-ui', name: 'Inter Tight', role: 'Interface', use: 'Body copy, buttons, form labels, descriptions', sample: 'Send a request and inspect the response' },
  { token: '--font-mono', name: 'JetBrains Mono', role: 'Mono', use: 'URLs, code, headers, keys, values, latencies', sample: 'GET /v1/charges?limit=10 → 200' },
];

const SCALE = [
  { size: 23, weight: 600, font: '--font-display', name: 'Stat figure', use: '.stat-value — the one large number per card' },
  { size: 14, weight: 600, font: '--font-display', name: 'Title', use: 'Brand, modal headings' },
  { size: 13, weight: 400, font: '--font-ui', name: 'Body', use: 'Default. --font-size drives everything else' },
  { size: 12.5, weight: 400, font: '--font-ui', name: 'Control', use: 'Buttons, tabs, tree rows' },
  { size: 12, weight: 400, font: '--font-mono', name: 'Value', use: 'Inputs, table cells, editor text' },
  { size: 11.5, weight: 400, font: '--font-mono', name: 'Meta', use: '.meta — timings, sizes, counts' },
  { size: 10, weight: 600, font: '--font-display', name: 'Label', use: 'Uppercase section labels, 0.08em tracking' },
];

const SHAPE = ['--radius-sm', '--radius', '--radius-lg', '--radius-xl'];
const ELEVATION = ['--shadow-sm', '--shadow-md', '--shadow-lg', '--inset-hi', '--ring'];
const MOTION = ['--ease', '--fast', '--med'];

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function swatchRow(group) {
  return group.tokens
    .map((token) => {
      const d = dark[token] ?? '';
      const l = light[token] ?? '';
      const changes = d !== l;
      // A -soft token is a background fill. Reporting *its* contrast as if it
      // were text is meaningless (and wrong — the alpha gets dropped). Instead
      // pair it with the solid colour that sits on top of it.
      const soft = token.endsWith('-soft') && token !== '--accent-soft';
      const pairedSolid = soft ? token.replace('-soft', '') : null;
      const annotate = group.contrastAgainst && !soft
        ? ` data-contrast-on="${group.contrastAgainst}"`
        : soft
          ? ` data-fill="${token}" data-on-fill="${pairedSolid}" data-over="--surface"`
          : '';
      return `
      <div class="swatch" data-token="${token}"${annotate}>
        <div class="swatch-chip" style="background:var(${token})"></div>
        <div class="swatch-meta">
          <code class="swatch-name">${token}</code>
          <div class="swatch-values">
            <span class="val" data-scheme="dark">${esc(d)}</span>
            ${changes ? `<span class="val" data-scheme="light">${esc(l)}</span>` : `<span class="val muted">same in both</span>`}
          </div>
          ${
            soft
              ? `<div class="swatch-contrast"><span class="ratio"></span> for <code>${pairedSolid}</code> on this fill</div>`
              : group.contrastAgainst
                ? `<div class="swatch-contrast"><span class="ratio"></span> on <code>${group.contrastAgainst}</code></div>`
                : ''
          }
        </div>
      </div>`;
    })
    .join('');
}

const colourSections = GROUPS.map(
  (g) => `
    <section class="sub" id="colour-${g.id}">
      <h3>${g.title}</h3>
      <p class="blurb">${g.blurb}</p>
      <div class="swatches">${swatchRow(g)}</div>
    </section>`,
).join('');

const typeSpecimens = TYPE_ROLES.map(
  (t) => `
    <div class="type-card">
      <div class="type-head">
        <div>
          <div class="type-name">${t.name}</div>
          <code class="type-token">${t.token}</code>
        </div>
        <span class="pill">${t.role}</span>
      </div>
      <div class="type-sample" style="font-family:var(${t.token})">${esc(t.sample)}</div>
      <div class="type-alphabet" style="font-family:var(${t.token})">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 {}[]()&lt;&gt;/\\ — · {{var}}</div>
      <div class="type-use">${t.use}</div>
    </div>`,
).join('');

const scaleRows = SCALE.map(
  (s) => `
    <tr>
      <td class="scale-demo" style="font-family:var(${s.font});font-size:${s.size}px;font-weight:${s.weight}">${s.name}</td>
      <td><code>${s.size}px</code></td>
      <td><code>${s.weight}</code></td>
      <td><code>${s.font}</code></td>
      <td class="use">${s.use}</td>
    </tr>`,
).join('');

const shapeRow = SHAPE.map(
  (t) => `
    <div class="shape-item">
      <div class="shape-box" style="border-radius:var(${t})"></div>
      <code>${t}</code>
      <span class="muted">${esc(dark[t])}</span>
    </div>`,
).join('');

const elevationRow = ELEVATION.map(
  (t) => `
    <div class="elev-item">
      <div class="elev-box" style="box-shadow:var(${t})"></div>
      <code>${t}</code>
    </div>`,
).join('');

const motionRow = MOTION.map(
  (t) => `
    <div class="motion-item">
      <code>${t}</code>
      <span class="muted">${esc(dark[t])}</span>
    </div>`,
).join('');

const allTokenRows = Object.keys(dark)
  .map((token) => {
    const d = dark[token];
    const l = light[token];
    const isColour = /^#|^rgba?\(/.test(d);
    return `
      <tr>
        <td><code>${token}</code></td>
        <td>${isColour ? `<i class="dot" style="background:${esc(d)}"></i>` : ''}<code>${esc(d)}</code></td>
        <td>${d === l ? '<span class="muted">inherits</span>' : `${isColour ? `<i class="dot" style="background:${esc(l)}"></i>` : ''}<code>${esc(l)}</code>`}</td>
      </tr>`;
  })
  .join('');

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crafillio DevKit — Style Guide</title>
<style>
${fontFaces}

${
  artifactMode
    ? `/* Light is the base so a light-preferring viewer opens in light. */
:root{
${Object.entries(light).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
  --maxw: 1120px;
}
@media (prefers-color-scheme: dark){
  :root{
${Object.entries(dark).map(([k, v]) => `    ${k}: ${v};`).join('\n')}
  }
}
/* An explicit choice — ours or the viewer's — wins over the media query. */
:root[data-theme='dark']{
${Object.entries(dark).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
}
:root[data-theme='light']{
${Object.entries(light).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
}`
    : `:root{
${Object.entries(dark).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
  --maxw: 1120px;
}
:root[data-theme='light']{
${Object.entries(lightOverrides).map(([k, v]) => `  ${k}: ${v};`).join('\n')}
}`
}

*{box-sizing:border-box;margin:0;padding:0}
html{color-scheme:dark}
html[data-theme='light']{color-scheme:light}
body{
  background:var(--bg);color:var(--text);
  font-family:var(--font-ui);font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;
  transition:background var(--med) var(--ease),color var(--med) var(--ease);
}
code{font-family:var(--font-mono);font-size:0.88em}
.muted{color:var(--text-dim)}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 28px}

/* Header */
header.top{
  position:sticky;top:0;z-index:10;
  background:color-mix(in srgb,var(--surface) 88%,transparent);
  backdrop-filter:blur(12px);
  border-bottom:1px solid var(--border);
}
.top-inner{max-width:var(--maxw);margin:0 auto;padding:14px 28px;display:flex;align-items:center;gap:14px}
.brand{display:flex;align-items:center;gap:11px;font-family:var(--font-display);font-weight:600;font-size:17px;letter-spacing:-0.02em}
.brand-accent{background:linear-gradient(96deg,var(--rest),var(--grpc) 52%,var(--s3));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-weight:700}
.spacer{flex:1}
.toggle{display:flex;gap:2px;padding:3px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px}
.toggle button{padding:5px 13px;border:none;background:none;border-radius:999px;color:var(--text-dim);font-family:inherit;font-size:12.5px;cursor:pointer;transition:all var(--fast) var(--ease)}
.toggle button.on{background:var(--surface-4);color:var(--accent);box-shadow:var(--shadow-sm)}

/* Hero */
.hero{padding:64px 0 20px}
.hero h1{font-family:var(--font-display);font-size:44px;font-weight:600;letter-spacing:-0.03em;line-height:1.1;margin-bottom:14px}
.hero p{font-size:17px;color:var(--text-muted);max-width:62ch}
.hero .meta-line{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
.tag{padding:4px 11px;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:12.5px;color:var(--text-muted);font-family:var(--font-mono)}

/* Sections */
section.major{padding:52px 0;border-top:1px solid var(--border)}
.eyebrow{font-family:var(--font-display);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent);margin-bottom:10px}
section.major > h2{font-family:var(--font-display);font-size:29px;font-weight:600;letter-spacing:-0.02em;margin-bottom:12px}
section.major > .lede{color:var(--text-muted);max-width:70ch;margin-bottom:28px}
.sub{margin-top:34px}
.sub h3{font-family:var(--font-display);font-size:17px;font-weight:600;margin-bottom:6px}
.blurb{color:var(--text-muted);font-size:14px;max-width:74ch;margin-bottom:16px}

/* Swatches */
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px}
.swatch{display:flex;gap:12px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)}
.swatch-chip{width:44px;height:44px;border-radius:var(--radius);border:1px solid var(--border-strong);flex-shrink:0}
.swatch-meta{min-width:0;flex:1}
.swatch-name{display:block;font-size:12px;color:var(--text);margin-bottom:3px;word-break:break-all}
.swatch-values{display:flex;flex-direction:column;gap:1px}
.val{font-family:var(--font-mono);font-size:11px;color:var(--text-dim)}
.val[data-scheme]:before{content:attr(data-scheme) ' ';color:var(--text-dim);opacity:.6}
html[data-theme='dark'] .val[data-scheme='light']{display:none}
html[data-theme='light'] .val[data-scheme='dark']{display:none}
${
  artifactMode
    ? `@media (prefers-color-scheme: dark){
  html:not([data-theme]) .val[data-scheme='light']{display:none}
}
@media (prefers-color-scheme: light){
  html:not([data-theme]) .val[data-scheme='dark']{display:none}
}`
    : ''
}
.swatch-contrast{margin-top:5px;font-size:11px;color:var(--text-dim);font-family:var(--font-mono)}
.ratio{font-weight:700}
.ratio.pass{color:var(--green)}
.ratio.large{color:var(--amber)}
.ratio.fail{color:var(--red)}

/* Type */
.type-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.type-card{padding:18px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)}
.type-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
.type-name{font-family:var(--font-display);font-size:18px;font-weight:600}
.type-token{font-size:11px;color:var(--text-dim)}
.pill{padding:2px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:600;white-space:nowrap}
.type-sample{font-size:23px;line-height:1.3;margin-bottom:12px;letter-spacing:-0.01em}
.type-alphabet{font-size:12px;line-height:1.85;color:var(--text-muted);padding:12px;background:var(--surface-2);border-radius:var(--radius);margin-bottom:12px;word-break:break-all}
.type-use{font-size:13px;color:var(--text-dim)}

/* Tables */
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;padding:9px 12px;background:var(--surface-2);border-bottom:1px solid var(--border);font-family:var(--font-display);font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)}
td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
tbody tr:hover{background:var(--surface-2)}
.tbl{border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;background:var(--surface)}
.scale-demo{white-space:nowrap}
td.use{color:var(--text-dim);font-size:12.5px}
.dot{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid var(--border-strong);margin-right:7px;vertical-align:-1px}

/* Shape / elevation / motion */
.row{display:flex;gap:26px;flex-wrap:wrap}
.shape-item,.elev-item,.motion-item{display:flex;flex-direction:column;gap:8px;align-items:flex-start;font-size:12px}
.shape-box{width:78px;height:56px;background:var(--surface-3);border:1px solid var(--border-strong)}
.elev-box{width:104px;height:66px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg)}
.motion-item{padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);min-width:190px}

/* Component specimens */
.specimen{padding:22px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);margin-bottom:14px}
.specimen-label{font-family:var(--font-display);font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:14px}
.specimen-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}

.btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-family:var(--font-ui);font-size:12.5px;font-weight:500;cursor:pointer;box-shadow:var(--inset-hi)}
.btn:hover{background:var(--surface-3);border-color:var(--border-strong)}
.btn-primary{background:linear-gradient(180deg,var(--accent-hover),var(--accent-fill));border-color:var(--accent-press);color:var(--on-accent);font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,.2),var(--shadow-sm)}
.btn-danger{color:var(--red)}
.btn-ghost{background:none;border-color:transparent;box-shadow:none}
.btn:disabled{opacity:.42;cursor:not-allowed}
.input{padding:6px 9px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-family:var(--font-mono);font-size:12px;outline:none;min-width:210px}
.input:focus{border-color:var(--accent);box-shadow:var(--ring)}

.chip{font-family:var(--font-mono);font-size:10px;font-weight:700}
.m-GET{color:var(--green)}.m-POST{color:var(--amber)}.m-PUT{color:var(--cyan)}
.m-PATCH{color:var(--violet)}.m-DELETE{color:var(--red)}.m-GRPC{color:var(--grpc)}.m-S3{color:var(--s3)}
.status-pill{padding:3px 10px;border-radius:999px;font-family:var(--font-mono);font-weight:700;font-size:11.5px}
.s2{background:var(--green-soft);color:var(--green)}
.s3c{background:var(--cyan-soft);color:var(--cyan)}
.s4{background:var(--amber-soft);color:var(--amber)}
.s5{background:var(--red-soft);color:var(--red)}

.stat{padding:13px 15px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm),var(--inset-hi);min-width:132px}
.stat-label{font-family:var(--font-display);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim);margin-bottom:7px}
.stat-value{font-family:var(--font-display);font-size:23px;font-weight:600;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.stat-unit{font-family:var(--font-ui);font-size:11px;color:var(--text-dim);margin-left:5px;font-weight:500}

.toast{padding:11px 15px;background:var(--surface-3);border:1px solid var(--border-strong);border-left-width:3px;border-radius:var(--radius);font-size:12.5px;box-shadow:var(--shadow-md)}
.toast.err{border-left-color:var(--red);color:var(--red)}
.toast.ok{border-left-color:var(--green);color:var(--green)}
.toast.info{border-left-color:var(--accent)}

.code-demo{padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);font-family:var(--font-mono);font-size:12.5px;line-height:1.7;overflow-x:auto}
.k{color:var(--syn-key)}.s{color:var(--syn-string)}.n{color:var(--syn-number)}.a{color:var(--syn-atom)}.c{color:var(--syn-comment);font-style:italic}

/* Rules */
.rules{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.rule{padding:16px 18px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface)}
.rule.do{border-left:3px solid var(--green)}
.rule.dont{border-left:3px solid var(--red)}
.rule h4{font-family:var(--font-display);font-size:13px;margin-bottom:7px;display:flex;align-items:center;gap:7px}
.rule.do h4{color:var(--green)}
.rule.dont h4{color:var(--red)}
.rule p{font-size:13px;color:var(--text-muted)}
.rule code{color:var(--text)}

footer{padding:44px 0 64px;border-top:1px solid var(--border);color:var(--text-dim);font-size:13px}
footer a{color:var(--accent);text-decoration:none}
footer a:hover{text-decoration:underline}

@media (max-width:820px){
  .rules{grid-template-columns:1fr}
  .hero h1{font-size:33px}
  .wrap,.top-inner{padding-left:18px;padding-right:18px}
}
@media (prefers-reduced-motion:reduce){*{transition-duration:.001ms !important;animation-duration:.001ms !important}}
</style>
</head>
<body>

<header class="top">
  <div class="top-inner">
    <div class="brand">
      <svg width="26" height="26" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <defs><linearGradient id="t" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#e4007f"/><stop offset="55%" stop-color="#b5008f"/><stop offset="100%" stop-color="#6a3fd6"/>
        </linearGradient></defs>
        <rect width="48" height="48" rx="12" fill="url(#t)"/>
        <path d="M13 17.5 L20.5 24 L13 30.5" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>
        <rect x="24.5" y="27.6" width="12" height="3.4" rx="1.7" fill="#ffffff" opacity=".92"/>
        <circle cx="30.6" cy="18.4" r="2.5" fill="#ffffff" opacity=".92"/>
      </svg>
      Crafillio <span class="brand-accent">DevKit</span>
    </div>
    <div class="spacer"></div>
    <div class="toggle" role="group" aria-label="Theme">
      <button data-set="light">Light</button>
      <button data-set="dark" class="on">Dark</button>
    </div>
  </div>
</header>

<div class="wrap">
  <div class="hero">
    <div class="eyebrow">Design System</div>
    <h1>Style Guide</h1>
    <p>Every token below is parsed straight out of <code>packages/ui/src/styles.css</code> when this page is generated, so it cannot drift from the running app. Contrast ratios are computed live in the browser — switch themes and watch them change.</p>
    <div class="meta-line">
      <span class="tag">${Object.keys(dark).length} tokens</span>
      <span class="tag">${Object.keys(lightOverrides).length} light overrides</span>
      <span class="tag">3 typefaces · OFL-1.1</span>
      <span class="tag">WCAG AA verified</span>
    </div>
  </div>

  <section class="major" id="principles">
    <div class="eyebrow">Foundations</div>
    <h2>Principles</h2>
    <p class="lede">Four rules shape everything else. They exist to keep a dense developer tool readable for hours at a time.</p>
    <div class="rules">
      <div class="rule do"><h4>Colour carries meaning, never decoration</h4><p>A hue appears because it identifies a protocol or reports an outcome. Nothing is coloured to look lively.</p></div>
      <div class="rule do"><h4>One accent, used sparingly</h4><p>A single indigo marks the primary action and focus. When everything is emphasised, nothing is.</p></div>
      <div class="rule do"><h4>Neutral surfaces do the structural work</h4><p>Hierarchy comes from the five-step surface ramp and hairline borders, not from coloured panels.</p></div>
      <div class="rule do"><h4>Type separates by role, not by size alone</h4><p>Three families with distinct jobs — a figure is never mistaken for a label, a value never for prose.</p></div>
    </div>
  </section>

  <section class="major" id="colour">
    <div class="eyebrow">Foundations</div>
    <h2>Colour</h2>
    <p class="lede">Both schemes are declared as tokens; no component contains a literal colour. That is what makes the theme switch total rather than partial. Ratios shown are contrast against the stated background in the <strong>currently selected theme</strong>.</p>
    ${colourSections}
  </section>

  <section class="major" id="type">
    <div class="eyebrow">Foundations</div>
    <h2>Typography</h2>
    <p class="lede">Three families, each with one job. All are OFL-1.1 variable fonts bundled with the app — nothing is fetched at runtime, which is what lets the app work fully offline.</p>
    <div class="type-grid">${typeSpecimens}</div>

    <div class="sub">
      <h3>Scale</h3>
      <p class="blurb">Deliberately compressed. A tool this dense needs a narrow range, so emphasis comes from weight, family and colour rather than large jumps in size.</p>
      <div class="tbl"><table>
        <thead><tr><th>Sample</th><th>Size</th><th>Weight</th><th>Family</th><th>Used for</th></tr></thead>
        <tbody>${scaleRows}</tbody>
      </table></div>
    </div>

    <div class="sub">
      <h3>Numerals</h3>
      <p class="blurb">Anything that updates live uses <code>font-variant-numeric: tabular-nums</code>, so digits keep a fixed width and figures do not jitter as they change.</p>
      <div class="specimen"><div class="specimen-label">Tabular figures in motion</div>
        <div class="specimen-row">
          <div class="stat"><div class="stat-label">Throughput</div><div class="stat-value" id="tick">110.2<span class="stat-unit">req/s</span></div></div>
          <div class="stat"><div class="stat-label">p95</div><div class="stat-value">96.4<span class="stat-unit">ms</span></div></div>
          <div class="stat"><div class="stat-label">Error rate</div><div class="stat-value" style="color:var(--red)">1.66<span class="stat-unit">%</span></div></div>
        </div>
      </div>
    </div>
  </section>

  <section class="major" id="shape">
    <div class="eyebrow">Foundations</div>
    <h2>Shape, elevation &amp; motion</h2>
    <p class="lede">Radius grows with the size of the surface. Elevation is inverted between themes: dark UI leans on borders and inset highlights, light UI needs real shadow to read as raised.</p>

    <div class="sub"><h3>Radius</h3><div class="row">${shapeRow}</div></div>
    <div class="sub"><h3>Elevation</h3><div class="row">${elevationRow}</div></div>
    <div class="sub">
      <h3>Motion</h3>
      <p class="blurb">One easing curve throughout. Two durations: <code>--fast</code> for state changes on a control, <code>--med</code> for anything entering or leaving. Everything is disabled under <code>prefers-reduced-motion</code>.</p>
      <div class="row">${motionRow}</div>
    </div>
  </section>

  <section class="major" id="components">
    <div class="eyebrow">Application</div>
    <h2>Components</h2>
    <p class="lede">Specimens built from the same tokens, so this page renders exactly what the app renders.</p>

    <div class="specimen"><div class="specimen-label">Buttons</div>
      <div class="specimen-row">
        <button class="btn btn-primary">Send</button>
        <button class="btn">Discover</button>
        <button class="btn btn-danger">Delete</button>
        <button class="btn btn-ghost">Cancel</button>
        <button class="btn" disabled>Disabled</button>
      </div>
    </div>

    <div class="specimen"><div class="specimen-label">Inputs — focus ring uses --ring</div>
      <div class="specimen-row">
        <input class="input" value="https://api.example.com/v1/charges">
        <input class="input" placeholder="Click to see the focus ring">
      </div>
    </div>

    <div class="specimen"><div class="specimen-label">Method &amp; protocol chips</div>
      <div class="specimen-row" style="gap:18px">
        <span class="chip m-GET">GET</span><span class="chip m-POST">POST</span>
        <span class="chip m-PUT">PUT</span><span class="chip m-PATCH">PATCH</span>
        <span class="chip m-DELETE">DELETE</span><span class="chip m-GRPC">GRPC</span><span class="chip m-S3">S3</span>
      </div>
    </div>

    <div class="specimen"><div class="specimen-label">Status pills</div>
      <div class="specimen-row">
        <span class="status-pill s2">200</span><span class="status-pill s3c">302</span>
        <span class="status-pill s4">404</span><span class="status-pill s5">500</span>
        <span class="status-pill s2">OK</span><span class="status-pill s5">PERMISSION_DENIED</span>
      </div>
    </div>

    <div class="specimen"><div class="specimen-label">Stat cards</div>
      <div class="specimen-row">
        <div class="stat"><div class="stat-label">Requests</div><div class="stat-value">1,984</div></div>
        <div class="stat"><div class="stat-label">Throughput</div><div class="stat-value" style="color:var(--accent)">110.2<span class="stat-unit">req/s</span></div></div>
        <div class="stat"><div class="stat-label">p99</div><div class="stat-value">214.7<span class="stat-unit">ms</span></div></div>
      </div>
    </div>

    <div class="specimen"><div class="specimen-label">Toasts</div>
      <div class="specimen-row">
        <div class="toast ok">Collection created</div>
        <div class="toast err">Host not found: api.example.com</div>
        <div class="toast info">Imported 24 requests from Postman</div>
      </div>
    </div>

    <div class="specimen"><div class="specimen-label">Editor syntax</div>
      <div class="code-demo"><span class="c">// Response body</span><br>{<br>&nbsp;&nbsp;<span class="k">"object"</span>: <span class="s">"list"</span>,<br>&nbsp;&nbsp;<span class="k">"has_more"</span>: <span class="a">false</span>,<br>&nbsp;&nbsp;<span class="k">"count"</span>: <span class="n">1984</span>,<br>&nbsp;&nbsp;<span class="k">"next"</span>: <span class="a">null</span><br>}</div>
    </div>
  </section>

  <section class="major" id="usage">
    <div class="eyebrow">Application</div>
    <h2>Usage rules</h2>
    <p class="lede">The decisions that are easy to get wrong, written down so they are not re-litigated.</p>
    <div class="rules">
      <div class="rule do"><h4>Do use --accent-fill behind white text</h4><p><code>--accent</code> is tuned to be legible <em>as</em> text on the page background. Using it as a button fill drops white label text below AA.</p></div>
      <div class="rule dont"><h4>Don't use protocol colours for status</h4><p><code>--s3</code> is green and <code>--rest</code> is blue, but they identify a protocol. Success and failure belong to <code>--green</code> and <code>--red</code>.</p></div>
      <div class="rule do"><h4>Do pair a -soft fill with its solid colour</h4><p>Pills and banners take the <code>-soft</code> variant as background and the solid colour for text and border. The pair is designed to clear contrast together.</p></div>
      <div class="rule dont"><h4>Don't add a fourth text tier</h4><p>Three is enough for any density. A fourth always ends up failing contrast or duplicating an existing tier.</p></div>
      <div class="rule do"><h4>Do let borders carry structure in dark</h4><p>Shadows barely read on a near-black background. Use <code>--border</code> and <code>--inset-hi</code>; save shadow for genuinely floating surfaces.</p></div>
      <div class="rule dont"><h4>Don't hardcode a hex anywhere</h4><p>Every literal colour is a light-mode bug waiting to happen. If a value is missing, add a token rather than an exception.</p></div>
    </div>
  </section>

  <section class="major" id="tokens">
    <div class="eyebrow">Reference</div>
    <h2>All tokens</h2>
    <p class="lede">The complete set. "Inherits" means light mode deliberately reuses the dark value — type, shape and motion are scheme-independent by design.</p>
    <div class="tbl"><table>
      <thead><tr><th>Token</th><th>Dark</th><th>Light</th></tr></thead>
      <tbody>${allTokenRows}</tbody>
    </table></div>
  </section>

  <footer>
    Crafillio DevKit — MIT © 2026 Amit Singh ·
    <a href="https://crafillio.com">crafillio.com</a><br>
    Generated from <code>packages/ui/src/styles.css</code> by <code>npm run style-guide</code>.
  </footer>
</div>

<script>
// Theme switching
const root = document.documentElement;
for (const b of document.querySelectorAll('.toggle button')) {
  b.addEventListener('click', () => {
    root.dataset.theme = b.dataset.set;
    for (const other of document.querySelectorAll('.toggle button')) other.classList.toggle('on', other === b);
    paintContrast();
  });
}

// Live contrast, computed from what the browser actually resolves.
function rgb(colour) {
  const probe = document.createElement('div');
  probe.style.color = colour;
  document.body.appendChild(probe);
  const parsed = getComputedStyle(probe).color.match(/[\\d.]+/g).map(Number);
  probe.remove();
  // [r, g, b, a] — alpha defaults to 1 when the colour is opaque.
  return [parsed[0], parsed[1], parsed[2], parsed.length > 3 ? parsed[3] : 1];
}

/** Flattens a translucent colour onto an opaque backdrop. */
function composite(fg, bg) {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}
function relLum([r, g, b]) {
  const f = [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function ratioOf(rgbA, rgbB) {
  const l1 = relLum(rgbA), l2 = relLum(rgbB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function ratio(a, b) {
  return ratioOf(rgb(a), rgb(b));
}
function label(out, r) {
  out.textContent = r.toFixed(2) + ':1';
  out.className = 'ratio ' + (r >= 4.5 ? 'pass' : r >= 3 ? 'large' : 'fail');
  out.title = r >= 4.5 ? 'Passes AA for all text' : r >= 3 ? 'Passes AA for large text only' : 'Below AA';
}

function paintContrast() {
  const styles = getComputedStyle(root);

  // Translucent fills: measure the solid colour against the fill flattened
  // onto the surface it actually sits on — that is what a pill really renders.
  for (const el of document.querySelectorAll('.swatch[data-fill]')) {
    const out = el.querySelector('.ratio');
    if (!out) continue;
    const fill = styles.getPropertyValue(el.dataset.fill).trim();
    const solid = styles.getPropertyValue(el.dataset.onFill).trim();
    const over = styles.getPropertyValue(el.dataset.over).trim();
    if (!fill || !solid || !over) continue;
    label(out, ratioOf(rgb(solid), composite(rgb(fill), rgb(over))));
  }

  for (const el of document.querySelectorAll('.swatch[data-contrast-on]')) {
    const fg = styles.getPropertyValue(el.dataset.token).trim();
    const bg = styles.getPropertyValue(el.dataset.contrastOn).trim();
    const out = el.querySelector('.ratio');
    if (!fg || !bg || !out) continue;
    label(out, ratio(fg, bg));
  }
}
paintContrast();

// Nudges the figure so tabular numerals can be seen holding their width.
const tick = document.getElementById('tick');
if (tick && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  setInterval(() => {
    const v = (104 + Math.random() * 12).toFixed(1);
    tick.firstChild.textContent = v;
  }, 900);
}
</script>
</body>
</html>
`;

let output = html;

if (artifactMode) {
  // The host provides <html>, <head> and <body>; hand back only what goes
  // inside the body, with the stylesheet kept inline at the top.
  const styleStart = output.indexOf('<style>');
  const styleEnd = output.indexOf('</style>') + '</style>'.length;
  const style = output.slice(styleStart, styleEnd);
  const bodyStart = output.indexOf('<body>') + '<body>'.length;
  const bodyEnd = output.lastIndexOf('</body>');
  output = style + '\n' + output.slice(bodyStart, bodyEnd);

  // Drop our own toggle: two theme switches in one page is a usability bug.
  output = output.replace(
    /<div class="toggle"[\s\S]*?<\/div>\s*(?=<\/div>)/,
    '<span class="tag">Follows your theme</span>',
  );
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, output);

const kb = (output.length / 1024).toFixed(0);
console.log(`Style guide written to ${outPath} (${kb} KB, fonts inlined)${artifactMode ? ' [artifact fragment]' : ''}`);
console.log(`  ${Object.keys(dark).length} tokens · ${Object.keys(lightOverrides).length} light overrides`);
