/**
 * Path extraction for pulling values out of a JSON response.
 *
 * Supports the notation people actually type: `data.items[0].id`,
 * `items[-1].name` (last element), and bracketed keys for awkward names such
 * as `headers["content-type"]`.
 */

export type PathSegment = { kind: 'key'; key: string } | { kind: 'index'; index: number };

export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;

  while (i < path.length) {
    if (path[i] === '.') {
      i++;
      continue;
    }

    if (path[i] === '[') {
      const close = path.indexOf(']', i);
      if (close === -1) throw new Error(`Unclosed "[" in path: ${path}`);
      const inner = path.slice(i + 1, close).trim();

      // Quoted keys sidestep names containing dots or dashes.
      if (/^["'].*["']$/.test(inner)) {
        segments.push({ kind: 'key', key: inner.slice(1, -1) });
      } else if (/^-?\d+$/.test(inner)) {
        segments.push({ kind: 'index', index: Number(inner) });
      } else {
        segments.push({ kind: 'key', key: inner });
      }
      i = close + 1;
      continue;
    }

    let end = i;
    while (end < path.length && path[end] !== '.' && path[end] !== '[') end++;
    const key = path.slice(i, end).trim();
    if (key) segments.push({ kind: 'key', key });
    i = end;
  }

  return segments;
}

/**
 * Walks `path` into `value`. Returns undefined when any segment is missing,
 * rather than throwing — a missing field is a normal outcome that the caller
 * reports against the binding.
 */
export function getPath(value: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '$') return value;

  // Tolerate a leading `$.` for people used to JSONPath.
  const segments = parsePath(trimmed.replace(/^\$\.?/, ''));
  let current: unknown = value;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return undefined;
      // A negative index counts back from the end, so `[-1]` is "the latest".
      const index = segment.index < 0 ? current.length + segment.index : segment.index;
      current = current[index];
    } else {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment.key];
    }
  }

  return current;
}

/** Renders an extracted value for use in a request or for display. */
export function stringifyValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Objects and arrays go in as compact JSON so they can be embedded in a body.
  return JSON.stringify(value);
}

/** Suggests extractable paths from a response body, to populate the UI. */
export function suggestPaths(body: unknown, limit = 60): string[] {
  const found: string[] = [];

  const walk = (node: unknown, prefix: string, depth: number): void => {
    if (found.length >= limit || depth > 4) return;

    if (Array.isArray(node)) {
      // One representative element is enough; listing every index is noise.
      if (node.length > 0) walk(node[0], `${prefix}[0]`, depth + 1);
      return;
    }

    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (found.length >= limit) return;
        const path = prefix ? `${prefix}.${key}` : key;
        const isLeaf = value === null || typeof value !== 'object';
        if (isLeaf) found.push(path);
        else walk(value, path, depth + 1);
      }
      return;
    }

    if (prefix) found.push(prefix);
  };

  walk(body, '', 0);
  return found;
}
