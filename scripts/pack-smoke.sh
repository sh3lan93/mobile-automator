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

# 6. `mauto devices` starts the real engine and answers ok:true with a list.
#
#    Every check above runs without mobile-mcp; this is the only step that
#    starts the pinned engine from the PACKED tarball. It proves two things
#    nothing else does: the MCP handshake between our client SDK (1.x) and the
#    engine's server SDK (2.0) completes, and the per-platform `mobilecli`
#    binary resolved on this OS. The --ignore-scripts install above is fine for
#    that: mobilecli ships its binaries as per-platform optionalDependencies,
#    not a postinstall download (#199).
#
#    No device is attached in CI (and adb may be absent), so the expected
#    answer is an empty list — the point is ok:true, not what is listed. It runs
#    from a fresh empty directory so no workspace is discovered, and that
#    directory must still be empty afterwards: `devices` needs no workspace and
#    must not create one (#188). Telemetry is disabled for this one call.
DEVICES_DIR="$TMP_DIR/devices-cwd"
mkdir "$DEVICES_DIR"
DEVICES_STDERR="$TMP_DIR/devices.stderr"
DEVICES_STATUS=0
DEVICES_OUT="$(cd "$DEVICES_DIR" && MOBILEMCP_DISABLE_TELEMETRY=1 "$MAUTO" devices 2>"$DEVICES_STDERR")" || DEVICES_STATUS=$?
devices_fail() {
  echo "FAIL: 'mauto devices' $1" >&2
  echo "  exit: $DEVICES_STATUS" >&2
  echo "  stdout: $DEVICES_OUT" >&2
  echo "  stderr:" >&2
  sed 's/^/    /' "$DEVICES_STDERR" >&2
  exit 1
}
if [ "$DEVICES_STATUS" -ne 0 ]; then
  devices_fail "exited non-zero"
fi
if ! printf '%s' "$DEVICES_OUT" | node -e "
  const env = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  process.exit(env.ok === true && Array.isArray(env.data) ? 0 : 1);
" >/dev/null 2>&1; then
  devices_fail "did not print an ok:true envelope with a device array"
fi
if [ -n "$(ls -A "$DEVICES_DIR")" ]; then
  devices_fail "wrote into its working directory: $(ls -A "$DEVICES_DIR" | tr '\n' ' ')"
fi

echo "pack-smoke OK: tarball $TARBALL installed and CLI verified"
