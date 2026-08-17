#!/usr/bin/env bash
set -euo pipefail

# Packed-tarball smoke check.
#
# Verifies the npm tarball actually ships a working CLI: builds it with
# `npm pack`, installs the tarball into a fresh temp prefix, then asserts the
# installed `mauto` bin behaves (version, schema, guide). Wired into both the
# CI test job and the publish job so a broken tarball can never be published.
#
# Usage: scripts/pack-smoke.sh   (run from the repo root)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TMP_DIR="$(mktemp -d)"
TARBALL_PATH=""
cleanup() {
  rm -rf "$TMP_DIR"
  if [ -n "$TARBALL_PATH" ]; then
    rm -f "$TARBALL_PATH"
  fi
}
trap cleanup EXIT

# 1. Build the tarball. `npm pack --silent` prints just the tarball filename.
TARBALL="$(npm pack --silent)"
TARBALL_PATH="$REPO_ROOT/$TARBALL"

# 2. Install the tarball into a fresh prefix (no dev deps, no global install).
#    npm links the declared bins into <prefix>/node_modules/.bin/.
npm install "$TARBALL_PATH" --prefix "$TMP_DIR" --no-save --ignore-scripts >/dev/null

MAUTO="$TMP_DIR/node_modules/.bin/mauto"

# 3. The `mauto` bin exists and `--version` exits 0.
if [ ! -x "$MAUTO" ]; then
  echo "FAIL: mauto bin missing at $MAUTO" >&2
  exit 1
fi
"$MAUTO" --version >/dev/null

# 4. `mauto schema scenario` prints parseable JSON containing "$schema_version".
SCHEMA="$("$MAUTO" schema scenario)"
if ! printf '%s' "$SCHEMA" | node -e "JSON.parse(require('fs').readFileSync(0, 'utf8'))" >/dev/null 2>&1; then
  echo "FAIL: 'mauto schema scenario' did not print valid JSON" >&2
  exit 1
fi
if ! printf '%s' "$SCHEMA" | grep -q '"$schema_version"'; then
  echo "FAIL: 'mauto schema scenario' missing \$schema_version" >&2
  exit 1
fi

# 5. `mauto guide generate` output contains no surviving '{{' placeholder.
GUIDE="$("$MAUTO" guide generate)"
if printf '%s' "$GUIDE" | grep -q '{{'; then
  echo "FAIL: 'mauto guide generate' leaked a {{ placeholder }}" >&2
  exit 1
fi

echo "pack-smoke OK: tarball $TARBALL installed and CLI verified"
