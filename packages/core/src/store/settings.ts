import { PATHS, readJson, writeJson } from './paths.js';

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  /** Default request timeout in ms, applied to new requests. */
  defaultTimeoutMs: number;
  /** Wrap long lines in the response viewer. */
  wrapResponses: boolean;
  fontSize: number;
  /** Persist request history at all. Off means nothing is written to disk. */
  keepHistory: boolean;
  /**
   * Where secret values are encrypted.
   *
   * Defaults to 'keyfile' because the OS keychain shows a system prompt on
   * macOS, which is intrusive for a local dev tool and blocks entirely on
   * machines without a usable keychain.
   */
  secretStorage: 'keyfile' | 'os';
  /** UI language. English is the default and the fallback. */
  locale: string;
  proxy: ProxySettings;
  tls: TlsSettings;
}

export interface ProxySettings {
  enabled: boolean;
  /**
   * How the proxy is reached. SOCKS5 is tunnelled by a custom connector;
   * http/https use undici's own proxy support.
   */
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  /** Send requests for these protocols through the proxy. */
  forHttp: boolean;
  forHttps: boolean;
  auth: { enabled: boolean; username: string; password: string };
  /**
   * Hosts that bypass the proxy. Supports exact names and leading wildcards,
   * e.g. `localhost`, `127.0.0.1`, `*.internal`.
   */
  bypass: string[];
}

export interface ClientCertificate {
  id: string;
  /** Host this certificate applies to, e.g. `api.example.com` or `*.example.com`. */
  host: string;
  /** PEM certificate and key, or a PKCS#12 bundle. */
  certPath: string;
  keyPath: string;
  pfxPath: string;
  passphrase: string;
}

export interface TlsSettings {
  /** Off is the equivalent of Postman's "SSL certificate verification". */
  verify: boolean;
  /** Extra CA bundle in PEM form, for private roots. */
  caPath: string;
  certificates: ClientCertificate[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultTimeoutMs: 30_000,
  wrapResponses: true,
  fontSize: 13,
  keepHistory: true,
  secretStorage: 'keyfile',
  locale: 'en',
  proxy: {
    enabled: false,
    protocol: 'http',
    host: '',
    port: 8080,
    forHttp: true,
    forHttps: true,
    auth: { enabled: false, username: '', password: '' },
    bypass: ['localhost', '127.0.0.1', '::1'],
  },
  tls: {
    verify: true,
    caPath: '',
    certificates: [],
  },
};

/** True when `host` matches a bypass entry, honouring a leading `*.`. */
export function isBypassed(host: string, bypass: string[]): boolean {
  const target = host.toLowerCase();
  return bypass.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return target.endsWith(suffix) || target === pattern.slice(2);
    }
    return target === pattern;
  });
}

/** Picks the client certificate configured for a host, if any. */
export function certificateFor(
  host: string,
  certificates: ClientCertificate[],
): ClientCertificate | undefined {
  const target = host.toLowerCase();
  // An exact host wins over a wildcard, so a specific override is respected.
  return (
    certificates.find((c) => c.host.trim().toLowerCase() === target) ??
    certificates.find((c) => {
      const pattern = c.host.trim().toLowerCase();
      return pattern.startsWith('*.') && target.endsWith(pattern.slice(1));
    })
  );
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(PATHS.settings, {});
  // Merged over the defaults so a settings file written by an older build never
  // leaves a field undefined. Proxy and TLS need a nested merge for the same
  // reason — a file from before they existed has neither.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    proxy: { ...DEFAULT_SETTINGS.proxy, ...stored.proxy, auth: { ...DEFAULT_SETTINGS.proxy.auth, ...stored.proxy?.auth } },
    tls: { ...DEFAULT_SETTINGS.tls, ...stored.tls },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await loadSettings()), ...patch };
  await writeJson(PATHS.settings, merged);
  return merged;
}
