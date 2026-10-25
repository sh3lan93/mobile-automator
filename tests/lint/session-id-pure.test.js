'use strict';

// src/device/session-id.js must require nothing but `crypto` (#196).
//
// Why. The event catalog (src/observe/event.js) imports SESSION_ID_PATTERN from
// it, and the device layer already imports observe/ (session-daemon.js,
// failure-probe.js, mobile-mcp-client.js). If session-id.js ever gained a local
// require whose graph reached back into observe/ — session-paths, say, the day
// it learns to log — the cycle could hand event.js a half-built exports object
// with SESSION_ID_PATTERN undefined. Nothing would fail at load: the session_id
// check would throw only when telemetryPayload() ran it, safeObserve
// (src/observe/recorder.js) would swallow the throw, and session_id telemetry
// would silently disappear.
//
// Because the allowed set contains no local module, checking this one file's
// direct requires is transitive by construction: `crypto` is a builtin and
// cannot require back into the repo. The scan is tests/lint/network-detector.js's
// analyze() — the repo's one specifier parser — so comments and strings are
// stripped, `node:crypto` normalises to `crypto`, relative specifiers are
// reported rather than dropped, and a computed `require(x)` is flagged as
// unverifiable instead of slipping through.

const fs = require('fs');
const path = require('path');

const { analyze, findNetworkUse } = require('./network-detector');

const REL = 'src/device/session-id.js';
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', REL), 'utf8');
const ALLOWED = ['crypto'];

describe(`${REL} stays dependency-free`, () => {
  const { specifiers, local, unverifiable } = analyze(SRC);

  it(`requires only ${ALLOWED.join(', ')} from outside the repo`, () => {
    const found = [...new Set(specifiers.map((s) => s.specifier))].sort();
    expect({ file: REL, requires: found }).toEqual({ file: REL, requires: ALLOWED });
  });

  it('requires no local module — any one could close a cycle with src/observe/event.js', () => {
    expect({ file: REL, localRequires: local.map((l) => `${l.via} '${l.raw}'`) }).toEqual({
      file: REL,
      localRequires: [],
    });
  });

  it('has no computed specifier — a require the scan cannot read cannot be held to the rule', () => {
    expect({ file: REL, unverifiable: unverifiable.map((u) => u.detail) }).toEqual({
      file: REL,
      unverifiable: [],
    });
  });

  // `const r = require; r('./x')`, createRequire, Module._load and eval load
  // modules without a call analyze() can read. findNetworkUse() already flags
  // every one of those; `crypto` itself raises nothing there.
  it('has no loader escape that would hide a require from the checks above', () => {
    expect({ file: REL, findings: findNetworkUse(SRC, REL) }).toEqual({ file: REL, findings: [] });
  });
});
