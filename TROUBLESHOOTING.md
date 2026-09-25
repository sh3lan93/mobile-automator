# 🐛 Troubleshooting

## Setup Issues

### ❌ "Platform could not be detected"
- Ensure you're in the root directory of a mobile project
- `mauto` supports: Android, iOS, Flutter, React Native, KMP, CMP
- If your project structure is non-standard, setup will ask you to specify manually

### ❌ "Package ID not found"
- **For Android:** Check `app/build.gradle` for `applicationId`
- **For iOS:** Check Xcode project or `Info.plist` for bundle identifier
- Setup will prompt you to enter it manually if auto-detection fails

### ❌ "Skills not installed"
- Skills are installed per host by `mauto init`. Check that the skill files for your
  agent exist — e.g. `.claude/skills/mobile-automator-*/SKILL.md` for Claude Code,
  `.gemini/skills/mobile-automator-*/SKILL.md` for Gemini CLI, and likewise under
  `.cursor/skills/`, `.github/skills/`, or `.agents/skills/`.
- Re-run `mauto init --agent <claude|cursor|gemini|copilot|agents|all>` to (re)install them.

---

## Device Connection Issues

### ❌ "No devices found"

First, ask `mauto` what it can see:

```bash
mauto devices              # lists connected devices/emulators
mauto devices use <id>     # pin a specific device
```

If the list is empty, bring a device up:

**Android:**
```bash
# Check connected devices
adb devices

# Start emulator
emulator -avd Pixel_6_API_33
```

**iOS:**
```bash
# List available simulators
xcrun simctl list devices

# Boot simulator
xcrun simctl boot "iPhone 15 Pro"
```

Then re-run `mauto devices` to confirm it now appears.

### ❌ "App not installed"
- The generate/execute workflows will offer to build and install
- Or install manually before running tests

### ❌ "failed to start the device session daemon"

Device verbs share one background daemon per workspace. When it cannot start,
the verb waits out a 15s readiness window and then falls back to a one-shot
connection — so the failure is often silent. The daemon writes everything it
knows, including uncaught exceptions with stack traces and mobile-mcp's own
output, to a log inside the workspace:

```bash
mauto session status                          # reports log_path and session_id
tail -50 mobile-automator/.session/daemon.log # raw daemon + mobile-mcp output
```

The log is appended across spawns and rotates to `daemon.log.1` once it passes
1 MiB, so a crash loop cannot fill the disk.

**There are two log artifacts, and they answer different questions.**
`.session/daemon.log` is raw process output — the daemon's own stderr plus the
mobile-mcp engine's adb/simctl chatter — meant for a human to read top to
bottom. `.logs/daemon.ndjson` is one JSON object per line, carrying per-call
latencies, timeout counts, mobile-mcp error kinds, and the daemon's lifecycle
events (`daemon.start`, `daemon.lock_conflict`, `daemon.connect_failure`,
`daemon.listen_failure`, `daemon.stop`, `daemon.crash`). It answers "how long
do taps take on this device", "how often does mobile-mcp time out" and "did the
daemon die and respawn mid-run" — none of which the raw log can. Both are
bounded at 1 MiB with a single `.1` generation.

```bash
# What did the daemon do, most recent last?
cat mobile-automator/.logs/daemon.ndjson

# Only the failures
grep -E '"level":"(warn|error)"' mobile-automator/.logs/daemon.ndjson

# CLI and daemon on one timeline — both files carry an ISO `ts` and a `src`
jq -s 'sort_by(.ts) | .[]' mobile-automator/.logs/*.ndjson
```

Every event from one daemon lifetime shares a `session_id`, so when a daemon
died and respawned mid-run the two lifetimes stay separable — and
`mauto session status` tells you which one is live.

Within a lifetime, each device call carries its own `call_id`, and that is what
pairs a `call.start` to its `call.end`. Pair on `call_id`, never on
`session_id`: the daemon serves several sockets at once, so calls overlap and
finish out of order, and every call in the lifetime shares the one `session_id`.
A `call.start` whose `call_id` never appears in a `call.end` is a call that
never returned — correlate its `ts` against `daemon.log` to see what the engine
was doing.

```bash
# Calls that started and never returned (needs MAUTO_LOG_LEVEL=debug — see below)
jq -s '(map(select(.event == "call.end") | .call_id)) as $returned
       | map(select(.event == "call.start" and (.call_id as $id | $returned | index($id) | not)))' \
  mobile-automator/.logs/daemon.ndjson
```

`MAUTO_LOG_LEVEL` (`silent|error|warn|info|debug`) raises the detail in both
logs; `call.start` is recorded at `debug`, so hung-call diagnosis needs it. One
catch: **the daemon captures its log level at spawn time.** Nothing can export
a variable into an already-running detached process, so setting the variable on
a later verb changes only that verb's own events. End the session first:

```bash
mauto session end
MAUTO_LOG_LEVEL=debug mauto devices   # respawns the daemon at debug
```

To start clean, remove the session directory and re-run any device verb:

```bash
mauto session end                    # ask a live daemon to stop
rm -rf mobile-automator/.session     # clear a wedged socket/pidfile/lock
mauto devices                        # respawns the daemon
```

### ❓ "Element not found" — but did the app crash?

