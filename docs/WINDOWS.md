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

## Blocked by Attack Surface Reduction

A different message, and a different mechanism:

> **Blocked by attack surface reduction**
> Rule: *Use advanced protection against ransomware*
> `…\AppData\Local\Programs\API Devkit\ffmpeg.dll`

This is not a malware detection. Attack Surface Reduction (ASR) is a policy
that blocks binaries which are **unsigned and not widely seen**, whatever they
contain. A brand-new installer from an individual developer matches both
conditions by definition, and the per-user install location — `%LOCALAPPDATA%`,
which any process can write to — is the case that rule scrutinises hardest.

Nothing about the file is the problem, so nothing in a rebuild will clear it.
There are three ways through, from best to worst.

### 1. Use the portable build

`APIDevkit-windows-portable-x64.zip` (or `-arm64`) needs no installer at all:
unzip it anywhere and run `API Devkit.exe`. It is the same application the
installer lays down, minus the installer's own elevation helper, and it keeps
your data in the same place — `%USERPROFILE%\.crafillio` — so you can move
between the two without losing anything.

Unzipping to a folder you own, such as `C:\Users\<you>\Apps`, avoids the
installer entirely. Note that a user-writable location is still a
user-writable location, so a strict ASR policy may object to it too; if it
does, try the next option.

### 2. Install for all users

Run the installer and choose **Anyone who uses this computer** when asked. That
installs to `Program Files`, which is not user-writable and which ASR policies
treat quite differently. It needs administrator rights once, at install time.
This is the option to try first — it changes nothing about your security
posture.

### 3. Exclude just this application

If you administer the machine, exclude the one folder rather than turning the
rule off. In an **administrator** PowerShell:

```powershell
Add-MpPreference -AttackSurfaceReductionOnlyExclusions "$env:LOCALAPPDATA\Programs\API Devkit"
```

To see which rules are active first:

```powershell
Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids
```

The rule in question is `c1db55ab-c21a-4637-bb3f-a12568109d35`.

### 4. On a managed or work computer, ask IT

ASR rules are normally pushed by Intune or Group Policy, and a local exclusion
will be overwritten at the next policy refresh — or refused outright. The
request to make is an exclusion for this application, not disabling the rule.
Send them the checksums below so they can verify what they are allowing.

**Do not turn the rule off.** It is doing its job: an unsigned binary is
exactly what it is meant to stop. The correct answer is a signature, which is
covered at the end of this page.

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
