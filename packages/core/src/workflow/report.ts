/**
 * Renders a finished run as a standalone HTML document.
 *
 * The report is one file with no external references: the flow diagram is
 * inline SVG, and any file produced by the run is embedded as a data URI so it
 * downloads straight from the page. That makes it something you can email,
 * attach to a ticket, or archive alongside a release.
 */

import type { RunResult, StepRecord, StepStatus, Workflow } from './types.js';

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const STATUS_LABEL: Record<StepStatus, string> = {
  success: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
  running: 'Running',
  pending: 'Pending',
};

/** Pretty-prints JSON when the body is JSON, otherwise returns it unchanged. */
function prettyBody(record: StepRecord): string {
  const body = record.response?.body ?? '';
  if (record.response?.bodyEncoding === 'base64') {
    return '(binary — see the download below)';
  }
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return body;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return body;
  }
}

/* ------------------------------------------------------------------ */
/* Diagram                                                             */
/* ------------------------------------------------------------------ */

/**
 * The workflow exactly as it was drawn.
 *
 * When the workflow carries canvas positions we reproduce that layout —
 * same coordinates, same wires — so the document matches what the author
 * built rather than a re-derived diagram. Workflows with no positions (built
 * before the visual editor) fall back to a vertical flow.
 */
function diagram(result: RunResult, workflow?: Workflow): string {
  const positioned = workflow?.steps.filter((s) => s.position) ?? [];
  const useCanvas = positioned.length === workflow?.steps.length && positioned.length > 0;
  return useCanvas ? canvasDiagram(result, workflow!) : flowDiagram(result);
}

const NODE_W = 210;
const NODE_H = 76;

const STATUS_VAR: Record<StepStatus, string> = {
  success: 'var(--ok)',
  failed: 'var(--bad)',
  skipped: 'var(--dim)',
  running: 'var(--brand)',
  pending: 'var(--dim)',
};

/** Reproduces the canvas: absolute node positions joined by bezier wires. */
function canvasDiagram(result: RunResult, workflow: Workflow): string {
  const pad = 30;
  const byId = new Map(result.steps.map((s) => [s.stepId, s]));

  const minX = Math.min(...workflow.steps.map((s) => s.position!.x));
  const minY = Math.min(...workflow.steps.map((s) => s.position!.y));
  const width =
    Math.max(...workflow.steps.map((s) => s.position!.x - minX)) + NODE_W + pad * 2;
  const height =
    Math.max(...workflow.steps.map((s) => s.position!.y - minY)) + NODE_H + pad * 2;

  const at = (id: string): { x: number; y: number } => {
    const step = workflow.steps.find((s) => s.id === id);
    return step?.position
      ? { x: step.position.x - minX + pad, y: step.position.y - minY + pad }
      : { x: pad, y: pad };
  };

  const wires = (workflow.edges ?? [])
    .map((edge) => {
      const from = at(edge.from);
      const to = at(edge.to);
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;

      // Name the values that actually travelled along this wire.
      const carried = (byId.get(edge.from)?.extractedOutputs ?? []).map((o) => o.name);
      const label = carried.length
        ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}" class="edge-label"
                 text-anchor="middle">${esc(carried.slice(0, 3).join(', '))}${
                   carried.length > 3 ? '…' : ''
                 }</text>`
        : '';

      // A straight dotted run reads far more cleanly in print than a wide
      // bezier, which sprawled across the page between distant nodes.
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                    class="edge" marker-end="url(#arrow)"/>${label}`;
    })
    .join('');

  const nodes = workflow.steps
    .map((step, i) => {
      const record = byId.get(step.id);
      const status: StepStatus = record?.status ?? 'pending';
      const stroke = STATUS_VAR[status];
      const p = at(step.id);
      const sub = record?.response
        ? `HTTP ${record.response.status} · ${formatMs(record.durationMs)}`
        : STATUS_LABEL[status];

      return `
        <g>
          <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="10"
                class="node" style="stroke:${stroke}"/>
          <rect x="${p.x}" y="${p.y}" width="4" height="${NODE_H}" rx="2" style="fill:${stroke}"/>
          <circle cx="${p.x + 20}" cy="${p.y + 21}" r="8" style="fill:${stroke}"/>
          <text x="${p.x + 20}" y="${p.y + 25}" class="node-num" text-anchor="middle">${i + 1}</text>
          <text x="${p.x + 35}" y="${p.y + 25}" class="node-title">${esc(
            step.name.length > 20 ? `${step.name.slice(0, 20)}…` : step.name,
          )}</text>
          <text x="${p.x + 14}" y="${p.y + 45}" class="node-method">${esc(
            step.request.method,
          )}</text>
          <text x="${p.x + 14}" y="${p.y + 63}" class="node-sub">${esc(sub)}</text>
        </g>`;
    })
    .join('');

  return `
  <svg viewBox="0 0 ${width} ${height}" class="diagram" role="img"
       aria-label="Workflow canvas">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6"
              orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head"/>
      </marker>
    </defs>
    ${wires}
    ${nodes}
  </svg>`;
}

