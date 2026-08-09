import type { CaptureInput, CaptureSection, RestResponse } from '@crafillio/core';
import type { GrpcTab, RestTab } from '../state/store';

/**
 * Builds the capture payload for a tab.
 *
 * Deliberately assembled from the tab's data rather than scraped from the DOM:
 * the screenshot should contain the whole request and response, including the
 * parts currently scrolled out of view or hidden behind another sub-tab.
 */

const enabled = (rows: Array<{ key: string; value: string; enabled: boolean }>): Array<[string, string]> =>
  rows.filter((r) => r.enabled && r.key.trim()).map((r) => [r.key, r.value]);

function bodyText(body: RestTab['request']['body']): { text: string; note: string } {
  switch (body.kind) {
    case 'none':
      return { text: '', note: 'No body' };
    case 'json':
    case 'text':
      return { text: body.text, note: 'Empty' };
    case 'form':
      return {
        text: body.fields
          .filter((f) => f.enabled && f.key.trim())
          .map((f) => `${f.key}=${f.value}`)
          .join('\n'),
        note: 'No fields',
      };
    case 'multipart':
      return {
        text: body.fields
          .filter((f) => f.enabled && f.key.trim())
          .map((f) => `${f.key}: ${f.type === 'file' ? `[file] ${f.filePath}` : f.value}`)
          .join('\n'),
        note: 'No parts',
      };
    case 'binary':
      return { text: `[binary] ${body.filePath}`, note: 'No file chosen' };
  }
}

/** Secrets should not be baked into an image that gets pasted into a ticket. */
const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i;

function redact(rows: Array<[string, string]>, redactSecrets: boolean): Array<[string, string]> {
  if (!redactSecrets) return rows;
  return rows.map(([k, v]) => (SENSITIVE.test(k.trim()) ? [k, '••••••••  (hidden)'] : [k, v]));
}

function responseSections(
  response: RestResponse | null | undefined,
  redactSecrets: boolean,
): CaptureSection[] {
  if (!response) {
    return [{ label: 'Response', kind: 'code', text: '', emptyNote: 'Not sent yet' }];
  }
  return [
    {
      label: 'Response headers',
      kind: 'kv',
      rows: redact(Object.entries(response.headers), redactSecrets),
    },
    {
      label: 'Response body',
      kind: 'code',
      text:
        response.bodyEncoding === 'base64'
          ? `[binary — ${response.size} bytes, not shown]`
          : response.body,
      emptyNote: 'Empty response body',
    },
  ];
}

export function captureForRest(tab: RestTab, redactSecrets: boolean): CaptureInput {
  const req = tab.request;
  const res = tab.response ?? null;

  const chips: CaptureInput['chips'] = [];
  if (res) {
    chips.push({ label: `${res.status} ${res.statusText}`.trim(), tone: res.ok ? 'good' : 'bad' });
    chips.push({ label: `${Math.round(res.timing.totalMs)} ms` });
    chips.push({ label: `${res.size} bytes` });
  } else {
    chips.push({ label: 'not sent' });
  }
  if (req.insecureTls) chips.push({ label: 'TLS ignored', tone: 'bad' });

  return {
    title: tab.name,
    protocol: 'rest',
    subtitle: `${req.method} ${req.url}`,
    chips,
    capturedAt: new Date().toLocaleString(),
    sections: [
      { label: 'Query parameters', kind: 'kv', rows: enabled(req.query) },
      { label: 'Request headers', kind: 'kv', rows: redact(enabled(req.headers), redactSecrets) },
      {
        label: 'Auth',
        kind: 'kv',
        rows: req.auth.kind === 'none' ? [] : [['Scheme', req.auth.kind]],
      },
      {
        label: `Request body (${req.body.kind})`,
        kind: 'code',
        text: bodyText(req.body).text,
        emptyNote: bodyText(req.body).note,
      },
      ...responseSections(res, redactSecrets),
    ],
  };
}

export function captureForGrpc(tab: GrpcTab, redactSecrets: boolean): CaptureInput {
  const req = tab.request;
  const events = tab.events ?? [];

  const status = events.find((e) => e.type === 'status');
  const messages = events.filter((e) => e.type === 'message');

  const chips: CaptureInput['chips'] = [];
  if (status && status.type === 'status') {
    chips.push({ label: status.codeName, tone: status.code === 0 ? 'good' : 'bad' });
    chips.push({ label: `${Math.round(status.totalMs)} ms` });
  } else {
    chips.push({ label: 'not called' });
  }
  chips.push({ label: `${messages.length} message${messages.length === 1 ? '' : 's'}` });
  if (req.target.insecureTls) chips.push({ label: 'TLS ignored', tone: 'bad' });

  return {
    title: tab.name,
    protocol: 'grpc',
    subtitle: `${req.target.address}  ${req.service}/${req.method}`,
    chips,
    capturedAt: new Date().toLocaleString(),
    sections: [
      {
        label: 'Metadata',
        kind: 'kv',
        rows: redact(enabled(req.metadata), redactSecrets),
      },
      {
        label: 'Request message',
        kind: 'code',
        text: req.messages.join('\n\n'),
        emptyNote: 'No message',
      },
      {
        label: 'Response messages',
        kind: 'code',
        text: messages
          .map((m) => (m.type === 'message' ? m.json : ''))
          .filter(Boolean)
          .join('\n\n'),
        emptyNote: 'Nothing received',
      },
      {
        label: 'Status',
        kind: 'kv',
        rows:
          status && status.type === 'status'
            ? [
                ['Code', `${status.code} ${status.codeName}`],
                ['Details', status.details || '—'],
                ['Total', `${Math.round(status.totalMs)} ms`],
              ]
            : [],
      },
    ],
  };
}
