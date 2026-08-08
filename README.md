<div align="center">

# Crafillio DevKit

**One desktop app for REST, gRPC, S3 — and load testing.**
Offline-first. No telemetry. No account. MIT licensed.

by [Amit Singh](https://crafillio.com)

</div>

---

Most teams keep three tools open: one for HTTP, one for gRPC, and a browser tab for buckets. Then a
fourth when someone asks "but how fast is it?". Crafillio DevKit puts all four behind one tab strip,
one set of environment variables, and one collection format — and it never sends your data anywhere.

## Features

### REST

- Every method, with query params, headers and per-row enable/disable
- Bodies: JSON, raw text, URL-encoded form, multipart (with file parts), raw binary
- Auth: bearer, basic, API key (header or query)
- Redirects followed manually, so you see the **whole hop chain** — not just the final response
- Timing split into total and time-to-first-byte, plus decompressed size
- Binary responses detected, not mangled into replacement characters

### gRPC

- Discovery via **server reflection** (`v1`, falling back to `v1alpha`) or local `.proto` files
- All four call types: unary, server-streaming, client-streaming, bidirectional
- Request editors **prefilled from the schema** — nested messages, enums as names, `int64` as
  strings so nothing is lost through JSON
- Streaming responses render as a timeline with per-message timestamps
- Custom metadata including `-bin` keys, deadlines, TLS with optional SNI override

### S3

Works with AWS and any S3-compatible gateway (MinIO, Ceph, Cloudflare R2, Wasabi) via a custom
endpoint and path-style addressing.

- Browse buckets and objects with `/` treated as folders
- **Upload** (multipart with progress), **download**, inline text writes
- **Delete** a single object, a multi-select batch, or a whole prefix recursively
- **Edit metadata** — user `x-amz-meta-*` pairs plus Content-Type and Cache-Control
- Copy presigned URLs to share an object without handing over credentials

> S3 has no in-place metadata update. The only mechanism is copying the object onto itself with
> `MetadataDirective: REPLACE`, which replaces the *entire* metadata set and silently drops any
> system header you don't resend. Crafillio DevKit reads the object first and passes through
> everything you didn't change, so editing one field never quietly erases your Content-Type.

### Load testing

Point it at any REST endpoint or unary gRPC method:

- Duration or fixed-iteration runs, adjustable concurrency and ramp-up
- Optional RPS ceiling for steady-state testing, and an error-rate circuit breaker
- Live chart of throughput, p95 latency and errors while the run is in flight
- Full percentile spread (p50/p75/p90/p95/p99), status-code and error breakdown
- CSV export of the per-second series

Percentiles come from a reservoir sample, so a long run keeps flat memory without discarding the
tail — which is exactly where the interesting latency lives.

### Across everything

- **Environments** with `{{variable}}` interpolation anywhere in a request. Collections store the
  placeholder, never the value, so they stay safe to commit and share.
- Undefined variables are reported, not silently replaced with an empty string
- **Import from Postman** (Collection v2.1) — folders, auth, bodies and variables
- **Import and export curl** — paste from devtools, or copy any request back out
- Collections are one JSON file each under `~/.crafillio/collections` — diffable, git-committable,
  portable by handing someone the file

## Privacy

Crafillio DevKit initiates **no network connection of its own**. No telemetry, no analytics, no
crash reporting, no update check. The only traffic is the requests you ask it to make.

The renderer runs under `default-src 'none'` with `connect-src 'self'`, so page code cannot reach
the network even if it wanted to — all protocol work happens in the main process. Fonts are bundled,
not fetched.

### Secrets

Values marked **secret** are encrypted before they touch disk. Two backends, switchable in **About**:

| Backend | Prompts? | Notes |
| --- | --- | --- |
| **Local key file** (default) | Never | AES-256-GCM with a key at `~/.crafillio/secret.key`, mode `0600` |
| OS keychain | Yes, once | Stronger, but macOS shows a keychain dialog and some machines have no usable keychain |

The key file is the default because a local dev tool should not interrupt you with a system password
dialog. The honest trade-off: the key sits beside the data, so anyone who can read your home folder
can read your secrets. It defends against the realistic accidents — a committed config, a synced
folder, a shared backup, an exported collection — not against someone already on your account. If
you want the stronger guarantee, switch to the keychain in About.

## Getting started

```bash
npm install
npm start
```

Development, with hot reload for the UI:

```bash
npm run dev
```

Package installers for the current platform:

```bash
npm run dist
```

Run everything CI runs — typecheck, tests, licence audit, vulnerability audit:

```bash
npm run verify
```

## Tests

The engines are covered by integration tests that run against **real servers, not mocks** — a live
HTTP server, a real gRPC server with reflection enabled, and an S3-compatible server:

```bash
npm test
```

```
REST:       19 passed      Interop:  37 passed
gRPC:       31 passed      Perf:     29 passed
S3:         24 passed      Keyfile:  11 passed
Store/vars: 14 passed
                           165 total
```

## Architecture

```
packages/core     Protocol engines + storage. Zero Electron imports.
  protocols/      rest · grpc · grpc-schema · grpc-reflection · s3
  perf/           load generator, reservoir-sampled latency stats
  interop/        curl and Postman import/export
  store/          collections · environments · connections · history · settings
                  secrets (pluggable backends) · keyfile (AES-256-GCM)

packages/ui       React renderer (Vite). Talks only to window.crafillio.

apps/desktop      Electron shell.
  src/api.ts      The IPC contract — imported by preload, main and the UI, so
                  the three can never drift apart
  src/main.ts     Privileged side: engines, disk, encryption
  src/preload.ts  Context-isolated bridge, no logic
```

Two deliberate choices:

**`@crafillio/core` imports nothing from Electron.** Every engine is plain Node, so the shell is
replaceable — a Tauri or CLI front end could sit on the same engines untouched.

**The main process is bundled with esbuild** rather than shipping `node_modules`. The whole backend —
grpc-js, the AWS SDK, undici, protobuf.js — compiles to a single ~1.5 MB file, which also sidesteps
npm workspace hoisting that electron-builder handles poorly.

## Design

Typeset in [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) (display and figures),
[Inter Tight](https://fonts.google.com/specimen/Inter+Tight) (interface) and
[JetBrains Mono](https://www.jetbrains.com/lp/mono/) (code) — all OFL-1.1, bundled locally.

Dark and light themes are fully tokenised; no component contains a hardcoded colour. Every text
tier clears WCAG AA (4.5:1) in both schemes.

## Security

```bash
npm run audit      # vulnerabilities in shipped dependencies
npm run licenses   # dependency licence audit
```

Shipped dependencies carry **0 known vulnerabilities**, and no dependency is copyleft. The remaining
advisories are confined to `s3rver`, a test-only S3 double that is never bundled.

## Contributing

Issues and pull requests are welcome. Please run `npm run verify` before opening a PR.

## Licence

[MIT](LICENSE) © 2026 Amit Singh. Bundled fonts are OFL-1.1 — see [NOTICE](NOTICE).
