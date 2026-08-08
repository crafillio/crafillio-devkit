/**
 * OpenAPI 3.x and Swagger 2.0 import.
 *
 * Turns a specification into a browsable collection: one folder per tag, one
 * request per operation, with path and query parameters filled in as
 * `{{variables}}` and a request body generated from the schema so the request
 * is runnable rather than an empty shell.
 */

import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type {
  Auth,
  Collection,
  Folder,
  HttpMethod,
  KeyValue,
  RestBody,
  RestRequest,
  SavedRequest,
} from '../types.js';

/* The parts of the spec we read, narrowed. */
interface SpecParameter {
  name?: string;
  in?: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  example?: unknown;
  schema?: SpecSchema;
  $ref?: string;
}

interface SpecSchema {
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  items?: SpecSchema;
  properties?: Record<string, SpecSchema>;
  required?: string[];
  allOf?: SpecSchema[];
  oneOf?: SpecSchema[];
  anyOf?: SpecSchema[];
  $ref?: string;
  nullable?: boolean;
}

interface SpecOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: SpecParameter[];
  requestBody?: {
    $ref?: string;
    content?: Record<string, { schema?: SpecSchema; example?: unknown }>;
  };
  /** Swagger 2.0 keeps the body among the parameters instead. */
  consumes?: string[];
  security?: Array<Record<string, string[]>>;
}

interface Spec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url?: string; variables?: Record<string, { default?: string }> }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, SpecOperation> & { parameters?: SpecParameter[] }>;
  components?: {
    schemas?: Record<string, SpecSchema>;
    parameters?: Record<string, SpecParameter>;
    requestBodies?: Record<string, NonNullable<SpecOperation['requestBody']>>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  definitions?: Record<string, SpecSchema>;
  securityDefinitions?: Record<string, SecurityScheme>;
  security?: Array<Record<string, string[]>>;
}

interface SecurityScheme {
  type?: string;
  scheme?: string;
  in?: string;
  name?: string;
  flows?: unknown;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

let seq = 0;
function row(key: string, value: string, enabled = true): KeyValue {
  seq += 1;
  return { id: `oa${seq}`, key, value, enabled };
}

/** Follows a local `$ref` such as `#/components/schemas/Pet`. */
function resolveRef<T>(spec: Spec, ref: string): T | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = spec;
  for (const part of ref.slice(2).split('/')) {
    if (node === null || typeof node !== 'object') return undefined;
    // JSON Pointer escapes; rare in practice but cheap to honour.
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Record<string, unknown>)[key];
  }
  return node as T;
}

function deref<T extends { $ref?: string }>(spec: Spec, node: T | undefined, depth = 0): T | undefined {
  if (!node || depth > 8) return node;
  if (node.$ref) {
    const target = resolveRef<T>(spec, node.$ref);
    // A ref chain can legitimately point at another ref.
    return target ? deref(spec, target, depth + 1) : undefined;
  }
  return node;
}

/** Builds a representative value for a schema, for a runnable request body. */
function sampleFor(spec: Spec, schema: SpecSchema | undefined, depth = 0): unknown {
  const resolved = deref(spec, schema, 0);
  if (!resolved || depth > 6) return null;

  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.enum?.length) return resolved.enum[0];

  // Composition keywords: merge the branches we can, then take the first.
  if (resolved.allOf?.length) {
    const merged: Record<string, unknown> = {};
    for (const part of resolved.allOf) {
      const value = sampleFor(spec, part, depth + 1);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(merged, value);
      }
    }
    return merged;
  }
  if (resolved.oneOf?.length) return sampleFor(spec, resolved.oneOf[0], depth + 1);
  if (resolved.anyOf?.length) return sampleFor(spec, resolved.anyOf[0], depth + 1);

  switch (resolved.type) {
    case 'array':
      return [sampleFor(spec, resolved.items, depth + 1)];
    case 'object':
    case undefined: {
      if (!resolved.properties) return {};
      const out: Record<string, unknown> = {};
      for (const [name, property] of Object.entries(resolved.properties)) {
        out[name] = sampleFor(spec, property, depth + 1);
      }
      return out;
    }
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      // Formats carry more meaning than the bare "string" type.
      switch (resolved.format) {
        case 'date-time':
          return new Date().toISOString();
        case 'date':
          return new Date().toISOString().slice(0, 10);
        case 'uuid':
          return '00000000-0000-0000-0000-000000000000';
        case 'email':
          return 'user@example.com';
        case 'uri':
        case 'url':
          return 'https://example.com';
        case 'binary':
          return '';
        default:
          return '';
      }
  }
}

