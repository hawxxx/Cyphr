#!/usr/bin/env bash
#
# build.sh — bump version, package, and sign the Cyphr extension.
#
# Usage:
#   ./build.sh [patch|minor|major|X.Y.Z]   # default: patch
#
#   ./build.sh                # 1.1.0 -> 1.1.1
#   ./build.sh minor          # 1.1.0 -> 1.2.0
#   ./build.sh major          # 1.1.0 -> 2.0.0
#   ./build.sh 1.5.2          # set an explicit version
#
# Credentials are supplied through environment variables or CYPHR_ENV_FILE:
#   MOZILLA_API_ISSUER=...
#   MOZILLA_API_SECRET=...
#
# The signed .xpi is written to ./web-ext-artifacts/

set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="${CYPHR_ENV_FILE:-}"
MANIFEST="manifest.json"
BUMP="${1:-patch}"

# ── Preconditions ────────────────────────────────────────────────────────────
[ -f "$MANIFEST" ] || { echo "Error: $MANIFEST not found" >&2; exit 1; }
if [[ -n "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

# ── Read current version ───────────────────────────────────────────────────────
CURRENT=$(node -e "process.stdout.write(require('./$MANIFEST').version)")
echo "Current version: $CURRENT"

# ── Compute next version ───────────────────────────────────────────────────────
if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEXT="$BUMP"
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  case "$BUMP" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
    *) echo "Error: invalid bump '$BUMP' (use patch|minor|major|X.Y.Z)" >&2; exit 1 ;;
  esac
  NEXT="$MAJOR.$MINOR.$PATCH"
fi
echo "New version:     $NEXT"

# ── Write new version into manifest (preserves formatting via targeted replace) ─
node -e "
  const fs = require('fs');
  const m = '$MANIFEST';
  const txt = fs.readFileSync(m, 'utf8');
  const out = txt.replace(/(\"version\"\s*:\s*\")$CURRENT(\")/, '\$1$NEXT\$2');
  if (out === txt) { console.error('Error: could not update version in manifest'); process.exit(1); }
  fs.writeFileSync(m, out);
"

# ── Load AMO credentials (subshell scope, never printed) ───────────────────────
if [[ -n "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${MOZILLA_API_ISSUER:?Set MOZILLA_API_ISSUER or CYPHR_ENV_FILE}"
: "${MOZILLA_API_SECRET:?Set MOZILLA_API_SECRET or CYPHR_ENV_FILE}"

# ── Sign through AMO (unlisted) ────────────────────────────────────────────────
echo "Submitting to AMO for signing..."
npx --yes web-ext sign \
  --channel=unlisted \
  --api-key="$MOZILLA_API_ISSUER" \
  --api-secret="$MOZILLA_API_SECRET" \
  --artifacts-dir=./web-ext-artifacts \
  --ignore-files=README.md "*.xpi" build.sh '.git/**' '.github/**' '.env*' '.gitignore' 2>&1 \
  | sed -E 's/(api-key|api-secret)=[^ ]+/\1=***REDACTED***/g'

echo ""
echo "Done. Signed .xpi (v$NEXT) is in ./web-ext-artifacts/"
echo "Install via about:addons -> gear -> Install Add-on From File."
