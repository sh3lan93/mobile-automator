#!/usr/bin/env bash
# Replay mobile-automator scenarios on one device and classify each result.
#
# Generic: copy this file into any app's repo unchanged.
#
# Usage:
#   replay.sh <device-id> <out-dir> <scenario.json>...
#
# For each scenario it runs
#   $MAUTO run <scenario> --device <device-id> --junit <out-dir>/junit/<name>.xml
# saving stdout and stderr to <out-dir>/logs/<name>.log. Every scenario runs,
# even after a failure. Each result is classified by the exit code alone;
# stdout is never parsed (it can carry engine log lines next to the envelope):
#   0      passed
#   6      failed: the app or the scenario. If REPLAY_PROBE is set it runs
#          next, and a non-zero probe makes it an outage of an external
#          service instead
#   7      needs_agent: a step or assertion needs an agent
#   other  mauto_error: mauto, the engine or the device
#
# Output: a Markdown table appended to $GITHUB_STEP_SUMMARY (stdout when it is
# unset), one GitHub `::error` annotation per scenario that did not pass, and
# <out-dir>/summary.tsv (name, class, exit code) for machines.
#
# Environment:
#   MAUTO                the mauto binary (default: mauto)
#   REPLAY_PROBE         optional shell command, run with `bash -c` after an
#                        exit 6; non-zero means an external service is down
#   GITHUB_STEP_SUMMARY  set by GitHub Actions; where the table goes
#
# Exit status: 0 when every scenario passed, 1 otherwise, 64 on bad usage.

set -uo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: replay.sh <device-id> <out-dir> <scenario.json>..." >&2
  exit 64
fi

device="$1"
out="$2"
shift 2

mauto="${MAUTO:-mauto}"
probe="${REPLAY_PROBE:-}"

mkdir -p "$out/junit" "$out/logs"
tsv="$out/summary.tsv"
: > "$tsv"

table="### Replay on $device

| Scenario | Result | Exit |
|---|---|---|
"
all_passed=1

for file in "$@"; do
  name="$(basename "$file" .json)"
  log="$out/logs/$name.log"

  "$mauto" run "$file" --device "$device" --junit "$out/junit/$name.xml" > "$log" 2>&1
  code=$?

  case "$code" in
    0)
      class=passed; label=passed; title="" ;;
    6)
      class=failed; label="scenario failed: the app or the scenario"; title="Scenario failed"
      if [ -n "$probe" ]; then
        echo "--- REPLAY_PROBE: $probe" >> "$log"
        if ! bash -c "$probe" >> "$log" 2>&1; then
          class=outage; label="external service outage"; title="Outage, not mauto"
        fi
      fi
      ;;
    7)
      class=needs_agent; label="incomplete: a step or assertion needs an agent"; title="Needs agent" ;;
    *)
      class=mauto_error; label="mauto or device error (exit $code)"; title="mauto or device error" ;;
  esac

  printf '%s\t%s\t%s\n' "$name" "$class" "$code" >> "$tsv"
  table="$table| $name | $label | $code |
"
  if [ "$class" != passed ]; then
    all_passed=0
    echo "::error title=$title::$name: $label"
  fi
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '%s\n' "$table" >> "$GITHUB_STEP_SUMMARY"
else
  printf '%s\n' "$table"
fi

if [ "$all_passed" -eq 1 ]; then
  exit 0
fi
exit 1
