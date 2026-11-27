#!/usr/bin/env bash
# Print the id mauto uses for the first connected device of one platform.
#
# Generic: copy this file into any app's repo unchanged.
#
# Usage:
#   device-id.sh <android|ios>
#
# It runs `$MAUTO devices` and reads the envelope: the last stdout line that
# starts with `{` (the device engine can print log lines before it), whose
# `data` is a list of {id, name, platform, state}. It prints the `id` of the
# first device whose platform matches (case-insensitive). That id is what
# `mauto run --device` expects; on an Android emulator it can be the AVD name
# rather than `emulator-5554`, so read it here instead of guessing.
#
# Environment:
#   MAUTO  the mauto binary (default: mauto)
#
# Needs jq.
#
# Exit status: 0 with the id on stdout; 1 when mauto reports an error or no
# device of that platform (with a GitHub `::error` annotation on stderr, since
# stdout is usually captured: ID="$(device-id.sh android)"); 64 on bad usage.

set -uo pipefail

usage() {
  echo "usage: device-id.sh <android|ios>" >&2
  exit 64
}

[ "$#" -eq 1 ] || usage
platform="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
case "$platform" in
  android|ios) ;;
  *) usage ;;
esac

command -v jq >/dev/null 2>&1 || { echo "device-id.sh: jq is required" >&2; exit 1; }

mauto="${MAUTO:-mauto}"
out="$("$mauto" devices)"
envelope="$(printf '%s\n' "$out" | grep '^{' | tail -n 1)"

if [ -z "$envelope" ] || ! printf '%s' "$envelope" | jq -e '.ok == true' >/dev/null 2>&1; then
  echo "::error title=mauto devices failed::mauto devices did not report ok" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi

id="$(printf '%s' "$envelope" | jq -r --arg p "$platform" \
  '[.data[]? | select(((.platform // "") | ascii_downcase) == $p) | .id][0] // empty')"

if [ -z "$id" ]; then
  echo "::error title=No $platform device::mauto devices listed no $platform device" >&2
  exit 1
fi

printf '%s\n' "$id"
