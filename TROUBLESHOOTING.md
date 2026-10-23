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

### ❌ "no mobile-automator/ workspace found" (exit 5)
- `mauto` walks up from the current directory to the nearest `mobile-automator/config.json`,
  stopping at the repository root (the directory holding `.git`). The hint lists every
  directory it checked.
- If the list stops short of your project, you are in a different repository (e.g. a
  submodule or nested checkout) — `cd` into the project that has the workspace.
- If no workspace exists yet, run `mauto setup` from the project root.
- `session start` and `devices use` also fail this way: they persist the session
  daemon and the device selection under `mobile-automator/.session/`, so they need
  a workspace to write into. The other device verbs run without one (one-shot
  connection, nothing written).
- Running `mauto setup` in a subdirectory creates a *nested* workspace that shadows the
  ancestor one for everything run below it; `setup`'s hint warns when that happens.

### ❌ mauto refuses to run on Windows
- **At install**, npm stops with:
  ```
  npm ERR! code EBADPLATFORM
  ```
  (newer npm prints `npm error code EBADPLATFORM`). `package.json` declares `os: ["darwin", "linux"]`,
  so npm refuses the install on Windows.
- **At runtime** (an install forced past that with `--force`, or a source checkout via `npm link`),
  every device verb and `session start|status|end` fails with an `environment` envelope, exit 5:
  ```
  mauto's device session needs a POSIX host (macOS or Linux); "win32" is not supported
  ```
- **Why:** the session layer is POSIX-only. The daemon binds a Unix domain socket, and the CLI
  identifies and reaps it with `ps`, process-group kill and POSIX signals — none of which exist on Windows.
- **Fix:** install and run `mauto` inside WSL2 (a Linux distribution). The device must be reachable from
  inside WSL — USB passthrough via `usbipd-win`, or `adb connect` to an emulator on the Windows side.
- Device-free verbs (`validate`, `schema`, `guide`, `bootstrap`, `init`, `setup`, `config`, `memory`,
  `result …`) still work on a forced Windows install; only verbs that need the device session are refused.
- **Note the two layers**: npm's refusal is the primary gate and it cannot carry the WSL2 hint (npm does
  not let a package customize `EBADPLATFORM`); the runtime envelope above is the secondary gate for
  installs forced past npm. Reaching the runtime error at all means you are on a forced or linked install.

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

### ❌ "mobilecli is not available or not working properly"

Every device verb fails with this message. The device engine (mobile-mcp
1.0.5) drives devices through `mobilecli`, a native binary installed as a
per-platform optional dependency (`@mobilenext/mobilecli-<os>-<arch>`). If
that package is missing — an install with `--omit=optional`, or some pnpm
layouts — the engine has nothing to run.

```bash
npm i -g mobile-automator                     # reinstall WITHOUT --omit=optional
export MOBILECLI_PATH=/path/to/mobilecli      # or point at a working binary
mauto session end                             # the next verb picks it up
mauto devices
```

### ❌ Text-field labels are missing, or `elements` lists a hidden tab's content