/** Vertical fallback for workflows with no canvas coordinates. */
function flowDiagram(result: RunResult): string {
  const boxW = 300;
  const boxH = 62;
  const gapY = 40;
  const padX = 30;
  const padY = 20;
  const width = boxW + padX * 2 + 240;
  const height = result.steps.length * (boxH + gapY) - gapY + padY * 2;

  const nodes = result.steps
    .map((step, i) => {
      const y = padY + i * (boxH + gapY);
      const stroke = STATUS_VAR[step.status];
      const carried = step.extractedOutputs.map((o) => o.name).slice(0, 3);
      const carriedLabel = carried.length
        ? `<text x="${padX + boxW + 16}" y="${y + boxH + gapY / 2 + 4}" class="edge-label">${esc(
            carried.join(', ') + (step.extractedOutputs.length > 3 ? '…' : ''),
          )}</text>`
        : '';

      const connector =
        i < result.steps.length - 1
          ? `<line x1="${padX + boxW / 2}" y1="${y + boxH}" x2="${padX + boxW / 2}" y2="${
              y + boxH + gapY
            }" class="edge" marker-end="url(#arrow)"/>${carriedLabel}`
          : '';

      const statusText = step.response
        ? `HTTP ${step.response.status} · ${formatMs(step.durationMs)}`
        : STATUS_LABEL[step.status];

      return `
        <g>
          <rect x="${padX}" y="${y}" width="${boxW}" height="${boxH}" rx="10"
                class="node" style="stroke:${stroke}"/>
          <rect x="${padX}" y="${y}" width="4" height="${boxH}" rx="2" style="fill:${stroke}"/>
          <text x="${padX + 16}" y="${y + 25}" class="node-title">${esc(
            `${i + 1}. ${step.name}`,
          )}</text>
          <text x="${padX + 16}" y="${y + 44}" class="node-sub">${esc(statusText)}</text>
        </g>
        ${connector}`;
    })
    .join('');

  return `
  <svg viewBox="0 0 ${width} ${height}" class="diagram" role="img"
       aria-label="Workflow flow diagram">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6"
              orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head"/>
      </marker>
    </defs>
    ${nodes}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Step cards                                                          */
/* ------------------------------------------------------------------ */

function stepCard(step: StepRecord): string {
  const kv = (rows: Array<[string, string]>): string =>
    rows.length
      ? `<table class="kv"><tbody>${rows
          .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`)
          .join('')}</tbody></table>`
      : '<p class="none">None</p>';

  const inputs = step.resolvedInputs.length
    ? `<table class="kv"><thead><tr><th>Name</th><th>Value used</th><th>Came from</th></tr></thead><tbody>${step.resolvedInputs
        .map(
          (i) =>
            `<tr><td class="k">${esc(i.name)}</td><td class="v">${esc(i.value)}${
              i.truncated ? '<span class="trunc"> truncated</span>' : ''
            }</td><td class="src">${esc(i.source)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="none">This step used no inputs from earlier steps.</p>';

  const outputs = step.extractedOutputs.length
    ? `<table class="kv"><thead><tr><th>Published as</th><th>Value</th></tr></thead><tbody>${step.extractedOutputs
        .map(
          (o) =>
            `<tr><td class="k">${esc(o.name)}</td><td class="v">${esc(o.value)}${
              o.truncated ? '<span class="trunc"> truncated</span>' : ''
            }</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="none">This step published nothing to later steps.</p>';

  const artifacts = step.artifacts.length
    ? `<div class="artifacts">${step.artifacts
        .map(
          (a) => `
          <a class="download" download="${esc(a.name)}"
             href="data:${esc(a.contentType)};base64,${a.base64}">
            <span class="dl-icon" aria-hidden="true">↓</span>
            <span><strong>${esc(a.name)}</strong><small>${esc(a.contentType)} · ${formatBytes(
              a.size,
            )}</small></span>
          </a>`,
        )
        .join('')}</div>`
    : '';

  return `
  <section class="step ${step.status}" id="step-${esc(step.stepId)}">
    <header class="step-head">
      <span class="idx">${step.index + 1}</span>
      <h3>${esc(step.name)}</h3>
      <span class="badge ${step.status}">${STATUS_LABEL[step.status]}</span>
      ${step.response ? `<span class="badge http s${Math.floor(step.response.status / 100)}">HTTP ${step.response.status}</span>` : ''}
      <span class="dur">${formatMs(step.durationMs)}</span>
    </header>

    ${step.error ? `<div class="error"><strong>Error</strong>${esc(step.error)}</div>` : ''}

    <div class="pane">
      <h4>Inputs used</h4>
      ${inputs}
    </div>

    ${
      step.request
        ? `<div class="pane">
      <h4>Request sent</h4>
      <p class="line"><span class="method">${esc(step.request.method)}</span> <code>${esc(
        step.request.url,
      )}</code></p>
      <h5>Headers</h5>
      ${kv(step.request.headers)}
      ${step.request.body ? `<h5>Body</h5><pre>${esc(step.request.body)}</pre>` : ''}
    </div>`
        : ''
    }

    ${
      step.response
        ? `<div class="pane">
      <h4>Response received</h4>
      <p class="line"><strong>${step.response.status}</strong> · ${formatBytes(
        step.response.size,
      )} · ${formatMs(step.response.timingMs)}</p>
      <h5>Headers</h5>
      ${kv(step.response.headers)}
      <h5>Body</h5>
      <pre>${esc(prettyBody(step))}</pre>
      ${artifacts}
    </div>`
        : ''
    }

    <div class="pane">
      <h4>Published to later steps</h4>
      ${outputs}
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ */

export function renderReport(result: RunResult, workflow?: Workflow): string {
  const counts = {
    success: result.steps.filter((s) => s.status === 'success').length,
    failed: result.steps.filter((s) => s.status === 'failed').length,
    skipped: result.steps.filter((s) => s.status === 'skipped').length,
  };

  const allArtifacts = result.steps.flatMap((s) => s.artifacts);
  const started = new Date(result.startedAt);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(result.workflowName)} — run report</title>
<style>
:root{
  --brand:#e4007f; --brand-dark:#c2006c;
  --bg:#f2f3f6; --surface:#ffffff; --surface-2:#f7f8fa;
  --border:#e0e3ea; --border-strong:#c2c7d2;
  --text:#14151a; --muted:#545a67; --dim:#666c7a;
  --ok:#007a52; --bad:#c62020; --warn:#8a5b00;
  --ok-soft:rgba(0,122,82,.10); --bad-soft:rgba(198,32,32,.09); --warn-soft:rgba(138,91,0,.11);
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
}
@media (prefers-color-scheme: dark){
  :root{
    --brand:#ff5fae; --brand-dark:#e4007f;
    --bg:#0d0e12; --surface:#15161c; --surface-2:#1c1e26;
    --border:#292b36; --border-strong:#3b3e4d;
    --text:#ecedf1; --muted:#a1a5b3; --dim:#82879a;
    --ok:#2ecc9a; --bad:#ff5a52; --warn:#f0a500;
    --ok-soft:rgba(46,204,154,.14); --bad-soft:rgba(255,90,82,.14); --warn-soft:rgba(240,165,0,.14);
  }
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.6;
  -webkit-font-smoothing:antialiased;font-size:15px}
.wrap{max-width:1000px;margin:0 auto;padding:40px 24px 80px}
code,pre,.mono{font-family:var(--mono)}

header.top{border-bottom:3px solid var(--brand);padding-bottom:22px;margin-bottom:30px}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brand);margin-bottom:8px}
h1{font-size:31px;font-weight:650;letter-spacing:-.02em;line-height:1.2;margin-bottom:8px}
.sub{color:var(--muted);font-size:14px}

.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:26px 0 34px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.card .label{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin-bottom:6px}
.card .value{font-size:23px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.card.ok .value{color:var(--ok)} .card.bad .value{color:var(--bad)}

h2{font-size:19px;font-weight:650;letter-spacing:-.01em;margin:38px 0 14px;padding-bottom:9px;border-bottom:1px solid var(--border)}

.diagram-wrap{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;overflow-x:auto}
.diagram{max-width:100%;height:auto;display:block;min-width:520px}
.node{fill:var(--surface-2);stroke-width:1.5}
.node-title{font-family:var(--sans);font-size:14px;font-weight:600;fill:var(--text)}
.node-sub{font-family:var(--mono);font-size:11.5px;fill:var(--muted)}
.node-status{font-family:var(--sans);font-size:9.5px;font-weight:700;letter-spacing:.08em}
.edge{stroke:var(--border-strong);stroke-width:1.2;stroke-dasharray:3 4}
.arrow-head{fill:var(--border-strong)}
.edge-label{font-family:var(--mono);font-size:11px;fill:var(--brand)}

.step{background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden}
.step.failed{border-color:var(--bad)}
.step-head{display:flex;align-items:center;gap:11px;padding:14px 18px;background:var(--surface-2);border-bottom:1px solid var(--border);flex-wrap:wrap}
.idx{width:24px;height:24px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700;flex-shrink:0}
.step-head h3{font-size:15.5px;font-weight:620;flex:1;min-width:150px}
.dur{font-family:var(--mono);font-size:12px;color:var(--dim)}
.badge{padding:2px 9px;border-radius:999px;font-size:11px;font-weight:650}
.badge.success{background:var(--ok-soft);color:var(--ok)}
.badge.failed{background:var(--bad-soft);color:var(--bad)}
.badge.skipped{background:var(--surface);color:var(--dim);border:1px solid var(--border)}
.badge.http{font-family:var(--mono)}
.badge.http.s2{background:var(--ok-soft);color:var(--ok)}
.badge.http.s3{background:var(--warn-soft);color:var(--warn)}
.badge.http.s4,.badge.http.s5{background:var(--bad-soft);color:var(--bad)}

.pane{padding:16px 18px;border-bottom:1px solid var(--border)}
.pane:last-child{border-bottom:none}
.pane h4{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin-bottom:11px}
.pane h5{font-size:11.5px;font-weight:650;color:var(--muted);margin:14px 0 7px}
.line{margin-bottom:11px;font-size:13.5px;word-break:break-all}
.method{display:inline-block;padding:1px 8px;border-radius:4px;background:var(--brand);color:#fff;font-family:var(--mono);font-size:11px;font-weight:700;margin-right:7px}

table.kv{width:100%;border-collapse:collapse;font-size:13px}
table.kv th{text-align:left;padding:6px 10px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--border)}
table.kv td{padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:top}
table.kv tr:last-child td{border-bottom:none}
td.k{font-family:var(--mono);color:var(--muted);white-space:nowrap;width:1%}
td.v{font-family:var(--mono);word-break:break-word}
td.src{color:var(--dim);font-size:12px}
.trunc{color:var(--warn);font-size:11px;font-style:italic}
.none{color:var(--dim);font-size:13px;font-style:italic}

pre{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:13px;overflow-x:auto;font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:420px}

.error{margin:0;padding:13px 18px;background:var(--bad-soft);border-bottom:1px solid var(--border);color:var(--bad);font-size:13.5px}
.error strong{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px}

.artifacts{display:flex;flex-wrap:wrap;gap:10px;margin-top:13px}
.download{display:flex;align-items:center;gap:11px;padding:11px 15px;background:var(--surface-2);border:1px solid var(--border-strong);border-radius:9px;text-decoration:none;color:var(--text);transition:border-color .15s,background .15s}
.download:hover{border-color:var(--brand);background:var(--bg)}
.dl-icon{width:28px;height:28px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-size:15px;flex-shrink:0}
.download strong{display:block;font-size:13.5px}
.download small{color:var(--dim);font-size:11.5px;font-family:var(--mono)}

h3{font-size:15px;font-weight:640;margin:26px 0 10px}
.note{color:var(--muted);font-size:13px;margin-bottom:10px}
td.r,th.r{text-align:right}
.bar{display:inline-block;width:70px;height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden;margin-right:7px;vertical-align:middle}
.bar i{display:block;height:100%;background:var(--brand)}
.node-num{font-family:var(--sans);font-size:9.5px;font-weight:700;fill:#fff}
.node-method{font-family:var(--mono);font-size:10px;font-weight:700;fill:var(--brand)}
footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--border);color:var(--dim);font-size:12.5px}
@media print{
  body{background:#fff}
  .step,.card,.diagram-wrap{break-inside:avoid}
  pre{max-height:none}
}
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <div class="eyebrow">Workflow run report</div>
    <h1>${esc(result.workflowName)}</h1>
    <p class="sub">Run ${esc(result.runId.slice(0, 8))} · started ${esc(
      started.toLocaleString(),
    )} · took ${formatMs(result.durationMs)}</p>
  </header>

  <div class="summary">
    <div class="card ${result.status === 'success' ? 'ok' : 'bad'}">
      <div class="label">Outcome</div>
      <div class="value">${result.status === 'success' ? 'Passed' : result.status === 'partial' ? 'Partial' : 'Failed'}</div>
    </div>
    <div class="card"><div class="label">Steps</div><div class="value">${result.steps.length}</div></div>
    <div class="card ok"><div class="label">Succeeded</div><div class="value">${counts.success}</div></div>
    <div class="card ${counts.failed ? 'bad' : ''}"><div class="label">Failed</div><div class="value">${counts.failed}</div></div>
    ${counts.skipped ? `<div class="card"><div class="label">Skipped</div><div class="value">${counts.skipped}</div></div>` : ''}
    <div class="card"><div class="label">Duration</div><div class="value">${formatMs(result.durationMs)}</div></div>
  </div>

  <h2>Flow</h2>
  <div class="diagram-wrap">${diagram(result, workflow)}</div>

  ${
    allArtifacts.length
      ? `<h2>Files produced</h2>
  <div class="artifacts">${allArtifacts
    .map(
      (a) => `
      <a class="download" download="${esc(a.name)}" href="data:${esc(
        a.contentType,
      )};base64,${a.base64}">
        <span class="dl-icon" aria-hidden="true">↓</span>
        <span><strong>${esc(a.name)}</strong><small>${esc(a.contentType)} · ${formatBytes(
          a.size,
        )}</small></span>
      </a>`,
    )
    .join('')}</div>`
      : ''
  }

  <h2>Technical summary</h2>

  <h3>Execution</h3>
  <div class="tbl"><table>
    <tbody>
      <tr><td class="k">Run identifier</td><td class="v">${esc(result.runId)}</td></tr>
      <tr><td class="k">Workflow identifier</td><td class="v">${esc(result.workflowId)}</td></tr>
      <tr><td class="k">Started</td><td class="v">${esc(result.startedAt)}</td></tr>
      <tr><td class="k">Wall-clock duration</td><td class="v">${formatMs(result.durationMs)}</td></tr>
      <tr><td class="k">Steps executed</td><td class="v">${result.steps.length} (${counts.success} succeeded, ${counts.failed} failed, ${counts.skipped} skipped)</td></tr>
      <tr><td class="k">Execution order</td><td class="v">${esc(result.steps.map((s) => s.name).join('  →  '))}</td></tr>
      <tr><td class="k">Total bytes received</td><td class="v">${formatBytes(
        result.steps.reduce((n, s) => n + (s.response?.size ?? 0), 0),
      )}</td></tr>
      <tr><td class="k">Files produced</td><td class="v">${allArtifacts.length}</td></tr>
    </tbody>
  </table></div>

  <h3>Timing breakdown</h3>
  <div class="tbl"><table>
    <thead><tr><th>#</th><th>Step</th><th>Method</th><th>Status</th><th class="r">Duration</th><th class="r">Share</th><th class="r">Bytes</th></tr></thead>
    <tbody>
      ${result.steps
        .map((step) => {
          const share = result.durationMs > 0 ? (step.durationMs / result.durationMs) * 100 : 0;
          return `<tr>
            <td class="k">${step.index + 1}</td>
            <td>${esc(step.name)}</td>
            <td class="v">${esc(step.request?.method ?? '—')}</td>
            <td class="v">${step.response ? step.response.status : STATUS_LABEL[step.status]}</td>
            <td class="v r">${formatMs(step.durationMs)}</td>
            <td class="r"><span class="bar"><i style="width:${Math.min(100, share).toFixed(1)}%"></i></span>${share.toFixed(1)}%</td>
            <td class="v r">${step.response ? formatBytes(step.response.size) : '—'}</td>
          </tr>`;
        })
        .join('')}
    </tbody>
  </table></div>

  <h3>Data flow</h3>
  <p class="note">Every value that moved between steps, and where it was consumed.</p>
  <div class="tbl"><table>
    <thead><tr><th>Value</th><th>Produced by</th><th>Consumed by</th><th>Resolved to</th></tr></thead>
    <tbody>
      ${(() => {
        const produced = new Map<string, { by: string; value: string }>();
        for (const step of result.steps) {
          for (const out of step.extractedOutputs) {
            produced.set(out.name, { by: step.name, value: out.value });
          }
        }
        const consumers = new Map<string, string[]>();
        for (const step of result.steps) {
          const body = `${step.request?.url ?? ''} ${step.request?.body ?? ''} ${(
            step.request?.headers ?? []
          )
            .map(([k, v]) => `${k}${v}`)
            .join('')}`;
          for (const name of produced.keys()) {
            // A produced value counts as consumed when its resolved text shows
            // up in a later request.
            const resolved = produced.get(name)!.value;
            if (resolved && resolved.length > 1 && body.includes(resolved)) {
              consumers.set(name, [...(consumers.get(name) ?? []), step.name]);
            }
          }
        }
        const rows = [...produced.entries()].map(
          ([name, info]) => `<tr>
            <td class="k">${esc(name)}</td>
            <td>${esc(info.by)}</td>
            <td>${esc((consumers.get(name) ?? []).filter((c) => c !== info.by).join(', ') || '—')}</td>
            <td class="v">${esc(info.value)}</td>
          </tr>`,
        );
        return rows.length ? rows.join('') : '<tr><td colspan="4" class="none">No values were passed between steps.</td></tr>';
      })()}
    </tbody>
  </table></div>

  ${
    Object.keys(result.context).length
      ? `<h3>Final variable context</h3>
  <p class="note">Every name resolvable at the end of the run, including environment variables.</p>
  <div class="tbl"><table>
    <thead><tr><th>Name</th><th>Value</th></tr></thead>
    <tbody>${Object.entries(result.context)
      .map(
        ([k, v]) =>
          `<tr><td class="k">${esc(k)}</td><td class="v">${esc(
            v.length > 300 ? `${v.slice(0, 300)}…` : v,
          )}</td></tr>`,
      )
      .join('')}</tbody>
  </table></div>`
      : ''
  }

  <h2>Steps in detail</h2>
  ${result.steps.map(stepCard).join('')}

  <footer>
    Generated by API Devkit · ${esc(new Date().toLocaleString())}<br>
    Every file above is embedded in this document — it works offline and can be archived as-is.
  </footer>
</div>
</body>
</html>`;
}
