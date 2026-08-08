import * as grpc from '@grpc/grpc-js';
import type { GrpcTarget } from '../types.js';

/** grpc-js accepts `rejectUnauthorized` but does not surface it on the public type. */
type VerifyOptions = grpc.VerifyOptions & { rejectUnauthorized?: boolean };

export function credentialsFor(target: GrpcTarget): grpc.ChannelCredentials {
  if (!target.tls) return grpc.credentials.createInsecure();

  if (target.insecureTls) {
    const verify: VerifyOptions = {
      rejectUnauthorized: false,
      // Suppresses hostname mismatch on top of chain verification.
      checkServerIdentity: () => undefined,
    };
    return grpc.credentials.createSsl(null, null, null, verify);
  }

  return grpc.credentials.createSsl();
}

export function channelOptionsFor(target: GrpcTarget): grpc.ChannelOptions {
  const options: grpc.ChannelOptions = {
    // Proto payloads in a dev tool are routinely larger than the 4MB default.
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
  };
  if (target.serverNameOverride) {
    options['grpc.ssl_target_name_override'] = target.serverNameOverride;
  }
  return options;
}

/** Strips any scheme a user pasted in — grpc-js wants a bare `host:port`. */
export function normalizeAddress(address: string): string {
  return address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
}

const STATUS_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(grpc.status)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => [v as number, k]),
);

export function statusName(code: number): string {
  return STATUS_NAMES[code] ?? `CODE_${code}`;
}
