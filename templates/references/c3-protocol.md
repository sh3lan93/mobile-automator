# C3 Protocol — v1.0

The C3 protocol is the contract between the recorder sidecar and a
runtime instrumentation SDK that lives inside the app under test. The
recorder ships this protocol in v1.0 so that v1.1 SDKs (iOS Swift
Package, Android AAR) can be developed against a stable surface.

This v1.0 release does NOT ship any SDK. The sidecar exposes the
listener; SDK authors implement the client side against the contract
below.

## Scope

- Transport: TCP over loopback (`127.0.0.1`), line-delimited JSON.
- Direction of bytes: SDK is the TCP client; sidecar is the server.
- Both sides MAY send JSON lines after the handshake has succeeded.
- This document is normative for the protocol; the in-tree TCP listener
  at `tools/recorder/src/c3/tcp-listener.js` is the reference
  implementation.

## Transport

- TCP socket bound by the sidecar to `127.0.0.1` only. Non-loopback
  connections MUST be rejected at the socket layer (the sidecar
  destroys the socket without writing any response).
- Each message is a single JSON object encoded as UTF-8, terminated by
  a single line-feed byte (`\n`, U+000A). Carriage returns are not
  emitted; if a client emits CR-LF, the sidecar treats the CR as
  whitespace and ignores it.
- Messages MUST be small enough to fit comfortably in a single TCP
  segment in practice (the listener buffers per-connection and parses
  message-by-message; pathological multi-megabyte lines are NOT
  expected and MAY be rejected).
- The sidecar binds the listener to port 0 (OS-assigned). The chosen
  port is published via the discovery channel below.

## Discovery

The sidecar advertises the chosen TCP port through two channels. SDK
authors MUST pick at least one.

1. **Port file.** The sidecar writes a JSON file at
   `mobile-automator/.recorder/<session_id>/recorder.port` containing:

   ```json
   {
     "port": 53291,
     "v": 1,
     "session_id": "login_flow_2026_05_21"
   }
   ```

   The file is written before the listener accepts connections and
   removed during sidecar shutdown.

2. **Environment variable.** The sidecar exports
   `MOBILE_AUTOMATOR_RECORDER_PORT` in its own process tree. Child
   processes the sidecar spawns inherit this value. Host-side dev
   tooling that runs inside the same process tree as the sidecar MAY
   read it directly.

SDK-to-host reachability is the SDK author's responsibility. For
Android emulators or physical devices the SDK typically arranges
`adb reverse tcp:<port> tcp:<port>` so that connecting to `127.0.0.1`
inside the device reaches the host. For iOS Simulator, loopback is
shared with the host and no forwarding is needed. The protocol itself
treats these as out-of-scope.

## Handshake

The first line a client sends MUST be a handshake. Until the sidecar
has accepted a handshake, it ignores all other messages and treats any
malformed input as a fatal handshake failure.

Client sends:

```json
{
  "v": 1,
  "platform": "android",
  "app_id": "com.example.app",
  "sdk_version": "1.0.0"
}
```

- `v` (integer, required): protocol major version. v1.0 sidecars accept
  only `v: 1`.
- `platform` (string, required): one of `"android"` or `"ios"`.
- `app_id` (string, required): the application identifier on its OS
  (Android `applicationId`, iOS bundle identifier).
- `sdk_version` (string, required): SDK semver. Treated as informational
  by v1.0; reserved for future compatibility checks.

Sidecar replies on the same connection. On accept:

```json
{ "ok": true, "session_id": "login_flow_2026_05_21" }
```

On reject the sidecar writes a single line and closes the connection:

```json
{ "ok": false, "reason": "version_unsupported" }
```

Reason codes:

| Reason                  | Meaning                                                                      |
|-------------------------|------------------------------------------------------------------------------|
| `version_unsupported`   | `v` is not `1`.                                                              |
| `platform_mismatch`     | The sidecar was started with a target platform that differs from `platform`. |
| `app_id_mismatch`       | The sidecar was started with a target app id that differs from `app_id`.    |
| `malformed`             | The line did not parse as JSON, or required fields were missing.            |

Sidecars MAY add new reason codes in future minor revisions; clients
MUST treat unknown reasons as fatal.

## Event kinds

After a successful handshake the SDK pushes events. Each event is one
JSON object per line. Every event carries:

- `kind` (string, required): the event kind name.
- `t` (integer, required): milliseconds since session start, monotonic
  non-negative.

The sidecar MUST ignore unknown fields on every event (forward
compatibility). Unknown `kind` values are dropped with a `parse_error`
diagnostic on the sidecar side; the connection stays open.