/** A placeholder for a parameter: its example, else a `{{variable}}`. */
function parameterValue(spec: Spec, parameter: SpecParameter): string {
  if (parameter.example !== undefined) return String(parameter.example);
  const schema = deref(spec, parameter.schema);
  if (schema?.example !== undefined) return String(schema.example);
  if (schema?.default !== undefined) return String(schema.default);
  if (schema?.enum?.length) return String(schema.enum[0]);
  // Left as a variable so the whole collection can be driven from an
  // environment rather than edited request by request.
  return `{{${parameter.name ?? 'value'}}}`;
}

/** The server URL, with any templated variables filled from their defaults. */
function baseUrl(spec: Spec): string {
  if (spec.servers?.length) {
    const server = spec.servers[0]!;
    let url = server.url ?? '';
    for (const [name, variable] of Object.entries(server.variables ?? {})) {
      url = url.replace(`{${name}}`, variable.default ?? `{{${name}}}`);
    }
    return url.replace(/\/$/, '');
  }
  // Swagger 2.0.
  if (spec.host) {
    const scheme = spec.schemes?.[0] ?? 'https';
    return `${scheme}://${spec.host}${spec.basePath ?? ''}`.replace(/\/$/, '');
  }
  return '{{baseUrl}}';
}

function authFor(spec: Spec, operation: SpecOperation): Auth {
  const requirement = operation.security?.[0] ?? spec.security?.[0];
  if (!requirement) return { kind: 'none' };

  const schemeName = Object.keys(requirement)[0];
  if (!schemeName) return { kind: 'none' };

  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const scheme = schemes[schemeName];
  if (!scheme) return { kind: 'none' };

  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    return { kind: 'basic', username: '{{username}}', password: '{{password}}' };
  }
  if (scheme.type === 'http' || scheme.type === 'oauth2') {
    return { kind: 'bearer', token: '{{token}}' };
  }
  if (scheme.type === 'apiKey' && scheme.name) {
    return {
      kind: 'apiKey',
      key: scheme.name,
      value: `{{${schemeName}}}`,
      in: scheme.in === 'query' ? 'query' : 'header',
    };
  }
  return { kind: 'none' };
}

function bodyFor(spec: Spec, operation: SpecOperation, parameters: SpecParameter[]): RestBody {
  // Swagger 2.0: the body arrives as a parameter with `in: body`.
  const bodyParameter = parameters.find((p) => (p as { in?: string }).in === 'body');
  if (bodyParameter) {
    const sample = sampleFor(spec, bodyParameter.schema);
    return { kind: 'json', text: JSON.stringify(sample, null, 2) };
  }

  const requestBody = deref(spec, operation.requestBody);
  const content = requestBody?.content;
  if (!content) return { kind: 'none' };

  const jsonType = Object.keys(content).find((t) => /json/i.test(t));
  if (jsonType) {
    const entry = content[jsonType]!;
    const sample = entry.example ?? sampleFor(spec, entry.schema);
    return { kind: 'json', text: JSON.stringify(sample, null, 2) };
  }

  const formType = Object.keys(content).find((t) => /x-www-form-urlencoded/i.test(t));
  if (formType) {
    const schema = deref(spec, content[formType]!.schema);
    const fields = Object.entries(schema?.properties ?? {}).map(([name]) =>
      row(name, `{{${name}}}`),
    );
    return { kind: 'form', fields };
  }

  const multipartType = Object.keys(content).find((t) => /multipart/i.test(t));
  if (multipartType) {
    const schema = deref(spec, content[multipartType]!.schema);
    const fields = Object.entries(schema?.properties ?? {}).map(([name, property]) => {
      seq += 1;
      const resolved = deref(spec, property);
      const isFile = resolved?.format === 'binary' || resolved?.format === 'byte';
      return {
        id: `oa${seq}`,
        key: name,
        enabled: true,
        type: isFile ? ('file' as const) : ('text' as const),
        value: isFile ? '' : `{{${name}}}`,
      };
    });
    return { kind: 'multipart', fields };
  }

  const textType = Object.keys(content)[0]!;
  return { kind: 'text', text: '', contentType: textType };
}

