#!/usr/bin/env bash
#
# Publishes this repository to GitHub: creates it if absent, pushes main and
# the release tag, serves docs/ as the project page, and opens the v1.0.0
# release.
#
# Every step is idempotent — re-running after a partial failure resumes rather
# than duplicating. Authentication is deliberately not handled here: run
#
#   gh auth login --hostname github.com --git-protocol https --web
#
# once beforehand, and gh keeps its own token in the system keychain. Nothing
# in this script reads, writes or prints a credential.

set -euo pipefail

OWNER=crafillio
NAME=crafillio-devkit
SLUG="$OWNER/$NAME"
TAG=v1.0.0

cd "$(dirname "$0")/.."

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
skip() { printf '  \033[2m·\033[0m %s\n' "$1"; }

# ── Preflight ────────────────────────────────────────────────────────────────
step "Checking prerequisites"

command -v gh >/dev/null || { echo "  gh is not installed: brew install gh"; exit 1; }
ok "gh $(gh --version | head -1 | awk '{print $3}')"

if ! gh auth status >/dev/null 2>&1; then
  cat <<'EOF'
  Not logged in to GitHub. Run this once, then re-run this script:

    gh auth login --hostname github.com --git-protocol https --web

  The --git-protocol https flag is what stops it asking for an SSH key.
EOF
  exit 1
fi
ok "authenticated as $(gh api user --jq .login)"

if [ -n "$(git status --porcelain)" ]; then
  echo "  Working tree is dirty. Commit or stash first:"
  git status -s | sed 's/^/    /'
  exit 1
fi
ok "working tree clean at $(git rev-parse --short HEAD)"

# ── Repository ───────────────────────────────────────────────────────────────
step "Repository"

if gh repo view "$SLUG" >/dev/null 2>&1; then
  skip "$SLUG already exists"
else
  gh repo create "$SLUG" \
    --public \
    --description "REST, gRPC, S3, workflows and load testing in one offline-first desktop app." \
    --homepage "https://$OWNER.github.io/$NAME/" \
    >/dev/null
  ok "created $SLUG"
fi

git remote set-url origin "https://github.com/$SLUG.git"

# ── Push ─────────────────────────────────────────────────────────────────────
step "Pushing"

git push -u origin main
ok "main pushed"

git push origin "refs/tags/$TAG"
ok "$TAG pushed"

# ── Pages ────────────────────────────────────────────────────────────────────
step "GitHub Pages"

if gh api "repos/$SLUG/pages" >/dev/null 2>&1; then
  # Already enabled: correct the source in case it points somewhere else.
  gh api -X PUT "repos/$SLUG/pages" \
    -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null
  skip "already enabled, source reset to main:/docs"
else
  gh api -X POST "repos/$SLUG/pages" \
    -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null
  ok "enabled from main:/docs"
fi

echo "  Site: https://$OWNER.github.io/$NAME/  (live in a minute or two)"

# ── Release ──────────────────────────────────────────────────────────────────
step "Release"

if gh release view "$TAG" --repo "$SLUG" >/dev/null 2>&1; then
  skip "$TAG release already exists"
else
  # RELEASE_NOTES.md is the long form; the tag message is the summary.
  gh release create "$TAG" \
    --repo "$SLUG" \
    --title "API Devkit $TAG" \
    --notes-file RELEASE_NOTES.md \
    >/dev/null
  ok "release $TAG opened"
fi

# Installers are optional: attach them only if a build has been run. They are
# unsigned, so macOS will warn on first launch — that is expected, not a bug.
shopt -s nullglob
ARTIFACTS=(apps/desktop/release/*.dmg apps/desktop/release/*.exe)
if [ ${#ARTIFACTS[@]} -gt 0 ]; then
  gh release upload "$TAG" "${ARTIFACTS[@]}" --repo "$SLUG" --clobber
  ok "uploaded ${#ARTIFACTS[@]} installer(s)"
else
  skip "no installers found — run 'npm run dist' then re-run to attach them"
fi

step "Done"
echo "  Repo:    https://github.com/$SLUG"
echo "  Site:    https://$OWNER.github.io/$NAME/"
echo "  Release: https://github.com/$SLUG/releases/tag/$TAG"
