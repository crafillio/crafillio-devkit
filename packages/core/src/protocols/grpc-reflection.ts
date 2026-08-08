/**
 * gRPC server reflection client.
 *
 * Talks the ServerReflection bidi protocol, collects the transitive
 * FileDescriptorProtos the server hands back, and rebuilds them into a
 * protobuf.js Root — the same shape `grpc-schema` produces from .proto files,
 * so invocation downstream has a single code path.
 */

import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';
// Side-effectful: teaches protobuf.Root about fromDescriptor/toDescriptor.
import descriptorExt from 'protobufjs/ext/descriptor/index.js';
import type { GrpcTarget } from '../types.js';
import { credentialsFor, channelOptionsFor } from './grpc-target.js';

/** The reflection service definition, held inline so API Devkit ships no .proto assets. */
const REFLECTION_PROTO = `
syntax = "proto3";
package __PKG__;

service ServerReflection {
  rpc ServerReflectionInfo(stream ServerReflectionRequest)
      returns (stream ServerReflectionResponse);
}

message ServerReflectionRequest {
  string host = 1;
  oneof message_request {
    string file_by_filename = 3;
    string file_containing_symbol = 4;
    ExtensionRequest file_containing_extension = 5;
    string all_extension_numbers_of_type = 6;
    string list_services = 7;
  }
}

message ExtensionRequest {
  string containing_type = 1;
  int32 extension_number = 2;
}

message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response {
    FileDescriptorResponse file_descriptor_response = 4;
    ExtensionNumberResponse all_extension_numbers_response = 5;
    ListServiceResponse list_services_response = 6;
    ErrorResponse error_response = 7;
  }
}

message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }
message ExtensionNumberResponse {
  string base_type_name = 1;
  repeated int32 extension_number = 2;
}
message ListServiceResponse { repeated ServiceResponse service = 1; }
message ServiceResponse { string name = 1; }
message ErrorResponse {
  int32 error_code = 1;
  string error_message = 2;
}
`;

/** Reflection moved packages between gRPC releases; we try the new one first. */
const VERSIONS = ['grpc.reflection.v1', 'grpc.reflection.v1alpha'] as const;

interface ReflectionTypes {
  request: protobuf.Type;
  response: protobuf.Type;
}

function reflectionTypes(pkg: string): ReflectionTypes {
  const root = protobuf.parse(REFLECTION_PROTO.replace('__PKG__', pkg), {
    keepCase: true,
  }).root;
  return {
    request: root.lookupType(`${pkg}.ServerReflectionRequest`),
    response: root.lookupType(`${pkg}.ServerReflectionResponse`),
  };
}

/** A bidi stream turned into a request/response pump, since reflection replies in order. */
class ReflectionStream {
  private pending: Array<(value: ReflectionResponse) => void> = [];
  private buffered: ReflectionResponse[] = [];
  private failure: Error | null = null;

  constructor(private readonly call: grpc.ClientDuplexStream<unknown, ReflectionResponse>) {
    call.on('data', (msg: ReflectionResponse) => {
      const waiter = this.pending.shift();
      if (waiter) waiter(msg);
      else this.buffered.push(msg);
    });
    call.on('error', (err: Error) => {
      this.failure = err;
      // Unblock anyone waiting; `next` re-checks `failure`.
      for (const waiter of this.pending.splice(0)) waiter(null as never);
    });
    call.on('end', () => {
      this.failure ??= new Error('Reflection stream closed before a response arrived.');
      for (const waiter of this.pending.splice(0)) waiter(null as never);
    });
  }

  async ask(payload: Record<string, unknown>): Promise<ReflectionResponse> {
    if (this.failure) throw this.failure;
    this.call.write(payload);
    const msg = await new Promise<ReflectionResponse>((resolve) => {
      const buffered = this.buffered.shift();
      if (buffered) resolve(buffered);
      else this.pending.push(resolve);
    });
    if (this.failure) throw this.failure;
    return msg;
  }

  close(): void {
    this.call.end();
    this.call.cancel();
  }
}

