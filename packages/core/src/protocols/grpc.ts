/**
 * gRPC invocation. Every call type — unary, server-stream, client-stream and
 * bidi — reports progress through the same `GrpcEvent` callback, so the UI
 * renders one timeline regardless of which it is.
 */

import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';
import type {
  GrpcEvent,
  GrpcRequest,
  GrpcServiceDescriptor,
  GrpcSource,
  GrpcTarget,
} from '../types.js';
import { describeRoot, findMethod, loadRoot, clearSchemaCache } from './grpc-schema.js';
import { channelOptionsFor, credentialsFor, normalizeAddress, statusName } from './grpc-target.js';

export { clearSchemaCache };

/** Lists the services reachable through a source, for the sidebar. */
export async function describeGrpc(
  source: GrpcSource,
  target: GrpcTarget,
  refresh = false,
): Promise<GrpcServiceDescriptor[]> {
  const root = await loadRoot(source, { ...target, address: normalizeAddress(target.address) }, { refresh });
  return describeRoot(root);
}

/** Converts JSON returned by the wire into something safe to `JSON.stringify`. */
const TO_OBJECT_OPTIONS: protobuf.IConversionOptions = {
  // Enum names and stringified 64-bit ints survive a JSON round trip; raw
  // numbers and Longs do not.
  enums: String,
  longs: String,
  bytes: String,
  defaults: true,
  arrays: true,
  objects: true,
  oneofs: true,
};

function codecFor(method: protobuf.Method) {
  const requestType = method.resolvedRequestType!;
  const responseType = method.resolvedResponseType!;

  const serialize = (obj: unknown): Buffer => {
    const err = requestType.verify(obj as object);
    if (err) throw new Error(`Request does not match ${requestType.fullName}: ${err}`);
    return Buffer.from(requestType.encode(requestType.fromObject(obj as object)).finish());
  };

  const deserialize = (buf: Buffer): Record<string, unknown> =>
    responseType.toObject(responseType.decode(buf), TO_OBJECT_OPTIONS) as Record<string, unknown>;

  return { serialize, deserialize };
}

