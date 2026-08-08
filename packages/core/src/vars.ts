/**
 * `{{variable}}` interpolation.
 *
 * Applied to a request just before it is sent, never to what gets saved — the
 * collection on disk keeps the placeholders so it stays portable between
 * environments.
 */

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export interface InterpolationResult<T> {
  value: T;
  /** Names referenced by the request that the active environment does not define. */
  missing: string[];
}

function interpolateString(input: string, vars: Record<string, string>, missing: Set<string>): string {
  return input.replace(TOKEN, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]!;
    missing.add(name);
    // Leaving the token intact makes the failure visible in the request that
    // actually went out, rather than sending an empty string.
    return match;
  });
}

/**
 * Walks any JSON-ish structure and interpolates every string it contains.
 */
export function interpolate<T>(input: T, vars: Record<string, string>): InterpolationResult<T> {
  const missing = new Set<string>();

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return interpolateString(node, vars, missing);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) out[key] = walk(value);
      return out;
    }
    return node;
  };

  return { value: walk(input) as T, missing: [...missing] };
}

/** Lists the variable names a value references, for highlighting in the UI. */
export function referencedVariables(input: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(TOKEN)) found.add(match[1]!);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };
  walk(input);
  return [...found];
}
