# Telemetry & Privacy

`mauto` collects **nothing** unless you turn telemetry on. This page describes
what it would collect if you did, exactly, field by field.

## The short version

- Off by default. No prompt, no banner, no opt-out flow — you turn it on or it
  stays off.
- No free text of any kind ever leaves your machine: no scenario ids, app
  package names, device serials, element labels, typed input or filesystem
  paths.
- No per-machine identifier. There is no install id, no device fingerprint and
  no user id. Events are anonymous and uncorrelated.
- Everything is spooled to a local file first. You can read it before it goes:
  `cat mobile-automator/.logs/telemetry.spool`.

## Turning it on and off

```bash
mauto telemetry status     # what is on, what would be sent, what is queued
mauto telemetry enable     # opt in
mauto telemetry disable    # opt back out
mauto telemetry flush      # upload what is queued now
```

`mauto telemetry enable` writes `telemetry.enabled: true` into
`mobile-automator/config.json`. `mauto config set telemetry.enabled true` does
the same thing.

Two environment variables override the config and always win:

| Variable | Effect |
|---|---|
| `MAUTO_TELEMETRY=0` | Disables telemetry regardless of config. |
| `DO_NOT_TRACK=1` | Disables telemetry regardless of config. |

`MAUTO_TELEMETRY=1` deliberately does **not** enable telemetry. An off-switch is
safe to honour from the environment; an on-switch is a way to turn collection on
for a machine — a CI image, a shared shell profile, an inherited Dockerfile —
whose owner never consented to it. Opting in happens in a file the project owner
edits.

## What is sent

These are the only fields that can ever cross the network. The list is enforced
by `src/observe/event.js`, which builds the payload by iterating this catalog
rather than by iterating the event — so a field nobody has classified is
*dropped*, never sent. `tests/lint/telemetry-docs.test.js` fails the build if
this table and that catalog disagree.

| Field | What it is |
|---|---|
| `ts` | ISO timestamp of the event. |
| `v` | Event schema version. |
| `mauto_version` | The `mauto` version that produced the event. |
| `node` | Node runtime version. |
| `os` | `process.platform` — `darwin`, `linux`, `win32`. |
| `level` | `debug`, `info`, `warn` or `error`. |
| `src` | `cli` or `daemon`. |
| `event` | The event name, e.g. `verb.end`, `call.end`, `daemon.start`. |
| `verb` | The `mauto` verb, taken from commander's resolved command — never from your command line. |
| `ok` | Whether the operation succeeded. |
| `error_kind` | The envelope's error taxonomy: `device`, `timeout`, `invalid_input`, … |
| `exit_code` | The process exit code. |
| `dur_ms` | How long it took. |
| `session_id` | A random id regenerated every time the device daemon starts. Not persisted, not derived from your machine. |
| `tool` | The mobile-mcp primitive behind the verb, checked against a pinned allowlist. |
| `call_id` | A monotonic per-call counter minted by the daemon, scoped to one daemon lifetime — pairs `call.start` and `call.end`. |
| `stop_reason` | Why the daemon stopped: `idle`, `signal`, `shutdown`, `crash`, `explicit`. |
| `error_code` | A Node/libuv errno string such as `EACCES`. |
| `crash_count` | Integer count of crash reports observed. |
| `msg_id` | A random per-event id used to deduplicate a re-sent batch. Never reused, so it cannot correlate two events. |
| `count` | An integer count, e.g. a batch size. |
| `http_status` | The HTTP status our own telemetry endpoint returned. |

## What is never sent

These fields exist in your **local** logs (`mobile-automator/.logs/`) and are
permanently barred from the network path. `tests/lint/telemetry-redaction.test.js`
fails the build if any of them is reclassified.

| Field | Why it stays local |
|---|---|
| `run_id` | Agent-chosen; routinely names an unreleased feature. |
| `scenario_id` | Names the feature you are testing. |
| `app_id` | An unreleased product's package name. |
| `device_id` | A hardware identifier / serial. |
| `device_model` | Narrows a device to an individual tester. |
| `project_name` | Your project's name. |
| `pid` | No aggregate value, and a weak host correlator alongside a timestamp. |
| `message` | Free text; may embed labels, paths or typed input. |
| `hint` | Free text; may embed filesystem paths. |
| `path` | A filesystem path; leaks usernames and project layout. |

## How it is delivered

Verbs never talk to the network. Every `mauto` verb ends by exiting, which tears
down a pending socket, so a verb that tried to POST would drop the event a large
fraction of the time and a verb that waited for one would add a network round
trip to every tap.

Instead a verb appends one line to `mobile-automator/.logs/telemetry.spool` —
that line is the exact payload that would be uploaded, nothing more — and the
device session daemon uploads it during its idle window. `mauto telemetry flush`
does it on demand. Nothing is retried forever: the spool is capped at 256 KiB,
at most three pending batches are kept, and failed uploads back off from one
minute to thirty.

Data goes to PostHog's EU cloud (`https://eu.i.posthog.com/batch/`) using their
plain HTTP capture API and a write-only public project token. No PostHog SDK is
installed; `mauto` has no analytics dependency.

## Reading the queue yourself

```bash
mauto telemetry status
cat mobile-automator/.logs/telemetry.spool
```

The spool is plain NDJSON — one upload payload per line. If you disagree with
anything in it, `mauto telemetry disable` and delete the file.