function parseMessages(messages: string[]): unknown[] {
  if (messages.length === 0) return [{}];
  return messages.map((text, i) => {
    const trimmed = text.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Message ${i + 1} is not valid JSON: ${(err as Error).message}`);
    }
  });
}

function buildMetadata(rows: GrpcRequest['metadata']): grpc.Metadata {
  const md = new grpc.Metadata();
  for (const row of rows) {
    if (!row.enabled || !row.key.trim()) continue;
    const key = row.key.toLowerCase();
    // `-bin` keys must be given as Buffers; grpc-js rejects strings for them.
    if (key.endsWith('-bin')) md.add(key, Buffer.from(row.value, 'base64'));
    else md.add(key, row.value);
  }
  return md;
}

function flattenMetadata(md: grpc.Metadata | undefined): Record<string, string> {
  if (!md) return {};
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(md.getMap())) {
    out[key] = Array.isArray(values) ? values.join(', ') : String(values);
  }
  return out;
}

/**
 * Builds a reusable unary caller over a single channel.
 *
 * Load testing must not pay channel setup on every request — that would measure
 * connection establishment rather than the server. One client is created here
 * and every invocation multiplexes over it, which is how a real gRPC client
 * behaves.
 */
export async function createUnaryInvoker(req: GrpcRequest): Promise<{
  invoke(): Promise<{ statusName: string; message: Record<string, unknown> | null }>;
  close(): void;
}> {
  const target: GrpcTarget = { ...req.target, address: normalizeAddress(req.target.address) };
  if (!target.address) throw new Error('No server address given.');

  const root = await loadRoot(req.source, target);
  const method = findMethod(root, req.service, req.method);

  if (method.requestStream || method.responseStream) {
    throw new Error(
      `${req.service}/${req.method} is a streaming method. ` +
        'Load testing measures requests per second, which only applies to unary calls.',
    );
  }

  const { serialize, deserialize } = codecFor(method);
  const path = `/${req.service}/${req.method}`;
  const payload = parseMessages(req.messages)[0];
  const metadata = buildMetadata(req.metadata);
  const client = new grpc.Client(target.address, credentialsFor(target), channelOptionsFor(target));

  return {
    invoke: () =>
      new Promise((resolve, reject) => {
        const options: grpc.CallOptions = {};
        if (req.timeoutMs > 0) options.deadline = Date.now() + req.timeoutMs;

        client.makeUnaryRequest(
          path,
          serialize,
          deserialize,
          payload,
          metadata,
          options,
          (err, value) => {
            if (err) {
              const svc = err as grpc.ServiceError;
              const error = new Error(svc.details || svc.message) as Error & {
                statusName?: string;
                statusCode?: number;
              };
              error.statusName = statusName(svc.code ?? grpc.status.UNKNOWN);
              error.statusCode = svc.code ?? grpc.status.UNKNOWN;
              reject(error);
              return;
            }
            resolve({
              statusName: 'OK',
              message: (value as Record<string, unknown>) ?? null,
            });
          },
        );
      }),
    close: () => client.close(),
  };
}

/** Handle returned to the caller so an in-flight call can be cancelled. */
export interface GrpcCall {
  cancel(): void;
  done: Promise<void>;
}

/**
 * Starts a gRPC call. Events stream to `onEvent`; the returned promise settles
 * when the call is fully finished (including after an error).
 */
export async function invokeGrpc(
  req: GrpcRequest,
  onEvent: (event: GrpcEvent) => void,
): Promise<GrpcCall> {
  const target: GrpcTarget = { ...req.target, address: normalizeAddress(req.target.address) };
  if (!target.address) throw new Error('No server address given.');

  const root = await loadRoot(req.source, target);
  const method = findMethod(root, req.service, req.method);
  const { serialize, deserialize } = codecFor(method);

  const path = `/${req.service}/${req.method}`;
  const messages = parseMessages(req.messages);
  const metadata = buildMetadata(req.metadata);
  const started = process.hrtime.bigint();

  const options: grpc.CallOptions = {};
  if (req.timeoutMs > 0) options.deadline = Date.now() + req.timeoutMs;

  const client = new grpc.Client(target.address, credentialsFor(target), channelOptionsFor(target));

  let received = 0;
  let settled = false;
  const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));

  const finish = (): void => {
    if (settled) return;
    settled = true;
    client.close();
    resolveDone();
  };

  const emitStatus = (status: grpc.StatusObject): void => {
    onEvent({ type: 'trailers', metadata: flattenMetadata(status.metadata) });
    onEvent({
      type: 'status',
      code: status.code,
      codeName: statusName(status.code),
      details: status.details,
      totalMs: elapsed(),
    });
    finish();
  };

  const emitError = (err: grpc.ServiceError | Error): void => {
    const svc = err as grpc.ServiceError;
    if (typeof svc.code === 'number') {
      onEvent({
        type: 'error',
        message: svc.details || svc.message,
        code: svc.code,
        codeName: statusName(svc.code),
      });
      onEvent({
        type: 'status',
        code: svc.code,
        codeName: statusName(svc.code),
        details: svc.details || svc.message,
        totalMs: elapsed(),
      });
    } else {
      onEvent({ type: 'error', message: err.message });
    }
    finish();
  };

  const onData = (msg: Record<string, unknown>): void => {
    onEvent({
      type: 'message',
      index: received++,
      json: JSON.stringify(msg, null, 2),
      atMs: elapsed(),
    });
  };

  const callType = method.requestStream
    ? method.responseStream
      ? 'bidi'
      : 'client_stream'
    : method.responseStream
      ? 'server_stream'
      : 'unary';

  let call: { cancel(): void };

  switch (callType) {
    case 'unary': {
      const unary = client.makeUnaryRequest(
        path,
        serialize,
        deserialize,
        messages[0],
        metadata,
        options,
        (err, value) => {
          if (err) return emitError(err);
          if (value) onData(value as Record<string, unknown>);
          emitStatus({ code: grpc.status.OK, details: 'OK', metadata: new grpc.Metadata() });
        },
      );
      unary.on('metadata', (md) => onEvent({ type: 'metadata', metadata: flattenMetadata(md) }));
      call = unary;
      break;
    }

    case 'server_stream': {
      const stream = client.makeServerStreamRequest(
        path,
        serialize,
        deserialize,
        messages[0],
        metadata,
        options,
      );
      stream.on('metadata', (md) => onEvent({ type: 'metadata', metadata: flattenMetadata(md) }));
      stream.on('data', onData);
      stream.on('error', emitError);
      stream.on('status', emitStatus);
      call = stream;
      break;
    }

    case 'client_stream': {
      const stream = client.makeClientStreamRequest(
        path,
        serialize,
        deserialize,
        metadata,
        options,
        (err, value) => {
          if (err) return emitError(err);
          if (value) onData(value as Record<string, unknown>);
          emitStatus({ code: grpc.status.OK, details: 'OK', metadata: new grpc.Metadata() });
        },
      );
      stream.on('metadata', (md) => onEvent({ type: 'metadata', metadata: flattenMetadata(md) }));
      for (const msg of messages) stream.write(msg);
      stream.end();
      call = stream;
      break;
    }

    case 'bidi': {
      const stream = client.makeBidiStreamRequest(path, serialize, deserialize, metadata, options);
      stream.on('metadata', (md) => onEvent({ type: 'metadata', metadata: flattenMetadata(md) }));
      stream.on('data', onData);
      stream.on('error', emitError);
      stream.on('status', emitStatus);
      for (const msg of messages) stream.write(msg);
      stream.end();
      call = stream;
      break;
    }
  }

  return {
    cancel: () => {
      call.cancel();
      finish();
    },
    done,
  };
}
