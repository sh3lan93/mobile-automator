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
# even after a failure. A scenario that exits with anything but 0 or 7 is run
# once more (unless REPLAY_RETRIES=0), since a device engine can time out
# once and then work: the retry logs to <out-dir>/logs/<name>.retry.log, the
# first attempt's junit is kept as <out-dir>/junit/<name>.attempt1.xml, and
# the retry's junit takes the usual path. Exit 7 is never retried: an agent
# step needs an agent every time.
#
# Each result is classified by the final attempt's exit code alone; stdout is
# never parsed (it can carry engine log lines next to the envelope):
#   0      passed, or flaky when it passed only on the retry. Flaky does not
#          fail the run; it gets a `::warning` naming the first exit code
#   6      failed: the app or the scenario. If REPLAY_PROBE is set it runs
#          next, and a non-zero probe makes it an outage of an external
#          service instead
#   7      needs_agent: a step or assertion needs an agent
#   other  mauto_error: mauto, the engine or the device
# A scenario that failed both attempts names both exit codes.
#
# Output: a Markdown table appended to $GITHUB_STEP_SUMMARY (stdout when it is
# unset), one GitHub `::error` annotation per scenario that did not pass, one
# `::warning` per flaky scenario, and <out-dir>/summary.tsv for machines, one
# line per scenario with the columns: name, class (passed, flaky, failed,
# outage, needs_agent, mauto_error), the final attempt's exit code, and the
# number of attempts (1 or 2).
#
# Environment:
#   MAUTO                the mauto binary (default: mauto)
#   REPLAY_PROBE         optional shell command, run with `bash -c` after the
#                        final attempt exits 6; non-zero means an external
#                        service is down
#   REPLAY_RETRIES       retries after a failed attempt: 1 (default) or 0
#   GITHUB_STEP_SUMMARY  set by GitHub Actions; where the table goes
#
# Exit status: 0 when every scenario passed (flaky counts as passed), 1
# otherwise, 64 on bad usage.

set -uo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: replay.sh <device-id> <out-dir> <scenario.json>..." >&2
  exit 64
fi

retries="${REPLAY_RETRIES:-1}"
case "$retries" in
  0|1) ;;
  *)
    echo "replay.sh: REPLAY_RETRIES must be 0 or 1, got '$retries'" >&2
    exit 64 ;;
esac

device="$1"
out="$2"
shift 2

mauto="${MAUTO:-mauto}"
probe="${REPLAY_PROBE:-}"

mkdir -p "$out/junit" "$out/logs"
tsv="$out/summary.tsv"
: > "$tsv"

table="### Replay on $device

| Scenario | Result | Exit | Attempts |
|---|---|---|---|
"
all_passed=1

# replay_once <scenario> <junit> <log>: one `mauto run`; returns its exit code.
replay_once() {
  "$mauto" run "$1" --device "$device" --junit "$2" > "$3" 2>&1
}

for file in "$@"; do
  name="$(basename "$file" .json)"
  log="$out/logs/$name.log"
  junit="$out/junit/$name.xml"

  replay_once "$file" "$junit" "$log"
  code=$?
  attempts=1
  first=""

  if [ "$retries" -eq 1 ] && [ "$code" -ne 0 ] && [ "$code" -ne 7 ]; then
    first="$code"
    [ -e "$junit" ] && mv "$junit" "$out/junit/$name.attempt1.xml"
    log="$out/logs/$name.retry.log"
    replay_once "$file" "$junit" "$log"
    code=$?
    attempts=2
  fi

  case "$code" in
    0)
      class=passed; label=passed; title="" ;;
    6)
      class=failed; label="scenario failed: the app or the scenario"; title="Scenario failed"
      if [ -n "$probe" ]; then
        echo "--- REPLAY_PROBE: $probe" >> "$log"
        if ! bash -c "$probe" >> "$log" 2>&1; then
          class=outage; label="external service outage"; title="Outage (not mauto)"
        fi
      fi
      ;;
    7)
      class=needs_agent; label="incomplete: a step or assertion needs an agent"; title="Needs agent" ;;
    *)
      class=mauto_error; label="mauto or device error (exit $code)"; title="mauto or device error" ;;
  esac

  if [ -n "$first" ]; then
    if [ "$class" = passed ]; then
      class=flaky; label="passed on retry (flaky)"; title="Flaky (passed on retry)"
    else
      label="$label (first attempt exit $first)"
    fi
  fi

  printf '%s\t%s\t%s\t%s\n' "$name" "$class" "$code" "$attempts" >> "$tsv"
  table="$table| $name | $label | $code | $attempts |
"
  case "$class" in
    passed) ;;
    flaky)
      echo "::warning title=$title::$name: first attempt exit $first" ;;
    *)
      all_passed=0
      echo "::error title=$title::$name: $label" ;;
  esac
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
