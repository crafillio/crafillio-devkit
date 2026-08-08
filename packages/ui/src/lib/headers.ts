/**
 * Header name suggestions for the request editors.
 *
 * Kept as a plain list rather than pulled from a package: it is small, it
 * never needs updating in a hurry, and it keeps the renderer bundle free of
 * another dependency.
 */
export const COMMON_HEADERS = [
  'Accept',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Access-Control-Allow-Origin',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Disposition',
  'Content-Encoding',
  'Content-Language',
  'Content-Length',
  'Content-Type',
  'Cookie',
  'Date',
  'ETag',
  'Expect',
  'Forwarded',
  'From',
  'Host',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'If-Unmodified-Since',
  'Idempotency-Key',
  'Keep-Alive',
  'Location',
  'Origin',
  'Pragma',
  'Prefer',
  'Proxy-Authorization',
  'Range',
  'Referer',
  'Retry-After',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'User-Agent',
  'Via',
  'Warning',
  'X-Api-Key',
  'X-Correlation-ID',
  'X-CSRF-Token',
  'X-Forwarded-For',
  'X-Forwarded-Host',
  'X-Forwarded-Proto',
  'X-Request-ID',
  'X-Requested-With',
] as const;

/** Common values, offered once the header name is known. */
export const HEADER_VALUES: Record<string, string[]> = {
  accept: [
    'application/json',
    'application/xml',
    'text/plain',
    'text/html',
    '*/*',
  ],
  'content-type': [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'application/xml',
    'text/plain',
    'application/octet-stream',
  ],
  'accept-encoding': ['gzip, deflate, br', 'gzip', 'identity'],
  'cache-control': ['no-cache', 'no-store', 'max-age=0'],
  authorization: ['Bearer {{token}}'],
  connection: ['keep-alive', 'close'],
  'x-requested-with': ['XMLHttpRequest'],
};

/** Values to suggest for a given header name, or none. */
export function valuesFor(headerName: string): string[] {
  return HEADER_VALUES[headerName.trim().toLowerCase()] ?? [];
}

/** Shared datalist ids, so the options are emitted once per document. */
export const HEADER_NAME_LIST = 'crafillio-header-names';
