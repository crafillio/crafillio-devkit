/**
 * Turns a gRPC source (.proto files or server reflection) into a protobuf.js
 * Root, and describes that Root for the UI.
 */

import protobuf from 'protobufjs';
import type {
  GrpcCallType,
  GrpcMethodDescriptor,
  GrpcServiceDescriptor,
  GrpcSource,
  GrpcTarget,
} from '../types.js';
import { loadRootFromReflection } from './grpc-reflection.js';

interface CachedRoot {
  root: protobuf.Root;
  loadedAt: number;
}

const rootCache = new Map<string, CachedRoot>();

function cacheKey(source: GrpcSource, target: GrpcTarget): string {
  return source.kind === 'reflection'
    ? `reflect:${target.address}:${target.tls}`
    : `proto:${source.files.join('|')}:${source.includeDirs.join('|')}`;
}

export function clearSchemaCache(): void {
  rootCache.clear();
}

export async function loadRoot(
  source: GrpcSource,
  target: GrpcTarget,
  options: { refresh?: boolean } = {},
): Promise<protobuf.Root> {
  const key = cacheKey(source, target);
  if (!options.refresh) {
    const hit = rootCache.get(key);
    if (hit) return hit.root;
  }

  const root =
    source.kind === 'reflection'
      ? (await loadRootFromReflection(target)).root
      : await loadRootFromFiles(source.files, source.includeDirs);

  rootCache.set(key, { root, loadedAt: Date.now() });
  return root;
}

async function loadRootFromFiles(
  files: string[],
  includeDirs: string[],
): Promise<protobuf.Root> {
  if (files.length === 0) throw new Error('No .proto files selected.');

  const root = new protobuf.Root();

  // Resolve imports against the user's include dirs before falling back to
  // protobuf.js's bundled google/protobuf well-known types.
  const originalResolve = root.resolvePath.bind(root);
  root.resolvePath = (origin: string, target: string): string | null => {
    for (const dir of includeDirs) {
      const candidate = protobuf.util.path.resolve(`${dir}/`, target);
      if (candidate) return candidate;
    }
    return originalResolve(origin, target);
  };

  try {
    await root.load(files, { keepCase: true });
  } catch (err) {
    throw new Error(`Could not parse .proto files: ${(err as Error).message}`);
  }

  root.resolveAll();
  return root;
}

/** Walks a Root and returns every service it defines. */
export function describeRoot(root: protobuf.Root): GrpcServiceDescriptor[] {
  const services: GrpcServiceDescriptor[] = [];

  const visit = (ns: protobuf.NamespaceBase): void => {
    for (const child of ns.nestedArray) {
      if (child instanceof protobuf.Service) {
        services.push(describeService(child));
      } else if (child instanceof protobuf.Namespace) {
        visit(child);
      }
    }
  };

  visit(root);
  services.sort((a, b) => a.name.localeCompare(b.name));
  return services;
}

function describeService(service: protobuf.Service): GrpcServiceDescriptor {
  service.resolveAll();
  const fullName = service.fullName.replace(/^\./, '');

  const methods = service.methodsArray.map((method): GrpcMethodDescriptor => {
    method.resolve();
    const callType: GrpcCallType = method.requestStream
      ? method.responseStream
        ? 'bidi'
        : 'client_stream'
      : method.responseStream
        ? 'server_stream'
        : 'unary';

    const inputType = method.resolvedRequestType;

    return {
      name: method.name,
      path: `/${fullName}/${method.name}`,
      callType,
      inputType: (method.resolvedRequestType?.fullName ?? method.requestType).replace(/^\./, ''),
      outputType: (method.resolvedResponseType?.fullName ?? method.responseType).replace(/^\./, ''),
      inputExample: inputType ? JSON.stringify(skeleton(inputType, 0), null, 2) : '{}',
    };
  });

  return { name: fullName, methods };
}

/** Placeholder values by proto scalar type, used to prefill the request editor. */
const SCALAR_PLACEHOLDERS: Record<string, unknown> = {
  double: 0,
  float: 0,
  int32: 0,
  int64: '0',
  uint32: 0,
  uint64: '0',
  sint32: 0,
  sint64: '0',
  fixed32: 0,
  fixed64: '0',
  sfixed32: 0,
  sfixed64: '0',
  bool: false,
  string: '',
  bytes: '',
};

const MAX_SKELETON_DEPTH = 4;

/** Builds a nested JSON skeleton for a message type. */
function skeleton(type: protobuf.Type, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > MAX_SKELETON_DEPTH) return out;

  for (const field of type.fieldsArray) {
    field.resolve();
    let value: unknown;

    if (field.resolvedType instanceof protobuf.Enum) {
      // Enums travel as their name in JSON; offer the zero value.
      const [first] = Object.keys(field.resolvedType.values);
      value = first ?? 0;
    } else if (field.resolvedType instanceof protobuf.Type) {
      // Self-referencing messages would recurse forever without the depth cap.
      value = skeleton(field.resolvedType, depth + 1);
    } else {
      value = SCALAR_PLACEHOLDERS[field.type] ?? null;
    }

    if (field.map) out[field.name] = {};
    else if (field.repeated) out[field.name] = [value];
    else out[field.name] = value;
  }

  return out;
}

/** Looks up a method, raising a message that names what was actually available. */
export function findMethod(
  root: protobuf.Root,
  serviceName: string,
  methodName: string,
): protobuf.Method {
  let service: protobuf.Service;
  try {
    service = root.lookupService(serviceName);
  } catch {
    const known = describeRoot(root).map((s) => s.name);
    throw new Error(
      `Service "${serviceName}" not found. Available: ${known.join(', ') || 'none'}`,
    );
  }

  service.resolveAll();
  const method = service.methods[methodName];
  if (!method) {
    const known = service.methodsArray.map((m) => m.name);
    throw new Error(
      `Method "${methodName}" not found on ${serviceName}. Available: ${known.join(', ')}`,
    );
  }
  method.resolve();
  return method;
}