`mauto` cannot tell you from the error alone: a missing element and a dead app
produce the same message. With `MAUTO_OBSERVE=1`, a failed device verb carries
the answer in its envelope, and you can ask directly:

```bash
mauto crash list                  # scoped to the current device session
mauto crash get <id> --out /tmp/crash.txt
```

Read the envelope carefully — `crashes: []` and no `crashes` key are different
answers. The empty array means the device was asked and reported none. A missing
key means `mauto` could not ask: the device engine's crash helper was
unavailable, the lookup exceeded its 3-second budget, or there was no device
session to scope the reports against. In the last case, `mauto session start`
first and re-run.

Structured detail for any of those is in the event log:

```bash
grep -E '"event":"crash\.' mobile-automator/.logs/mauto.ndjson
```

---

## Test Execution Issues

### ❌ "Test is flaky"
- Mobile Automator automatically detects and flags flaky tests
- Check the observations in the result report for root cause
- **Common causes:** loading delays, animations, network dependencies

### ❌ "duration_seconds looks wrong"

Since 0.26.0 that field is measured from the run trace rather than taken from
`--duration`, but only when the run had a trace. Check which:

```bash
jq '.measurements' mobile-automator/results/<run_id>.json
```

- `"source": "trace"` — measured. If `duration_disagreement` is `true`, the
  agent's `--duration` and the clock disagreed; both numbers are in the file.
  That is a finding about the agent's estimate, not a bug in `mauto` — the
  clock is authoritative and the disagreement is exactly the signal this
  feature exists to surface.
- `"source": "reported"` — no trace, so `--duration` was used verbatim. Almost
  always because `MAUTO_RUN_ID` was not exported before the run, or was
  exported with a different value than the one passed to
  `mauto result finalize --run-id`. This is 0.24.0's behaviour, unchanged.
- `"source": "none"` — no trace and no `--duration` either.
- `"trace_truncated": true` — the trace hit its 1 MiB cap, so the duration is a
  lower bound, not the run's full span.

`MAUTO_RUN_ID` is what creates the trace in the first place — export it once,
before the first verb of the run, and every subsequent `mauto` invocation
(device verbs via the daemon, `mauto result` verbs via the `--run-id` they
already require) appends to the same file:

```bash
export MAUTO_RUN_ID=run_20260911_120000
mauto tap 100,250
mauto result add-step --run-id "$MAUTO_RUN_ID" ...
mauto result finalize --run-id "$MAUTO_RUN_ID" --duration 999
```

The trace itself is one JSON object per line, next to the other logs:

```bash
# Everything mauto did during that run, in order
cat mobile-automator/.logs/run-<run_id>.ndjson

# Just the failures, and any screenshots taken at them
jq 'select(.ok == false or .event == "screenshot.on_failure")' \
  mobile-automator/.logs/run-<run_id>.ndjson
```

Run traces are **capped, not rotated**, and that is deliberate. Rotation
renames the file's beginning away once it grows past the cap — but the
beginning is where the measured duration starts, so a rotated trace would
report a three-minute run as forty seconds: a number that *looks* measured and
is simply wrong, which is worse than the self-reported figure it replaced. A
capped trace instead stops accepting new events at the 1 MiB mark and keeps
the true beginning, so `finalize` can still report an honest duration — it
just flags it as a lower bound via `trace_truncated`.

`mauto result finalize` keeps the 20 most recent traces and deletes older ones
— pruning runs at finalize and nowhere else, and never deletes the trace it
just measured. A trace from a run several sessions ago may therefore be gone.

### ❌ "Screenshot mismatch"
- Check device differences (was reference captured on different device?)
- Check display settings (dark mode, font size)
- Review the similarity score - minor rendering differences are acceptable

---

## Scenario / Schema Issues

### ❌ "Scenario fails to validate"
- Run `mauto validate <file>` to check a scenario JSON against the schema; the error
  envelope's `error`/`hint` fields point at the offending field.
- Print the current schemas with `mauto schema scenario` / `mauto schema result`.

### ❌ "Setup didn't complete properly"
- Re-run `mauto setup` to (re)scaffold the `mobile-automator/` workspace and config.
- Inspect the workspace config with `mauto config get <key>` (the config lives at
  `mobile-automator/config.json`).

---

## Tag Filtering Issues

### ❌ "Invalid tag format" error
- **Cause:** Tags must contain only lowercase letters, numbers, and hyphens (a-z0-9-), and be under 20 characters. Spaces, underscores, and uppercase letters are not allowed.
- **Fix:** Update your `scenario.json` file to fix the invalid tag (e.g. change `"Smoke_Test"` to `"smoke-test"`).

### ❌ Scenario doesn't show up in tag groups
- **Cause:** The scenario does not have a `tags` array in its JSON, or the array is empty.
- **Fix:** Manually add `"tags": ["some-tag"]` to the scenario's JSON file.

---

## Getting More Help

If you encounter an issue not listed here:
1. Check the [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
2. Review the [CLAUDE.md](CLAUDE.md) for architectural details
3. Open a new issue with:
   - Error message
   - Setup configuration (`mobile-automator/config.json`)
   - Steps to reproduce
   - For anything device-related, the daemon log
     (`mobile-automator/.session/daemon.log`) — it carries the stack traces
