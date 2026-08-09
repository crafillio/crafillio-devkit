/**
 * Renders a request and its response as a self-contained page, for capturing
 * to an image.
 *
 * Capturing the window would only ever get what happens to be on screen — a
 * 4 KB response body is exactly the thing you want to send someone, and
 * exactly the thing that scrolls out of view. So the capture is rendered from
 * the data instead: everything is laid out at full height, and the image is
 * sized to the content rather than the viewport.
 *
 * Nothing here is fetched. Fonts fall back to the system stack rather than
 * being embedded, because an image does not need the real typeface to be
 * legible and inlining ~200 KB per screenshot is not worth it.
 */

export interface CaptureSection {
  label: string;
  /** `kv` renders a two-column table; `code` renders a monospace block. */
  kind: 'kv' | 'code';
  rows?: Array<[string, string]>;
  text?: string;
  /** Shown when a code section has nothing in it. */
  emptyNote?: string;
}

export interface CaptureInput {
  title: string;
  protocol: 'rest' | 'grpc' | 'workflow';
  /** The headline line, e.g. `GET https://api.example.com/orders`. */
  subtitle: string;
  /** Small facts shown as chips: status, duration, size. */
  chips: Array<{ label: string; tone?: 'good' | 'bad' | 'plain' }>;
  sections: CaptureSection[];
  /** Footer note, e.g. when it ran. */
  capturedAt: string;
}

const esc = (value: string): string =>
  value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Long single-line values must wrap or the image grows absurdly wide. */
const WRAP = 'word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap;';

function renderSection(section: CaptureSection): string {
  if (section.kind === 'kv') {
    const rows = section.rows ?? [];
    if (rows.length === 0) {
      return `<section><h2>${esc(section.label)}</h2><p class="none">None</p></section>`;
    }
    return `<section>
      <h2>${esc(section.label)}</h2>
      <table>${rows
        .map(
          ([k, v]) =>
            `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`,
        )
        .join('')}</table>
    </section>`;
  }

  const text = section.text ?? '';
  if (!text.trim()) {
    return `<section><h2>${esc(section.label)}</h2><p class="none">${esc(
      section.emptyNote ?? 'Empty',
    )}</p></section>`;
  }
  return `<section>
    <h2>${esc(section.label)}</h2>
    <pre>${esc(text)}</pre>
  </section>`;
}

export function renderCapture(input: CaptureInput): string {
  const accent = '#e4007f';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<!-- Every value here is escaped, but the content is still someone's API
     response. The policy means a missed escape cannot become execution. -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 30px 22px;
    width: 1040px;
    background: #14151c;
    color: #e7e8ee;
    font: 13px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  header { border-bottom: 1px solid #2a2c38; padding-bottom: 14px; margin-bottom: 18px; }
  h1 { margin: 0 0 6px; font-size: 17px; font-weight: 650; letter-spacing: -0.01em; }
  .sub {
    margin: 0 0 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: #9fa2b4;
    ${WRAP}
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    padding: 2px 9px; border-radius: 999px; border: 1px solid #2a2c38;
    background: #1b1d26; font-family: ui-monospace, Menlo, monospace; font-size: 10.5px;
    color: #9fa2b4;
  }
  .chip.good { color: #46d39a; border-color: #46d39a55; background: #46d39a1a; }
  .chip.bad  { color: #ff6b6b; border-color: #ff6b6b55; background: #ff6b6b1a; }
  section { margin-bottom: 18px; }
  h2 {
    margin: 0 0 7px; font-size: 10.5px; font-weight: 650; letter-spacing: 0.07em;
    text-transform: uppercase; color: ${accent};
  }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 8px; border-bottom: 1px solid #22242e; vertical-align: top; font-size: 12px; }
  td.k { width: 230px; color: #9fa2b4; font-family: ui-monospace, Menlo, monospace; ${WRAP} }
  td.v { font-family: ui-monospace, Menlo, monospace; ${WRAP} }
  pre {
    margin: 0; padding: 12px 14px; background: #1b1d26; border: 1px solid #2a2c38;
    border-radius: 7px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px; line-height: 1.5; ${WRAP}
  }
  .none { margin: 0; color: #6f7284; font-size: 12px; font-style: italic; }
  footer {
    margin-top: 20px; padding-top: 12px; border-top: 1px solid #2a2c38;
    display: flex; justify-content: space-between;
    font-size: 10.5px; color: #6f7284;
  }
</style></head>
<body>
  <header>
    <h1>${esc(input.title)}</h1>
    <p class="sub">${esc(input.subtitle)}</p>
    <div class="chips">${input.chips
      .map((c) => `<span class="chip ${c.tone ?? 'plain'}">${esc(c.label)}</span>`)
      .join('')}</div>
  </header>

  ${input.sections.map(renderSection).join('')}

  <footer>
    <span>API Devkit</span>
    <span>${esc(input.capturedAt)}</span>
  </footer>
</body></html>`;
}