On the default engine (`mobilecli`), Flutter apps on Android — and other apps
that draw their own UI — lose the label of a `TextField` (and of a child that
shares its parent's bounds) in `mauto elements`, and content from an offstage
`IndexedStack` tab is listed as if it were on screen. Fields cannot be
targeted by their label, and a target such as `Home` can match a tile on a
hidden tab before the visible one. The legacy engine hides offstage tab
content on every Android version tested, and recovers the labels on recent
Android versions (verified on Android 16 / API 36). On older ones (not on API
33, for example) its uiautomator dump carries no field label either, so labels
stay missing on both engines, though legacy still fixes the hidden-tab content
([#251](https://github.com/sh3lan93/mobile-automator/issues/251), upstream
[mobilecli#534](https://github.com/mobile-next/mobilecli/issues/534)). Switch
the workspace to it — see the next entry.

### ❌ Swipes, element lists or gestures behave differently after upgrading to 0.27

0.27 moved the device engine to mobile-mcp 1.0.5, which drives every device
through `mobilecli` instead of the previous robots (adb on Android, WDA +
go-ios on real iOS devices). Since 0.32 the workspace `engine` key selects the
previous robots — `mobilecli` (default) or `legacy`:

```bash
mauto config set engine legacy                # clears the pinned device, prints a hint
adb -s <serial> shell pkill -f com.mobilenext.mobilecli.DeviceServer   # Android only
mauto devices                                 # restarts the session on the legacy robot
mauto devices use <id>                        # ids change between robots
```

The next device verb restarts a session daemon that is running the other
engine, so no `mauto session end` is needed; `mauto session status` reports
the running `engine` next to the `resolved_engine` the workspace asks for. On
Android, release the `mobilecli` agent first (see the "`uiautomator dump` is
killed" entry below), or the legacy robot's `elements` fails with `Cannot read
properties of undefined (reading 'node')`. `mauto config set engine mobilecli`
switches back.

An exported `MOBILEMCP_LEGACY_ROBOT` overrides the key (`1` selects legacy,
any other value `mobilecli`), and `config set engine` warns when it does.
The engine reads that variable once per session daemon, so after changing it
run `mauto session end` before the next verb.

Switching robots changes Android emulator ids (AVD name vs adb serial — see
the next entry), which is why `config set engine` clears a device pinned with
`mauto devices use`. In legacy mode `mauto crash list` fails with `device not
found: emulator-5554` and the failure probe gathers no crash evidence: crash
reports still go through `mobilecli`, which does not know the adb-serial id.

iOS simulators use `mobilecli` either way. If the legacy robot behaves
correctly and the default does not, please report the difference — with the
verb, platform and both envelopes — on a
[new issue](https://github.com/sh3lan93/mobile-automator/issues/new) referencing
[#199](https://github.com/sh3lan93/mobile-automator/issues/199).

### ❌ `Device "emulator-5554" not found` after upgrading to 0.27

Every verb fails with this even though the emulator is running. The 0.27
engine lists Android emulators by AVD name (`Pixel_9_Pro`), while the legacy
engine (`engine: legacy` or `MOBILEMCP_LEGACY_ROBOT=1`) and mauto before 0.27
used the adb serial (`emulator-5554`); each rejects the other's id. A device pinned with
`mauto devices use` (or a `--device` in a script) from before the upgrade is
now unknown. Re-select it — iOS simulator UDIDs are the same either way:

```bash
mauto devices                  # ids as the current engine sees them
mauto devices use Pixel_9_Pro  # or pass that id to --device
```

### ❌ "Agent is not installed on the device" (iOS simulator)

Every device verb fails on a simulator that has never had the engine's
on-device agent, with a message like `Command failed: …/mobilecli-… agent
status --device <udid>` followed by `Agent is not installed on the device`.
The engine is meant to install the agent itself, but `mobilecli agent status`
exits non-zero when it is missing and the engine treats that as a failure
before reaching its install step
([mobile-mcp#459](https://github.com/mobile-next/mobile-mcp/issues/459)).
Install it once per simulator (needs network, takes about 4 seconds; mauto's
error hint prints this command with your simulator's id filled in):

```bash
npx -y mobilecli@1.0.13 agent install --device <udid>   # udid from `mauto devices`
```

This adds a "Device Kit" app to the simulator; that is the engine's agent,
not your app under test.

### ❌ `uiautomator dump` is killed, Appium dies, or `elements` fails with "reading 'node'"

On Android, `mobilecli` pushes `/data/local/tmp/mobilecli.dex` (no package is
installed) and starts `com.mobilenext.mobilecli.DeviceServer` via
`app_process`. That server outlives `mauto session end` and the daemon, and
it holds the device's single UiAutomation connection — so `uiautomator dump`
is killed (exit 137), Appium/UiAutomator2 sessions on that device are killed,
and the legacy robot's `elements` fails with `Cannot read properties of
undefined (reading 'node')`. Release it when you are done with mauto or
before using another UiAutomator tool
([mobilecli#470](https://github.com/mobile-next/mobilecli/issues/470)):

```bash
adb -s <serial> shell pkill -f com.mobilenext.mobilecli.DeviceServer
```

### ❌ `mauto open-url myapp://…` fails with "Only http:// and https:// URLs are allowed"

The device engine only accepts non-web URLs when `MOBILEMCP_ALLOW_UNSAFE_URLS=1`.
Since 0.28.1 mauto sets that for the engine it spawns
([#212](https://github.com/sh3lan93/mobile-automator/issues/212)), so deep links
work by default. If you still see this error, `MOBILEMCP_ALLOW_UNSAFE_URLS` is
set to something other than `1` (e.g. `0`) in the environment the session
daemon started from. Unset it and restart the session — the variable is read
only when the daemon spawns its engine:

```bash
unset MOBILEMCP_ALLOW_UNSAFE_URLS
mauto session end
mauto open-url myapp://path
```

If the verb succeeds but the deep link opens nothing, no installed app has
registered that scheme — check the app's intent-filter (Android) or URL types
(iOS).

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
mobile-mcp engine's own stderr (its tool invocations and device tooling) — meant for a human to read top to
bottom. `.logs/daemon.ndjson` is one JSON object per line, carrying per-call
latencies, timeout counts, mobile-mcp error kinds, and the daemon's lifecycle
events (`daemon.start`, `daemon.lock_conflict`, `daemon.connect_failure`,
`daemon.listen_failure`, `daemon.engine_exit`, `daemon.stop`, `daemon.crash`). It answers "how long
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

### ❌ `session status` reports `reason: "engine_exited"`

The daemon is reachable but its mobile-mcp engine has died, so it can no longer
drive the device. It is already shutting itself down; the next device verb
starts a fresh session. The cause is in the engine's own output in
`mobile-automator/.session/daemon.log`; the structured record is a
`daemon.engine_exit` event followed by `daemon.stop` with
`stop_reason: "engine_exit"` in `mobile-automator/.logs/daemon.ndjson`.

### ❌ `session end` reported `forced: true`, or failed with a `pid`

The daemon acknowledged the shutdown but was still alive 35 seconds later —
usually a device call that never returned, or an engine that would not exit.
`forced: true` means mauto terminated it. A failure with `pid` means it could
not be stopped (or could not be confirmed as this workspace's daemon, so it was
left alone): check it with `ps -p <pid>` and stop it with `kill -9 <pid>`. Its
stale lock and socket are cleaned automatically by the next session start.

A daemon's command line ends in `--workspace-key <digest>`, a digest of its
project root rather than the path itself, so `ps` never shows other users where
your project lives. Daemons started by 0.28.0–0.33.0 end in
`--project-root <root>` instead, and are still recognised.

### ❌ A verb failed with "mobile-mcp did not finish initializing within 10000ms"

The engine started but never completed its MCP handshake. Nothing is left
running — the engine is terminated before the error is reported. The
structured record is `daemon.connect_failure` with
`error_code: "ENGINE_CONNECT_TIMEOUT"`. Check `daemon.log` for the engine's
own output.

### ❌ "engine returned zero elements after a successful launch"

Reported by the sample-app E2E (`sample-app/scripts/run-e2e.mjs`) when
`mauto launch` succeeded but `mauto elements` kept answering `ok: true` with
an empty list for the whole wait. That is never "the target is missing" — no
target was looked for. It means one of:

- **The engine's element response changed shape.** A new mobile-mcp or
  mobilecli can return elements in a form the parser no longer reads; this
  is how #199 first looked like an app bug. Check that the installed
  `@mobilenext/mobile-mcp` is the version `package.json` pins and run
  `npm run test:integration` (`mobile-mcp-contract.test.js`).
- **The app did not render.** Take a screenshot (`mauto screenshot /tmp/s.png`)
  and check `mauto crash list`.

Run the harness with `E2E_ARTIFACTS_DIR=<dir>` to keep the failure screenshot,
the result file and `.session/daemon.log` for the run.

### ❓ "Element not found" — but did the app crash?

`mauto` cannot tell you from the error alone: a missing element and a dead app
produce the same message. A failed device verb carries the answer in its
envelope, and you can ask directly:

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

### ❔ "Is mauto sending anything anywhere?"

Two separate answers: mauto's own telemetry, and the device engine's.

**mauto's own telemetry** is opt-in — nothing is sent unless you turned it on.

```bash
mauto telemetry status                          # on/off, endpoint, exact field list
cat mobile-automator/.logs/telemetry.spool      # every payload waiting to be sent
```

The spool is deliberately not named `*.ndjson`, so it stays out of the
`cat mobile-automator/.logs/*.ndjson` merged-timeline recipe above — it is a
queue that gets renamed mid-flush, not part of the event log.

If it is growing and never draining, the daemon is not running (it is what
uploads) or the network is unreachable. `mauto telemetry flush` drains it
synchronously and reports what happened. `mauto telemetry disable` stops it
being written at all.

**The device engine** (mobile-mcp, which mauto runs to drive devices) has its
own telemetry, independent of the above: a PostHog event per device call
(`tool_invoked` / `tool_failed` — tool name, duration, device counts), and
since mobile-mcp 1.0.5 a scarf.sh pixel fetched once per engine process.
Upstream it is on by default; **mauto turns it off** by starting the engine
with `MOBILEMCP_DISABLE_TELEMETRY=1`. Check what the engine was handed:

```bash
mauto telemetry status | jq .data.engine      # {"enabled":false,"reason":"default_off"}
```

If you set `MOBILEMCP_DISABLE_TELEMETRY` yourself, mauto passes it through
unchanged. The engine treats any non-empty value as "off", so only an explicit
empty string (`MOBILEMCP_DISABLE_TELEMETRY=`) opts it back in, and
`MAUTO_TELEMETRY=0` or `DO_NOT_TRACK=1` still force it off. `reason:
"user_env"` means your value is in effect. The engine lives in the session
daemon, which keeps the environment it started with, so end it after a change:

```bash
mauto session end
mauto devices                                 # new daemon, new engine env
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