Six event kinds are defined in v1.0.

### `tap`

A single tap. Coordinates are device-pixel coordinates from the SDK's
window origin (top-left).

```json
{
  "kind": "tap",
  "t": 1240,
  "x": 540,
  "y": 1090,
  "target_id": "login_button",
  "target_label": "Login"
}
```

- `x`, `y` (integer, required).
- `target_id` (string, optional): the SDK-resolved view/widget id.
- `target_label` (string, optional): a human-readable label for the
  view (text content, accessibility label, or similar).

### `swipe`

A directed swipe. The SDK MAY also send the gesture as a sequence of
sampled coordinates in a future revision; v1.0 records only endpoints.

```json
{
  "kind": "swipe",
  "t": 3300,
  "from": [540, 1300],
  "to": [540, 600],
  "duration_ms": 240
}
```

- `from`, `to` (`[integer, integer]`, required).
- `duration_ms` (integer, optional).

### `type`

A coalesced text input session into a single focused field. SDKs are
expected to coalesce keystrokes themselves (the C3 path skips the
sidecar's type-buffer module).

```json
{
  "kind": "type",
  "t": 2800,
  "value": "test@example.com",
  "field_id": "email_input",
  "field_label": "Email",
  "sensitive": false
}
```

- `value` (string, required): the final committed text for the field.
- `field_id`, `field_label` (string, optional).
- `sensitive` (boolean, optional): true if the field is a password or
  otherwise-protected input. Sidecar uses this to drive Save-time
  warnings.

### `key`

A hardware or system key press. Values are upper-snake-case symbolic
names matching mobile-mcp's button vocabulary.

```json
{
  "kind": "key",
  "t": 4100,
  "value": "BACK"
}
```

- `value` (string, required): one of `BACK`, `HOME`, `ENTER`,
  `VOLUME_UP`, `VOLUME_DOWN`, `POWER`, `MENU`. SDKs MAY emit values
  outside this set; the sidecar passes them through.

### `lifecycle`

An app or session lifecycle event observed by the SDK.

```json
{
  "kind": "lifecycle",
  "t": 0,
  "event": "app_launched"
}
```

- `event` (string, required): one of `app_launched`,
  `app_foregrounded`, `app_backgrounded`, `app_terminated`.

### `error`

A diagnostic from the SDK side that the sidecar SHOULD surface to the
user.

```json
{
  "kind": "error",
  "t": 7200,
  "message": "view hierarchy snapshot failed",
  "fatal": false
}
```

- `message` (string, required).
- `fatal` (boolean, optional): true if the SDK is about to disconnect
  because of this error.

## Sidecar-to-SDK commands

The sidecar MAY send commands on the same connection. Commands are
also line-delimited JSON. Each carries a `cmd` field (instead of
`kind`) so consumers can disambiguate.

### `snapshot_request`

```json
{
  "cmd": "snapshot_request",
  "t": 5000,
  "id": "snap_5000"
}
```

Requests that the SDK push a UI hierarchy snapshot. v1.0 sidecars
default to host-side hierarchy polling via mobile-mcp; SDKs MAY
implement this command in v1.1 to enable lower-latency snapshots. v1.0
SDKs SHOULD ignore unknown commands.

### `stop`

```json
{
  "cmd": "stop",
  "t": 12400
}
```

Instructs the SDK to stop sending events. SDKs SHOULD finish in-flight
sends and close the connection.

## Versioning rules

- The handshake's `v` integer is the major protocol version. Breaking
  changes bump `v`.
- Within v1, new event kinds, new commands, and new optional fields are
  additive. Both sides MUST ignore unknown fields and SHOULD ignore
  unknown event kinds (with a diagnostic).
- A new required field within an existing event kind is a breaking
  change and requires a `v` bump.
- The sidecar's listener identifies as v1 by accepting only
  `v: 1` handshakes. Clients targeting v1 sidecars MUST send `v: 1`.

## Reference behavior

The reference listener at `tools/recorder/src/c3/tcp-listener.js`:

- Binds to `127.0.0.1:0`.
- Validates the handshake against the constraints above.
- Emits a `'handshake'` event on accept and an `'event'` event for each
  subsequent JSON line.
- Tolerates malformed lines after handshake (emits `'parse_error'`,
  keeps the connection open).
- Closes connections that violate loopback-only or that fail handshake.

Integration tests in `tests/integration/recorder/c3-pipeline.test.js`
exercise the end-to-end shape, including the structural equivalence of
`events.jsonl` written via the C3 path versus the Mode B path.
