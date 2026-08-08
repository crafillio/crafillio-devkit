# Crafillio DevKit 1.0.0

**One desktop app for REST, gRPC, S3 — and load testing.** Offline-first, MIT licensed, no account
and no telemetry.

## Highlights

**Four tools, one window.** REST, gRPC and S3 share a single tab strip, one set of environment
variables and one collection format. Load testing is a tab on any request, not a separate product.

**gRPC that actually knows your schema.** Discovery via server reflection (`v1`, falling back to
`v1alpha`) or local `.proto` files, unified onto a single protobuf.js root. Request editors are
prefilled from the schema — nested messages, enums as names, `int64` as strings so nothing is lost
through JSON. All four call types, with streaming responses on a timestamped timeline.

**S3 metadata editing that doesn't lose your headers.** S3 has no in-place metadata update; the only
mechanism replaces the entire metadata set and silently drops system headers you don't resend.
Crafillio DevKit reads the object first and passes through everything you didn't change.

**Load testing with honest numbers.** Duration or iteration runs, ramp-up, an optional RPS ceiling
and an error-rate circuit breaker. Percentiles come from a reservoir sample, so long runs keep flat
memory without discarding the tail. A 4xx/5xx counts as a failure — reporting it as success would
hide a broken target.

**Bring your existing work.** Postman Collection v2.1 import with folders, auth, bodies and
variables. Paste a curl command from devtools, or copy any request back out as one.

**No keychain prompts.** Secrets are encrypted with a local AES-256-GCM key file (mode `0600`) by
default, so nothing ever raises an OS password dialog. The OS keychain remains available in About
for anyone who wants the stronger guarantee.

**Designed, not defaulted.** Space Grotesk, Inter Tight and JetBrains Mono — bundled locally, so the
app works with no network. Dark and light themes are fully tokenised, and every text tier clears
WCAG AA contrast in both.

## Install

Download the installer for your platform below, or build from source:

```bash
git clone https://github.com/crafillio/crafillio-devkit.git
cd crafillio-devkit
npm install
npm start
```

macOS builds are currently unsigned. Right-click → Open the first time, or run
`xattr -dr com.apple.quarantine "/Applications/Crafillio DevKit.app"`.

## Verification

165 integration assertions run against real servers — a live HTTP server, a real gRPC server with
reflection enabled, and an S3-compatible server. Not mocks.

```
REST:       19      Interop:  37
gRPC:       31      Perf:     29
S3:         24      Keyfile:  11
Store/vars: 14      ───────────────
                    165 total
```

Shipped dependencies carry **0 known vulnerabilities** and **no copyleft licences**
(`npm run audit`, `npm run licenses`). Remaining advisories are confined to `s3rver`, a test-only
S3 double that is never bundled.

## Known limitations

- **Load testing covers unary gRPC only.** Requests-per-second has no meaning for a stream, so
  streaming methods are rejected rather than mis-measured.
- **macOS and Windows builds are unsigned.** Code-signing certificates are not yet set up.
- **No request scripting or assertions yet.** Pre-request scripts and response tests are the most
  requested Postman feature still missing.
- **No WebSocket, SSE or OAuth 2 flows.**
- **No collection sync** — deliberately. There is no server to sync to.

## Data

Everything lives in `~/.crafillio`: collections as one JSON file each, plus environments,
connections, history and settings. Nothing is uploaded. Nothing is shared unless you hand someone
the file.

---

MIT © 2026 [Amit Singh](https://crafillio.com)