export interface OpenApiImportResult {
  collection: Collection;
  /** Suggested environment variables — the server URL and any path params. */
  variables: Array<{ key: string; value: string }>;
  requestCount: number;
  /** Operations we could not turn into a request, with the reason. */
  skipped: string[];
}

/** Parses an OpenAPI 3.x or Swagger 2.0 document in JSON or YAML. */
export function importOpenApi(source: string): OpenApiImportResult {
  let spec: Spec;
  const trimmed = source.trim();
  try {
    // YAML is a superset of JSON, so one parser covers both — but a JSON
    // syntax error reads far better from JSON.parse.
    spec = trimmed.startsWith('{') ? (JSON.parse(trimmed) as Spec) : (parseYaml(trimmed) as Spec);
  } catch (err) {
    throw new Error(`Could not parse the specification: ${(err as Error).message}`);
  }

  if (!spec || (!spec.openapi && !spec.swagger)) {
    throw new Error(
      'That file is not an OpenAPI or Swagger document — no "openapi" or "swagger" version field.',
    );
  }
  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    throw new Error('The specification declares no paths, so there is nothing to import.');
  }

  const now = new Date().toISOString();
  const base = baseUrl(spec);
  const folders: Folder[] = [];
  const requests: SavedRequest[] = [];
  const skipped: string[] = [];
  const pathVariables = new Set<string>();

  const folderFor = (tag: string): string => {
    const existing = folders.find((f) => f.name === tag);
    if (existing) return existing.id;
    const folder: Folder = { id: randomUUID(), name: tag, parentId: null };
    folders.push(folder);
    return folder.id;
  };

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const sharedParameters = (pathItem.parameters ?? [])
      .map((p) => deref(spec, p))
      .filter((p): p is SpecParameter => Boolean(p));

    for (const [rawMethod, operation] of Object.entries(pathItem)) {
      const method = rawMethod.toUpperCase() as HttpMethod;
      if (!METHODS.includes(method)) continue;
      if (!operation || typeof operation !== 'object') continue;

      const op = operation as SpecOperation;
      const parameters = [
        ...sharedParameters,
        ...(op.parameters ?? []).map((p) => deref(spec, p)).filter((p): p is SpecParameter => Boolean(p)),
      ];

      // Path parameters become variables so one environment drives them all.
      let url = `${base}${path}`;
      for (const parameter of parameters.filter((p) => p.in === 'path')) {
        if (!parameter.name) continue;
        pathVariables.add(parameter.name);
        url = url.replace(`{${parameter.name}}`, `{{${parameter.name}}}`);
      }

      const query = parameters
        .filter((p) => p.in === 'query' && p.name)
        .map((p) => row(p.name!, parameterValue(spec, p), p.required !== false));

      const headers = parameters
        .filter((p) => p.in === 'header' && p.name)
        // Content-Type comes from the body kind; duplicating it causes conflicts.
        .filter((p) => !/^content-type$/i.test(p.name!))
        .map((p) => row(p.name!, parameterValue(spec, p), p.required === true));

      const name =
        op.summary?.trim() ||
        op.operationId?.trim() ||
        `${method} ${path}`;

      const request: RestRequest = {
        method,
        url,
        headers,
        query,
        body: bodyFor(spec, op, parameters),
        auth: authFor(spec, op),
        timeoutMs: 30_000,
        followRedirects: true,
        maxRedirects: 5,
        insecureTls: false,
      };

      requests.push({
        id: randomUUID(),
        name,
        protocol: 'rest',
        folderId: op.tags?.[0] ? folderFor(op.tags[0]) : null,
        rest: request,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (requests.length === 0) {
    throw new Error('No operations were found in that specification.');
  }

  const variables: Array<{ key: string; value: string }> = [];
  if (base.includes('{{baseUrl}}')) variables.push({ key: 'baseUrl', value: '' });
  for (const name of pathVariables) variables.push({ key: name, value: '' });

  return {
    collection: {
      id: randomUUID(),
      name: spec.info?.title?.trim() || 'Imported API',
      folders,
      requests,
      createdAt: now,
      updatedAt: now,
    },
    variables,
    requestCount: requests.length,
    skipped,
  };
}
