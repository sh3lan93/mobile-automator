'use strict';

// The closed vocabularies telemetry's `oneOf` checks are built from
// (src/observe/accepts.js, applied at the wire by telemetryPayload).
//
// Hard-coded rather than derived from the code that produces the values, on
// purpose: derived-at-load would make the check agree with whatever the code
// does, including a bug that records caller text. tests/lint/telemetry-vocab-drift.test.js
// pins each list to its producer in BOTH directions instead, so a new event,
// verb or reason is noticed rather than silently dropped from telemetry.
//
// Arrays are frozen: the entries are ordinary indexed properties, so the freeze
// is real (unlike a frozen Set — see src/device/mobile-mcp-tools.js).

const os = require('os');

const OS_NAMES = Object.freeze([
  'aix',
  'darwin',
  'freebsd',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'android',
]);

// Every `event:` name the source records. Pinned by the drift guard.
const EVENT_NAMES = Object.freeze([
  'verb.end',
  'call.start',
  'call.end',
  'screenshot.on_failure',
  'screenshot.capture_failed',
  'crash.list',
  'crash.detected',
  'crash.probe_clear',
  'crash.probe_unscoped',
  'crash.probe_failed',
  'crash.probe_timeout',
  'daemon.start',
  'daemon.stop',
  'daemon.start_failure',
  'daemon.listen_failure',
  'daemon.connect_failure',
  'daemon.lock_conflict',
  'daemon.undeliverable',
  // Emitted by the flush path, which lands in a later slice-5 task; declared
  // now because its event shape is already exercised by unit tests.
  'telemetry.flush',
]);

// The values cli.js's preAction hook can record as `verb`: the TOP-LEVEL
// command commander resolved (`config get` records `config`). Commander's
// implicit `help` command, `--help` and `-V` run no preAction hook, so they
// record no verb at all and are deliberately absent. `crash` is registered only
// under MAUTO_OBSERVE=1 and is listed so it ships when the gate graduates.
const VERB_NAMES = Object.freeze([
  'elements',
  'screenshot',
  'validate',
  'tap',
  'type',
  'swipe',
  'press',
  'long-press',
  'double-tap',
  'launch',
  'install',
  'uninstall',
  'open-url',
  'orientation',
  'assert',
  'result',
  'setup',
  'config',
  'guide',
  'schema',
  'bootstrap',
  'memory',
  'init',
  'session',
  'devices',
  'crash',
  'mcp',
]);

// Why the daemon stopped. 'crash' is documented but not yet produced.
const STOP_REASONS = Object.freeze(['idle', 'signal', 'shutdown', 'crash', 'explicit']);

// Node/libuv errno names for this platform, plus our own ELOCKED (a lock
// conflict, recorded by src/device/session-daemon.js). Names only: the numeric codes an MCP
// server reports are not in this set and so never pass.
const ERROR_CODES = Object.freeze([...Object.keys(os.constants.errno), 'ELOCKED']);

module.exports = { OS_NAMES, EVENT_NAMES, VERB_NAMES, STOP_REASONS, ERROR_CODES };