interface ReflectionResponse {
  list_services_response?: { service?: Array<{ name: string }> };
  file_descriptor_response?: { file_descriptor_proto?: Uint8Array[] };
  error_response?: { error_code?: number; error_message?: string };
}

/**
 * Fetches every service the server exposes and returns a Root built from the
 * descriptors backing them.
 */
export async function loadRootFromReflection(
  target: GrpcTarget,
): Promise<{ root: protobuf.Root; services: string[] }> {
  let lastError: Error | undefined;

  for (const pkg of VERSIONS) {
    try {
      return await reflectOnce(target, pkg);
    } catch (err) {
      lastError = err as Error;
      // Only a missing service justifies trying the older package.
      const code = (err as grpc.ServiceError).code;
      if (code !== grpc.status.UNIMPLEMENTED && code !== grpc.status.NOT_FOUND) throw err;
    }
  }

  throw new Error(
    `Server reflection is not available on ${target.address}. ` +
      `Load .proto files instead, or enable reflection on the server. ` +
      `(${lastError?.message ?? 'unknown error'})`,
  );
}

async function reflectOnce(
  target: GrpcTarget,
  pkg: string,
): Promise<{ root: protobuf.Root; services: string[] }> {
  const types = reflectionTypes(pkg);
  const client = new grpc.Client(
    target.address,
    credentialsFor(target),
    channelOptionsFor(target),
  );

  const path = `/${pkg}.ServerReflection/ServerReflectionInfo`;
  const serialize = (obj: unknown): Buffer =>
    Buffer.from(types.request.encode(types.request.fromObject(obj as object)).finish());
  const deserialize = (buf: Buffer): ReflectionResponse =>
    types.response.toObject(types.response.decode(buf), {
      bytes: Buffer,
      defaults: false,
    }) as ReflectionResponse;

  const call = client.makeBidiStreamRequest(path, serialize, deserialize, new grpc.Metadata());
  const stream = new ReflectionStream(call as never);

  try {
    const listed = await stream.ask({ list_services: '' });
    if (listed.error_response?.error_message) {
      throw new Error(listed.error_response.error_message);
    }

    const services = (listed.list_services_response?.service ?? [])
      .map((s) => s.name)
      // The reflection service itself is machinery, not something to call.
      .filter((name) => !name.startsWith('grpc.reflection.'));

    // Keyed by descriptor bytes so transitive deps returned more than once collapse.
    const files = new Map<string, Uint8Array>();
    for (const service of services) {
      const res = await stream.ask({ file_containing_symbol: service });
      if (res.error_response?.error_message) {
        throw new Error(`Reflecting ${service}: ${res.error_response.error_message}`);
      }
      for (const bytes of res.file_descriptor_response?.file_descriptor_proto ?? []) {
        files.set(Buffer.from(bytes).toString('base64'), bytes);
      }
    }

    if (files.size === 0) {
      throw new Error(`${target.address} reported no service descriptors.`);
    }

    return { root: rootFromDescriptors([...files.values()]), services };
  } finally {
    stream.close();
    client.close();
  }
}

/** protobuf.js's descriptor extension is untyped in places; narrowed here. */
interface DescriptorExt {
  FileDescriptorProto: protobuf.Type;
  FileDescriptorSet: protobuf.Type;
}

type RootWithDescriptor = typeof protobuf.Root & {
  fromDescriptor(set: protobuf.Message | Uint8Array): protobuf.Root;
};

/** Rebuilds a Root from raw FileDescriptorProto bytes. */
export function rootFromDescriptors(fileBytes: Uint8Array[]): protobuf.Root {
  const ext = descriptorExt as unknown as DescriptorExt;

  const decoded = fileBytes.map((bytes) => ext.FileDescriptorProto.decode(bytes));
  const set = ext.FileDescriptorSet.fromObject({
    file: decoded.map((m) => ext.FileDescriptorProto.toObject(m, { defaults: false })),
  });

  return (protobuf.Root as RootWithDescriptor).fromDescriptor(set);
}
