import type {
  GrpcRequest,
  KeyValue,
  MultipartField,
  RestRequest,
} from '@crafillio/core';

let counter = 0;

/** Ids only need to be unique within a session; rows are re-keyed on save. */
export function uid(prefix = 'r'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export function blankRow(): KeyValue {
  return { id: uid(), key: '', value: '', enabled: true };
}

export function blankMultipart(): MultipartField {
  return { id: uid(), key: '', enabled: true, type: 'text', value: '' };
}

export function blankRest(): RestRequest {
  return {
    method: 'GET',
    url: '',
    headers: [blankRow()],
    query: [blankRow()],
    body: { kind: 'none' },
    auth: { kind: 'none' },
    timeoutMs: 30_000,
    followRedirects: true,
    maxRedirects: 5,
    insecureTls: false,
  };
}

export function blankGrpc(): GrpcRequest {
  return {
    target: { address: '', tls: false, insecureTls: false },
    source: { kind: 'reflection' },
    service: '',
    method: '',
    messages: ['{}'],
    metadata: [blankRow()],
    timeoutMs: 30_000,
  };
}

/**
 * Trailing blank row so there is always somewhere to type, the way every
 * request tool behaves. Rows with no key are dropped before sending.
 */
export function withTrailingBlank<T extends { key: string }>(
  rows: T[],
  make: () => T,
): T[] {
  const last = rows[rows.length - 1];
  if (!last || last.key.trim() !== '') return [...rows, make()];
  return rows;
}
