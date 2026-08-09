/**
 * JWT decoding.
 *
 * Decoding only — this never claims a token is valid. Verifying a signature
 * needs the issuer's key, which the app does not have, and a decoder that
 * implied "looks fine" would be worse than useless: anyone can mint a token
 * whose payload says whatever they like. What it can do honestly is show you
 * what a token asserts, and whether the times inside it have passed.
 */

export interface JwtClaim {
  name: string;
  /** The raw value, JSON-encoded when it is not a string or number. */
  value: string;
  /** What the claim means, for the registered ones. */
  meaning?: string;
  /** Rendered form of a NumericDate, e.g. "expired 3 minutes ago". */
  relative?: string;
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** Base64url, exactly as it appeared. Empty for an unsecured token. */
  signature: string;
  /** Pretty-printed, for display. */
  headerJson: string;
  payloadJson: string;
  claims: JwtClaim[];
  algorithm: string;
  /** True when `exp` has passed. Undefined when the token has no `exp`. */
  expired?: boolean;
  /** True when `nbf` is still in the future. */
  notYetValid?: boolean;
  /**
   * Things worth saying out loud — an `alg` of none, an absent expiry. Never
   * fatal; the token is still shown.
   */
  warnings: string[];
}

/** RFC 7519 registered claims, plus the handful everyone actually ships. */
const KNOWN: Record<string, string> = {
  iss: 'Issuer — who created and signed this token',
  sub: 'Subject — who the token is about',
  aud: 'Audience — who the token is meant for',
  exp: 'Expiry',
  nbf: 'Not valid before',
  iat: 'Issued at',
  jti: 'Token id, for revocation or replay checks',
  azp: 'Authorised party',
  scope: 'Granted scopes',
  scp: 'Granted scopes',
  typ: 'Token type',
  alg: 'Signing algorithm',
  kid: 'Key id — which key signed this',
  email: 'Email address',
  name: 'Display name',
  roles: 'Assigned roles',
  groups: 'Group membership',
  client_id: 'OAuth client that requested the token',
  token_use: 'What this token is for (access or id)',
};

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at']);

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const buf = Buffer.from(padded + pad, 'base64');
  // Buffer.from is famously permissive — it drops what it cannot parse rather
  // than failing. Re-encoding and comparing is what actually catches junk.
  if (buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
      !== segment.replace(/=+$/, '')) {
    throw new Error('not valid base64url');
  }
  return buf.toString('utf8');
}

/** "in 4 minutes" / "3 days ago", from a NumericDate in seconds. */
function relativeTime(seconds: number, now: number): string {
  const deltaMs = seconds * 1000 - now;
  const ahead = deltaMs > 0;
  const abs = Math.abs(deltaMs);

  const units: Array<[number, string]> = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1000, 'second'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return `${ahead ? 'in ' : ''}${n} ${label}${n === 1 ? '' : 's'}${ahead ? '' : ' ago'}`;
    }
  }
  return 'just now';
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Decodes a JWT. Throws with a message worth showing when the input is not one.
 *
 * `now` is injectable so expiry reporting can be tested without waiting.
 */
export function decodeJwt(token: string, now: number = Date.now()): DecodedJwt {
  const trimmed = token
    .trim()
    // Pasting straight from a header is the common case.
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    // Wrapped tokens from a terminal or an editor.
    .replace(/\s+/g, '');

  if (!trimmed) throw new Error('Nothing to decode.');

  const parts = trimmed.split('.');
  if (parts.length === 5) {
    throw new Error(
      'This is a JWE (five parts) — the payload is encrypted, not merely encoded, ' +
        'so it cannot be read without the decryption key.',
    );
  }
  if (parts.length !== 3 && parts.length !== 2) {
    throw new Error(
      `A JWT has three dot-separated parts; this has ${parts.length}. ` +
        'Check for a truncated copy or a stray character.',
    );
  }

  const [headerPart, payloadPart, signaturePart = ''] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerPart!)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`The header is not readable: ${(err as Error).message}.`);
  }
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart!)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`The payload is not readable: ${(err as Error).message}.`);
  }

  const warnings: string[] = [];
  const algorithm = typeof header.alg === 'string' ? header.alg : 'unknown';

  if (algorithm.toLowerCase() === 'none' || parts.length === 2 || signaturePart === '') {
    warnings.push(
      'This token is unsigned (alg "none"), so anything in it could have been written by anyone.',
    );
  }

  const claims: JwtClaim[] = [];
  let expired: boolean | undefined;
  let notYetValid: boolean | undefined;

  for (const [name, value] of Object.entries(payload)) {
    const claim: JwtClaim = { name, value: describeValue(value) };
    if (KNOWN[name]) claim.meaning = KNOWN[name];

    if (TIME_CLAIMS.has(name) && typeof value === 'number') {
      const when = new Date(value * 1000);
      claim.value = `${when.toISOString()}`;
      claim.relative = relativeTime(value, now);
      if (name === 'exp') expired = value * 1000 <= now;
      if (name === 'nbf') notYetValid = value * 1000 > now;
    }
    claims.push(claim);
  }

  if (expired === undefined) {
    warnings.push('No exp claim: this token does not expire on its own.');
  } else if (expired) {
    warnings.push('This token has expired.');
  }
  if (notYetValid) warnings.push('This token is not valid yet — its nbf is in the future.');

  return {
    header,
    payload,
    signature: signaturePart,
    headerJson: JSON.stringify(header, null, 2),
    payloadJson: JSON.stringify(payload, null, 2),
    claims,
    algorithm,
    expired,
    notYetValid,
    warnings,
  };
}

/** Cheap check for "does this look like a JWT", for offering to decode one. */
export function looksLikeJwt(text: string): boolean {
  const trimmed = text.trim().replace(/^Bearer\s+/i, '');
  return /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*$/.test(trimmed);
}
