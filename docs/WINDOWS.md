# Windows SmartScreen and Defender

API Devkit is not code-signed yet, so Windows will warn about it. This page
explains exactly what you will see, how to check the download is genuine, and
what is being done about it.

## What you will see

**SmartScreen:** *"Windows protected your PC — unknown publisher."*
Click **More info → Run anyway**.

**Defender may flag `ffmpeg.dll`.** This is a false positive, and a common one.

## Why `ffmpeg.dll` is flagged

`ffmpeg.dll` is a standard component of Electron, the framework this app is
built on. It is Chromium's media library, shipped with every Electron
application — Slack, Discord, VS Code and Postman all contain it.

Heuristic scanners treat it with suspicion because malware also bundles ffmpeg,
and because an *unsigned* binary carries no publisher to vouch for it. The
combination — a well-known library inside an unsigned installer — is what
triggers the detection. The file is unmodified: it is exactly the copy Electron
publishes.

It cannot be removed. API Devkit plays no audio or video, so deleting it looks
like an easy win, and it is widely suggested online as a way to dodge these
warnings. It does not work: Electron links the library at load time, and an
app without it does not start at all.

```
Library not loaded: @rpath/libffmpeg.dylib
Termination Reason: DYLD, Code 1 — Library missing
```

## Verify the download before trusting it

Do not take the above on faith — check the file against the published
checksums. Every release includes `SHA256SUMS.txt`.

```powershell
Get-FileHash .\APIDevkit-windows-setup.exe -Algorithm SHA256
```

Compare the result with the line for that file in `SHA256SUMS.txt` on the
[release page](https://github.com/crafillio/crafillio-devkit/releases/latest).
If they match, the file is byte-for-byte what was built and published. If they
do not, do not run it.

## Reporting the false positive

Microsoft accepts submissions and usually resolves them within a couple of
days: <https://www.microsoft.com/en-us/wdsi/filesubmission>. Choose
**Microsoft Defender Antivirus**, mark it as an incorrect detection, and attach
the installer.

## The actual fix

Code signing. An Authenticode signature identifies the publisher, and
SmartScreen stops warning once a signed binary builds reputation — immediately
with an EV certificate, over time with an OV one.

That work is set up and waiting: `.github/workflows/release.yml` signs Windows
builds through [SignPath Foundation](https://signpath.org/), which signs
open-source projects at no cost. Until the certificate is in place, the
checksums above are the way to verify a download.

## What the installer does

- **Installs per-user**, so it never asks for administrator rights.
- **Makes no network requests of its own** — no telemetry, no update check.
- **Keeps your data** in `%USERPROFILE%\.crafillio`.
