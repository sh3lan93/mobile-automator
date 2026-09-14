# mauto Observability — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the observability recorder seam — a single `record(event)` function with a redaction-guarded event catalog, a stderr sink and an NDJSON file sink, wired into the CLI's two exit paths — plus the workspace `.gitignore` that keeps device serials and stack traces out of users' repositories.

**Architecture:** One `src/observe/` module tree. `event.js` owns the field catalog (the single source of truth for what may cross a network, mirroring `action-catalog.js` / `capability-catalog.js`); `recorder.js` fans an event out to sinks and is failure-transparent; the sinks are pure consumers. The CLI is instrumented at `defaultEmit` and `emitRaw` only — the two functions that actually end a process — so every test that injects its own `emit` is unaffected. No new dependencies.

**Tech Stack:** Node.js (CommonJS), Commander, Jest. No new dependencies — this is a hard constraint, not a preference.

**Spec:** `docs/plans/2026-08-31-observability-design.md`

## Global Constraints

- **No new dependencies.** Cold start is ~112ms and one scenario is dozens of process spawns; a require-time cost is paid per tap. Nothing may be added to `package.json` `dependencies`.
- **stdout belongs exclusively to the verb's own output.** No sink may ever write to stdout. Diagnostics go to stderr and files only. This is the locked envelope invariant.
- **The recorder must never throw and never propagate.** A full disk, a read-only workspace, or an unserializable event must not fail `mauto tap`. Every sink call is individually guarded.
- **Fields are allowlisted, never denylisted.** `telemetryPayload()` serializes only `sends: true` catalog fields. A field absent from the catalog cannot be sent.
- **Slice 1 wires no network transport.** `telemetryPayload()` exists and is tested; nothing calls it over a socket until slice 5.
- **Reuse `session-log.js`'s rotation policy** (`MAX_LOG_BYTES`, 1 MiB, single generation). Do not introduce a second rotation constant.
- **Raw daemon stdio stays at `mobile-automator/.session/daemon.log`** (PR #176, merged). This slice adds `mobile-automator/.logs/` for structured events only. Do not move or touch the daemon log.
- **CI version gate:** this touches `src/`, so `package.json` `version` must be bumped to a value not yet in `git tag`. Under gate-then-graduate the target is `0.25.0-rc.0` (`main` is at 0.24.0).
- **Platform-agnostic:** never emit `resource-id` or OS-specific element IDs in any artifact.

---

### Task 1: Event model and the redaction catalog

The catalog is the safety mechanism for the whole feature. It is written first so every later task has a fixed vocabulary.

**Files:**
- Create: `src/observe/event.js`
- Test: `tests/unit/observe/event.test.js`
- Test: `tests/lint/telemetry-redaction.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `EVENT_VERSION: number`
  - `LEVELS: string[]` — `['debug','info','warn','error']`
  - `EVENT_FIELDS: Record<string, {sends: boolean, why: string}>`
  - `NEVER_SENDS: string[]` — field names that must always be `sends: false`
  - `makeEvent(fields: object) => object` — stamps `ts`/`v`/`mauto_version`/`node`/`os`, drops unknown keys
  - `telemetryPayload(event: object) => object` — keeps only `sends: true` keys

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/event.test.js`:

```js
'use strict';

const { makeEvent, telemetryPayload, EVENT_FIELDS, LEVELS } = require('../../../src/observe/event');

describe('makeEvent', () => {
  it('stamps the ambient fields', () => {
    const e = makeEvent({ event: 'verb.end', verb: 'tap', ok: true });
    expect(e.event).toBe('verb.end');
    expect(e.verb).toBe('tap');
    expect(typeof e.ts).toBe('string');
    expect(e.v).toBe(1);
    expect(e.mauto_version).toBe(require('../../../package.json').version);
    expect(e.node).toBe(process.version);
    expect(e.os).toBe(process.platform);
  });

  it('drops keys the catalog does not declare', () => {
    const e = makeEvent({ event: 'verb.end', smuggled: 'com.acme.secret' });
    expect(e).not.toHaveProperty('smuggled');
  });

  it('omits keys whose value is undefined rather than emitting null', () => {
    const e = makeEvent({ event: 'verb.end', dur_ms: undefined });
    expect(e).not.toHaveProperty('dur_ms');
  });
});

describe('telemetryPayload', () => {
  it('strips every sends:false field', () => {
    const e = makeEvent({
      event: 'verb.end',
      verb: 'launch',
      ok: false,
      error_kind: 'device',
      app_id: 'com.acme.unreleased',
      run_id: 'checkout-redesign-smoke',
      message: 'element "Buy now" not found',
    });
    const p = telemetryPayload(e);
    expect(p.verb).toBe('launch');
    expect(p.error_kind).toBe('device');
    expect(p).not.toHaveProperty('app_id');
    expect(p).not.toHaveProperty('run_id');
    expect(p).not.toHaveProperty('message');
  });

  it('never emits a key absent from the catalog even if present on the event', () => {
    const p = telemetryPayload({ event: 'verb.end', rogue: 'x' });
    expect(p).not.toHaveProperty('rogue');
  });
});

describe('catalog integrity', () => {
  it('declares sends and a reason for every field', () => {
    for (const [name, def] of Object.entries(EVENT_FIELDS)) {
      expect(typeof def.sends).toBe('boolean');
      expect(typeof def.why).toBe('string');
      expect(def.why.length).toBeGreaterThan(0);
    }
  });

  it('exposes the four levels in ascending severity', () => {
    expect(LEVELS).toEqual(['debug', 'info', 'warn', 'error']);
  });
});
```

Create `tests/lint/telemetry-redaction.test.js`:

```js
'use strict';

// Structural guard: no field that can carry user content may ever gain a
// network path. Scenario ids and app package names are users' unreleased
// product names; device ids are hardware identifiers. A denylist name that
// flips to sends:true fails HERE rather than shipping to a third party.

const { EVENT_FIELDS, NEVER_SENDS, telemetryPayload } = require('../../src/observe/event');

describe('telemetry redaction', () => {
  it('marks every known-sensitive field sends:false', () => {
    const leaked = NEVER_SENDS.filter((f) => EVENT_FIELDS[f] && EVENT_FIELDS[f].sends === true);
    expect(leaked).toEqual([]);
  });

  it('lists every sensitive field in the catalog so the denial is explicit', () => {
    const undeclared = NEVER_SENDS.filter((f) => !EVENT_FIELDS[f]);
    expect(undeclared).toEqual([]);
  });

  it('sends only enumerated values, counts and durations — never free text', () => {
    // A sends:true field must not be one whose value is caller-supplied prose.
    const FREE_TEXT = ['message', 'hint', 'summary', 'label', 'text', 'path'];
    const offending = Object.keys(EVENT_FIELDS)
      .filter((f) => EVENT_FIELDS[f].sends)
      .filter((f) => FREE_TEXT.some((t) => f === t || f.endsWith(`_${t}`)));
    expect(offending).toEqual([]);
  });

  it('drops sensitive values end-to-end', () => {
    const payload = telemetryPayload(
      Object.fromEntries(Object.keys(EVENT_FIELDS).map((k) => [k, `VALUE_${k}`]))
    );
    for (const f of NEVER_SENDS) {
      expect(payload).not.toHaveProperty(f);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/event.test.js tests/lint/telemetry-redaction.test.js`
Expected: FAIL — `Cannot find module '../../../src/observe/event'`

- [ ] **Step 3: Write the implementation**

Create `src/observe/event.js`:

```js
'use strict';

// Single source of truth for every field a mauto observability event can
// carry, and — critically — whether that field may ever cross a network.
//
// This mirrors src/device/action-catalog.js and src/result/capability-catalog.js:
// one entry per item, consumed by a lint guard (tests/lint/telemetry-redaction.test.js)
// so a field that gains a network path fails the build instead of silently
// shipping a user's unreleased app id to a third party.
//
//   sends: true  — may appear in slice 5's telemetry payload. Only enumerated
//                  values, counts, versions and durations qualify.
//   sends: false — local logs only. telemetryPayload() cannot serialize it.
//
// The allowlist direction is deliberate: a field nobody has classified is
// silently DROPPED from telemetry rather than silently sent.

const pkg = require('../../package.json');

const EVENT_VERSION = 1;

// Ascending severity. Index order is the comparison order.
const LEVELS = ['debug', 'info', 'warn', 'error'];

const EVENT_FIELDS = {
  // --- ambient, stamped by makeEvent -------------------------------------
  ts: { sends: true, why: 'ISO timestamp; carries no user content' },
  v: { sends: true, why: 'event schema version' },
  mauto_version: { sends: true, why: 'our own package version' },
  node: { sends: true, why: 'node runtime version' },
  os: { sends: true, why: 'process.platform; one of a fixed set' },

  // --- classification ----------------------------------------------------
  level: { sends: true, why: 'enumerated: debug|info|warn|error' },
  src: { sends: true, why: 'enumerated: cli|daemon' },
  event: { sends: true, why: 'enumerated event name' },

  // --- outcome -----------------------------------------------------------
  verb: { sends: true, why: 'the mauto verb name; a fixed vocabulary we ship' },
  ok: { sends: true, why: 'boolean outcome' },
  error_kind: { sends: true, why: 'enumerated envelope taxonomy (device|timeout|...)' },
  exit_code: { sends: true, why: 'enumerated exit code' },
  dur_ms: { sends: true, why: 'duration; carries no user content' },

  // --- local only: every one of these can carry user content -------------
  run_id: { sends: false, why: 'agent-chosen; routinely names an unreleased feature' },
  scenario_id: { sends: false, why: "names the user's feature under test" },
  app_id: { sends: false, why: "an unreleased product's package name" },
  device_id: { sends: false, why: 'hardware identifier / serial' },
  device_model: { sends: false, why: 'narrows a device to an individual tester' },
  project_name: { sends: false, why: "the user's project name" },
  message: { sends: false, why: 'free text; may embed labels, paths, typed input' },
  hint: { sends: false, why: 'free text; may embed filesystem paths' },
  path: { sends: false, why: 'filesystem path; leaks usernames and project layout' },
};

// Names that must ALWAYS be sends:false. Kept separate from EVENT_FIELDS so
// the guard tests a stated intention against the catalog rather than reading
// the catalog and agreeing with itself.
const NEVER_SENDS = [
  'run_id',
  'scenario_id',
  'app_id',
  'device_id',
  'device_model',
  'project_name',
  'message',
  'hint',
  'path',
];

// Build an event from caller fields. Unknown keys are dropped (not an error:
// a caller that invents a field must not be able to smuggle it into a log),
// and undefined values are omitted so events stay sparse rather than
// null-padded.
function makeEvent(fields = {}) {
  const out = {
    ts: new Date().toISOString(),
    v: EVENT_VERSION,
    mauto_version: pkg.version,
    node: process.version,
    os: process.platform,
  };
  for (const [k, val] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(EVENT_FIELDS, k)) continue;
    if (val === undefined) continue;
    out[k] = val;
  }
  return out;
}

// The ONLY function permitted to build a network payload. Allowlist by
// construction: it iterates the catalog, never the event.
function telemetryPayload(event = {}) {
  const out = {};
  for (const [name, def] of Object.entries(EVENT_FIELDS)) {
    if (!def.sends) continue;
    if (!Object.prototype.hasOwnProperty.call(event, name)) continue;
    if (event[name] === undefined) continue;
    out[name] = event[name];
  }
  return out;
}

module.exports = { EVENT_VERSION, LEVELS, EVENT_FIELDS, NEVER_SENDS, makeEvent, telemetryPayload };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/observe/event.test.js tests/lint/telemetry-redaction.test.js`
Expected: PASS, 11 tests (7 unit + 4 lint)

- [ ] **Step 5: Commit**

```bash
git add src/observe/event.js tests/unit/observe/event.test.js tests/lint/telemetry-redaction.test.js
git commit -m "feat(observe): event model with a lint-guarded redaction catalog"
```

---

### Task 2: Paths and settings

**Files:**
- Create: `src/observe/paths.js`
- Create: `src/observe/settings.js`
- Test: `tests/unit/observe/paths.test.js`
- Test: `tests/unit/observe/settings.test.js`

**Interfaces:**
- Consumes: `LEVELS` from `src/observe/event.js`.
- Produces:
  - `paths.LOGS_DIRNAME: '.logs'`
  - `paths.logsDir(projectRoot, env?) => string`
  - `paths.mainLogPath(projectRoot, env?) => string`
  - `settings.resolveLevels(env?) => { stderr: string|null, file: string|null }`
  - `settings.atLeast(level, threshold) => boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/paths.test.js`:

```js
'use strict';

const path = require('path');
const paths = require('../../../src/observe/paths');

describe('observe paths', () => {
  it('defaults to mobile-automator/.logs inside the workspace', () => {
    expect(paths.logsDir('/proj', {})).toBe(path.join('/proj', 'mobile-automator', '.logs'));
  });

  it('honours MAUTO_LOG_DIR and resolves it to an absolute path', () => {
    const got = paths.logsDir('/proj', { MAUTO_LOG_DIR: '/tmp/elsewhere' });
    expect(got).toBe(path.resolve('/tmp/elsewhere'));
  });

  it('names the main log mauto.ndjson', () => {
    expect(paths.mainLogPath('/proj', {})).toBe(
      path.join('/proj', 'mobile-automator', '.logs', 'mauto.ndjson')
    );
  });

  it('is side-effect free — resolving a path creates nothing', () => {
    const fs = require('fs');
    const target = paths.logsDir('/definitely/not/real', {});
    expect(fs.existsSync(target)).toBe(false);
  });
});
```

Create `tests/unit/observe/settings.test.js`:

```js
'use strict';

const { resolveLevels, atLeast } = require('../../../src/observe/settings');

describe('resolveLevels', () => {
  it('defaults to warn on stderr and info in the file', () => {
    expect(resolveLevels({})).toEqual({ stderr: 'warn', file: 'info' });
  });

  it('applies an explicit level to both sinks', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'debug' })).toEqual({ stderr: 'debug', file: 'debug' });
  });

  it('is case-insensitive', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'DEBUG' })).toEqual({ stderr: 'debug', file: 'debug' });
  });

  it('silences both sinks on silent', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'silent' })).toEqual({ stderr: null, file: null });
  });

  it('falls back to the default on an unrecognised value rather than throwing', () => {
    expect(resolveLevels({ MAUTO_LOG_LEVEL: 'chatty' })).toEqual({ stderr: 'warn', file: 'info' });
  });
});

describe('atLeast', () => {
  it('passes an event at or above the threshold', () => {
    expect(atLeast('error', 'warn')).toBe(true);
    expect(atLeast('warn', 'warn')).toBe(true);
  });

  it('rejects an event below the threshold', () => {
    expect(atLeast('debug', 'info')).toBe(false);
  });

  it('rejects everything when the threshold is null', () => {
    expect(atLeast('error', null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/paths.test.js tests/unit/observe/settings.test.js`
Expected: FAIL — `Cannot find module '../../../src/observe/paths'`

- [ ] **Step 3: Write the implementations**

Create `src/observe/paths.js`:

```js
'use strict';

// Pure path helpers for the structured event logs. Side-effect-free so they
// can be unit-tested without touching the filesystem, matching
// src/device/session-paths.js.
//
// NOTE: this is NOT where the daemon's raw stdio goes. That lives at
// mobile-automator/.session/daemon.log (session-paths.logFilePath, PR #176).
// Two artifacts, two homes: raw process output there, structured events here.

const path = require('path');

const LOGS_DIRNAME = '.logs';
const MAIN_LOG_NAME = 'mauto.ndjson';

function logsDir(projectRoot, env = process.env) {
  if (env && env.MAUTO_LOG_DIR) return path.resolve(env.MAUTO_LOG_DIR);
  return path.join(projectRoot, 'mobile-automator', LOGS_DIRNAME);
}

function mainLogPath(projectRoot, env = process.env) {
  return path.join(logsDir(projectRoot, env), MAIN_LOG_NAME);
}

module.exports = { LOGS_DIRNAME, MAIN_LOG_NAME, logsDir, mainLogPath };
```

Create `src/observe/settings.js`:

```js
'use strict';

// Resolves the observability control surface from the environment.
//
// Defaults are asymmetric on purpose: stderr is a HUMAN's channel during an
// interactive run, so it stays quiet at `warn`; the file is a forensic record
// nobody reads unless something broke, so it keeps `info`. One MAUTO_LOG_LEVEL
// overrides both, because a user debugging wants the same detail in both
// places and a second env var to remember is a worse interface.

const { LEVELS } = require('./event');

const DEFAULT_STDERR_LEVEL = 'warn';
const DEFAULT_FILE_LEVEL = 'info';

function resolveLevels(env = process.env) {
  const raw = String((env && env.MAUTO_LOG_LEVEL) || '').toLowerCase();
  if (raw === 'silent') return { stderr: null, file: null };
  if (LEVELS.includes(raw)) return { stderr: raw, file: raw };
  // Unrecognised values fall back rather than throw: a typo in an env var must
  // never break `mauto tap`.
  return { stderr: DEFAULT_STDERR_LEVEL, file: DEFAULT_FILE_LEVEL };
}

// True when `level` is at or above `threshold`. A null threshold means the
// sink is off, so nothing passes.
function atLeast(level, threshold) {
  if (!threshold) return false;
  const a = LEVELS.indexOf(level);
  const b = LEVELS.indexOf(threshold);
  if (a === -1 || b === -1) return false;
  return a >= b;
}

module.exports = { DEFAULT_STDERR_LEVEL, DEFAULT_FILE_LEVEL, resolveLevels, atLeast };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/observe/paths.test.js tests/unit/observe/settings.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/observe/paths.js src/observe/settings.js tests/unit/observe/paths.test.js tests/unit/observe/settings.test.js
git commit -m "feat(observe): log paths and level resolution"
```

---

### Task 3: The stderr and file sinks

**Files:**
- Create: `src/observe/sinks/stderr.js`
- Create: `src/observe/sinks/file.js`
- Test: `tests/unit/observe/sinks.test.js`

**Interfaces:**
- Consumes: `paths.mainLogPath`, and `MAX_LOG_BYTES` from `src/device/session-log.js`.
- Produces:
  - `stderrSink.write(event, {stream?}) => void`
  - `fileSink.write(event, {projectRoot, env?, fs?}) => void`
  - `fileSink.format(event) => string` — the NDJSON line, exported for testing

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/sinks.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const stderrSink = require('../../../src/observe/sinks/stderr');
const fileSink = require('../../../src/observe/sinks/file');
const { MAX_LOG_BYTES } = require('../../../src/device/session-log');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-observe-'));
}

describe('stderr sink', () => {
  it('writes a single readable line to the injected stream', () => {
    const written = [];
    stderrSink.write(
      { ts: '2026-09-01T00:00:00.000Z', level: 'warn', event: 'verb.end', verb: 'tap', ok: false },
      { stream: { write: (s) => written.push(s) } }
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^\[warn\] verb\.end verb=tap ok=false\n$/);
  });

  it('never writes to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSink.write({ level: 'error', event: 'x' }, { stream: { write() {} } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('file sink', () => {
  it('appends one JSON object per line', () => {
    const root = workspace();
    fileSink.write({ level: 'info', event: 'verb.end', verb: 'tap' }, { projectRoot: root, env: {} });
    fileSink.write({ level: 'info', event: 'verb.end', verb: 'swipe' }, { projectRoot: root, env: {} });

    const logPath = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).verb).toBe('tap');
    expect(JSON.parse(lines[1]).verb).toBe('swipe');
  });

  it('creates the log directory on demand', () => {
    const root = workspace();
    fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.logs'))).toBe(true);
  });

  it('rotates to .1 at the shared 1 MiB cap, keeping one generation', () => {
    const root = workspace();
    const dir = path.join(root, 'mobile-automator', '.logs');
    const logPath = path.join(dir, 'mauto.ndjson');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logPath, 'x'.repeat(MAX_LOG_BYTES));

    fileSink.write({ level: 'info', event: 'after-rotate' }, { projectRoot: root, env: {} });

    expect(fs.statSync(`${logPath}.1`).size).toBe(MAX_LOG_BYTES);
    expect(fs.readFileSync(logPath, 'utf8')).toContain('after-rotate');
  });

  it('swallows a write failure instead of throwing', () => {
    const boom = {
      mkdirSync() { throw new Error('EROFS: read-only file system'); },
      statSync() { throw new Error('nope'); },
      appendFileSync() { throw new Error('nope'); },
      renameSync() { throw new Error('nope'); },
    };
    expect(() =>
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: '/x', env: {}, fs: boom })
    ).not.toThrow();
  });

  it('emits a parseable line for an event containing a quote', () => {
    const line = fileSink.format({ level: 'info', event: 'e', message: 'said "hi"\nnewline' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line).message).toBe('said "hi"\nnewline');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/sinks.test.js`
Expected: FAIL — `Cannot find module '../../../src/observe/sinks/stderr'`

- [ ] **Step 3: Write the implementations**

Create `src/observe/sinks/stderr.js`:

```js
'use strict';

// Human-facing sink for interactive debugging. STDERR ONLY — stdout is owned
// exclusively by the verb's envelope (or its raw guide/schema output), and a
// single stray stdout write silently breaks the contract every calling agent
// depends on. The stream is injected so a test can prove that.

const SKIP = new Set(['ts', 'v', 'mauto_version', 'node', 'os', 'level', 'event']);

function write(event = {}, { stream = process.stderr } = {}) {
  const parts = [`[${event.level || 'info'}]`, event.event || 'event'];
  for (const [k, v] of Object.entries(event)) {
    if (SKIP.has(k)) continue;
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${v}`);
  }
  stream.write(parts.join(' ') + '\n');
}

module.exports = { write };
```

Create `src/observe/sinks/file.js`:

```js
'use strict';

// NDJSON sink: one JSON object per line, append-only, so a log is greppable,
// streamable, and parseable a line at a time even if the process died mid-file.
//
// Bounded by session-log.js's MAX_LOG_BYTES rather than a constant of its own,
// so the codebase has ONE rotation policy. Single generation (.1), matching
// the daemon log — enough to survive a crash loop, cheap to reason about.
//
// Every filesystem operation is guarded: a read-only workspace or a full disk
// must degrade to "no logging", never to a failed `mauto tap`.

const realFs = require('fs');
const path = require('path');

const { mainLogPath } = require('../paths');
const { MAX_LOG_BYTES } = require('../../device/session-log');

function format(event) {
  return JSON.stringify(event) + '\n';
}

function rotateIfLarge(logPath, fs) {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch (_) {
    return; // not present yet — nothing to rotate
  }
  if (size >= MAX_LOG_BYTES) fs.renameSync(logPath, `${logPath}.1`);
}

function write(event, { projectRoot, env = process.env, fs = realFs } = {}) {
  try {
    const logPath = mainLogPath(projectRoot, env);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    rotateIfLarge(logPath, fs);
    fs.appendFileSync(logPath, format(event));
  } catch (_) {
    // Observability must never be load-bearing. Losing a log line is always
    // preferable to failing the verb the user actually asked for.
  }
}

module.exports = { format, write };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/observe/sinks.test.js`
Expected: PASS, 7 tests (2 stderr + 5 file)

- [ ] **Step 5: Commit**

```bash
git add src/observe/sinks tests/unit/observe/sinks.test.js
git commit -m "feat(observe): stderr and NDJSON file sinks"
```

---

### Task 4: The recorder

**Files:**
- Create: `src/observe/recorder.js`
- Test: `tests/unit/observe/recorder.test.js`

**Interfaces:**
- Consumes: `makeEvent` (Task 1), `resolveLevels`/`atLeast` (Task 2), both sinks (Task 3).
- Produces: `record(fields, opts?) => void` where `opts` is `{projectRoot?, env?, sinks?}`. Returns nothing and throws nothing, ever.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/observe/recorder.test.js`:

```js
'use strict';

const { record } = require('../../../src/observe/recorder');

function collector() {
  const seen = [];
  return { seen, write: (e) => seen.push(e) };
}

describe('record', () => {
  it('fans an event out to every sink', () => {
    const a = collector();
    const b = collector();
    record({ level: 'error', event: 'verb.end', verb: 'tap' }, { sinks: [a, b], env: {} });
    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(1);
    expect(a.seen[0].verb).toBe('tap');
  });

  it('stamps the ambient fields via makeEvent', () => {
    const a = collector();
    record({ level: 'error', event: 'verb.end' }, { sinks: [a], env: {} });
    expect(a.seen[0].v).toBe(1);
    expect(typeof a.seen[0].ts).toBe('string');
  });

  it('drops an event below the resolved threshold', () => {
    const a = collector();
    // Default stderr threshold is warn, so a debug event must not reach it.
    record({ level: 'debug', event: 'noisy' }, { sinks: [a], env: {} });
    expect(a.seen).toHaveLength(0);
  });

  it('passes a debug event through when MAUTO_LOG_LEVEL=debug', () => {
    const a = collector();
    record({ level: 'debug', event: 'noisy' }, { sinks: [a], env: { MAUTO_LOG_LEVEL: 'debug' } });
    expect(a.seen).toHaveLength(1);
  });

  it('drops everything when MAUTO_LOG_LEVEL=silent', () => {
    const a = collector();
    record({ level: 'error', event: 'boom' }, { sinks: [a], env: { MAUTO_LOG_LEVEL: 'silent' } });
    expect(a.seen).toHaveLength(0);
  });

  it('defaults an event with no level to info', () => {
    const a = collector();
    record({ event: 'plain' }, { sinks: [a], env: { MAUTO_LOG_LEVEL: 'info' } });
    expect(a.seen[0].level).toBe('info');
  });

  it('isolates a throwing sink so its neighbour still receives the event', () => {
    const bad = { write() { throw new Error('sink exploded'); } };
    const good = collector();
    expect(() =>
      record({ level: 'error', event: 'e' }, { sinks: [bad, good], env: {} })
    ).not.toThrow();
    expect(good.seen).toHaveLength(1);
  });

  it('never throws even when the event itself is hostile', () => {
    const cyclic = { level: 'error', event: 'e' };
    cyclic.self = cyclic;
    expect(() => record(cyclic, { sinks: [], env: {} })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/observe/recorder.test.js`
Expected: FAIL — `Cannot find module '../../../src/observe/recorder'`

- [ ] **Step 3: Write the implementation**

Create `src/observe/recorder.js`:

```js
'use strict';

// The single seam. Everything that wants to be observable calls record().
//
// Two properties are load-bearing and both are tested:
//
//   1. It never throws and never propagates. Observability is not allowed to
//      be the reason a verb fails, so each sink is individually guarded and
//      the whole body is wrapped again. A throwing sink must not deprive its
//      neighbours of the event.
//   2. It writes nothing to stdout. That is a property of the sinks, but the
//      recorder is where the sink list is chosen, so it is the enforcement
//      point for which sinks exist at all.
//
// Level filtering happens here rather than in the sinks because the two sinks
// have DIFFERENT thresholds (stderr warn, file info) and only the recorder
// knows which sink it is currently feeding.

const { makeEvent } = require('./event');
const { resolveLevels, atLeast } = require('./settings');
const stderrSink = require('./sinks/stderr');
const fileSink = require('./sinks/file');

function defaultSinks(projectRoot, env) {
  const levels = resolveLevels(env);
  return [
    { threshold: levels.stderr, write: (e) => stderrSink.write(e) },
    { threshold: levels.file, write: (e) => fileSink.write(e, { projectRoot, env }) },
  ];
}

function record(fields = {}, { projectRoot = process.cwd(), env = process.env, sinks } = {}) {
  try {
    const level = fields.level || 'info';
    const list = sinks || defaultSinks(projectRoot, env);
    // An injected sink with no threshold of its own is filtered against the
    // resolved stderr threshold, so tests exercise the real gate rather than
    // an unfiltered bypass.
    const fallback = resolveLevels(env).stderr;
    const event = makeEvent({ ...fields, level });

    for (const sink of list) {
      const threshold = sink.threshold === undefined ? fallback : sink.threshold;
      if (!atLeast(level, threshold)) continue;
      try {
        sink.write(event);
      } catch (_) {
        // One bad sink must not deprive the others.
      }
    }
  } catch (_) {
    // Belt and suspenders: a hostile event (cyclic, exotic getters) must not
    // escape as an exception into the verb's own control flow.
  }
}

module.exports = { record, defaultSinks };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/observe/recorder.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/observe/recorder.js tests/unit/observe/recorder.test.js
git commit -m "feat(observe): failure-transparent recorder with per-sink thresholds"
```

---

### Task 5: Wire the CLI, and guard stdout

This is the task that could break the envelope contract, so its guard is written first and is the most important test in the slice.

**Files:**
- Modify: `src/cli.js` — `defaultEmit` (`:1626`) and `emitRaw` (`:1633`); add a module-level start timestamp near the top of the file
- Test: `tests/integration/stdout-purity.test.js`
- Test: `tests/unit/observe/cli-wiring.test.js`

**Interfaces:**
- Consumes: `record` from `src/observe/recorder.js`.
- Produces: no new exports. `defaultEmit` and `emitRaw` keep their exact signatures — `defaultEmit({envelope, exitKind}, human)` and `emitRaw(content, exitKind)`.

- [ ] **Step 1: Write the failing guards**

Create `tests/integration/stdout-purity.test.js`:

```js
'use strict';

// THE guard for the locked envelope invariant. Logging must never contaminate
// stdout, which the calling agent parses. Split by verb class because the two
// classes have genuinely different stdout contracts:
//   - envelope verbs emit exactly one JSON object
//   - raw verbs (guide/schema/bootstrap) emit markdown/JSON with NO envelope
// Both must hold at EVERY log level, which is what catches a stray sink write.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'mauto.js');

function runCli(args, env = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-purity-'));
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ws,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

describe('stdout purity (integration)', () => {
  describe.each(LEVELS)('at MAUTO_LOG_LEVEL=%s', (level) => {
    it('an envelope verb emits exactly one JSON object on stdout', () => {
      const { stdout } = runCli(['config', 'get', 'mode'], { MAUTO_LOG_LEVEL: level });
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
      expect(JSON.parse(lines[0])).toHaveProperty('schema_version');
    });

    it('a raw verb emits markdown identical to the silent baseline', () => {
      const baseline = runCli(['guide', 'setup'], { MAUTO_LOG_LEVEL: 'silent' }).stdout;
      const got = runCli(['guide', 'setup'], { MAUTO_LOG_LEVEL: level }).stdout;
      expect(got).toBe(baseline);
    });

    it('a parse error still emits exactly one JSON object on stdout', () => {
      const { stdout } = runCli(['--nope'], { MAUTO_LOG_LEVEL: level });
      const lines = stdout.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });
  });

  it('emits diagnostics on stderr when the level asks for them', () => {
    const { stderr } = runCli(['config', 'get', 'mode'], { MAUTO_LOG_LEVEL: 'debug' });
    expect(stderr).toContain('verb.end');
  });
});
```

Create `tests/unit/observe/cli-wiring.test.js`:

```js
'use strict';

// Structural drift guard. Both process-ending paths must stay instrumented:
// defaultEmit covers the envelope verbs, emitRaw covers guide/schema/bootstrap.
// Deleting either hook silently blinds a whole class of invocation, which no
// behavioural test would notice because the verb still works.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'cli.js'),
  'utf8'
);

function bodyBetween(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  const b = SRC.indexOf(endMarker);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return SRC.slice(a, b);
}

describe('cli wiring', () => {
  it('requires the recorder', () => {
    expect(SRC).toContain("require('./observe/recorder')");
  });

  it('instruments defaultEmit — the envelope exit path', () => {
    expect(bodyBetween('function defaultEmit', 'function emitRaw')).toContain('record(');
  });

  it('instruments emitRaw — the guide/schema/bootstrap exit path', () => {
    expect(bodyBetween('function emitRaw', 'function diagnose')).toContain('record(');
  });

  it('measures duration from a module-level start stamp, not a per-call clock', () => {
    expect(SRC).toMatch(/const PROCESS_START_MS = Date\.now\(\);/);
  });

  it('records before writing stdout, since process.exit is immediate', () => {
    const body = bodyBetween('function defaultEmit', 'function emitRaw');
    expect(body.indexOf('record(')).toBeLessThan(body.indexOf('process.stdout.write'));
  });
});
```

- [ ] **Step 2: Run the guards to verify they fail**

Run: `npx jest tests/integration/stdout-purity.test.js tests/unit/observe/cli-wiring.test.js`
Expected: FAIL — the `cli-wiring` structural assertions fail (`record(` absent); the `debug` stderr assertion fails (no `verb.end` on stderr).

- [ ] **Step 3: Wire the CLI**

In `src/cli.js`, add near the other top-of-file requires:

```js
const { record } = require('./observe/recorder');

// Stamped at require time, which for a one-shot verb is process start. There
// is no in-memory span tree to hang a timer on — each verb is a fresh process
// that exits — so the module load itself is the clock's zero point.
const PROCESS_START_MS = Date.now();
```

Replace `defaultEmit` (currently at `:1626`) with:

```js
function defaultEmit({ envelope, exitKind }, human) {
  // Record BEFORE the write: process.exit() below is immediate and would cut
  // off any work queued after it.
  record({
    event: 'verb.end',
    level: envelope && envelope.ok ? 'info' : 'warn',
    src: 'cli',
    verb: process.argv[2],
    ok: Boolean(envelope && envelope.ok),
    error_kind: envelope && envelope.error ? envelope.error.kind : undefined,
    exit_code: exitCodeFor(exitKind),
    dur_ms: Date.now() - PROCESS_START_MS,
  });
  process.stdout.write(render(envelope, { human }) + '\n');
  process.exit(exitCodeFor(exitKind));
}
```

Replace `emitRaw` (currently at `:1633`) with:

```js
// Print raw content (markdown / JSON schema / text) verbatim — no envelope
// wrapping — then exit. Used by guide/schema/bootstrap success paths.
function emitRaw(content, exitKind) {
  // Instrumented separately from defaultEmit: this path never builds an
  // envelope, so an emit-only hook would leave every guide/schema/bootstrap
  // invocation unrecorded.
  record({
    event: 'verb.end',
    level: 'info',
    src: 'cli',
    verb: process.argv[2],
    ok: true,
    exit_code: exitCodeFor(exitKind),
    dur_ms: Date.now() - PROCESS_START_MS,
  });
  process.stdout.write(content.endsWith('\n') ? content : content + '\n');
  process.exit(exitCodeFor(exitKind));
}
```

- [ ] **Step 4: Run the guards to verify they pass**

Run: `npx jest tests/integration/stdout-purity.test.js tests/unit/observe/cli-wiring.test.js`
Expected: PASS, 21 tests (16 integration = 5 levels x 3, plus 1; 5 wiring)

- [ ] **Step 5: Run the FULL suite — this task modifies a hot file**

Run: `npm test`
Expected: all suites pass. If `tests/unit/cli.test.js` or `cli-envelope-boundary.test.js` fail, the cause is almost certainly a test that injects its own `emit` and now sees an unexpected filesystem write — fix by passing `MAUTO_LOG_LEVEL=silent` in that test's env, not by weakening the wiring.

- [ ] **Step 6: Commit**

```bash
git add src/cli.js tests/integration/stdout-purity.test.js tests/unit/observe/cli-wiring.test.js
git commit -m "feat(observe): record verb outcomes at both CLI exit paths

Guards stdout purity per verb class at every log level."
```

---

### Task 6: Workspace .gitignore, version bump, changelog

`mauto setup` has never written a `.gitignore`, so a user's `mobile-automator/.session/` — which since PR #176 contains `daemon.log` with device serials, adb output and stack traces — sits untracked-but-unignored where `git add -A` sweeps it up. This slice adds `.logs/`, so it carries the fix.

**Files:**
- Modify: `src/setup/scaffold.js`
- Test: `tests/unit/setup/scaffold.test.js` (extend)
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `scaffold()`'s returned `created[]` now includes the `.gitignore` path on first write.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/setup/scaffold.test.js`:

```js
describe('workspace .gitignore', () => {
  it('writes mobile-automator/.gitignore covering the runtime dirs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    scaffold(root, { mode: 'platform-aware' });

    const gi = path.join(root, 'mobile-automator', '.gitignore');
    const body = fs.readFileSync(gi, 'utf8');
    expect(body).toContain('.session/');
    expect(body).toContain('.logs/');
    expect(body).toContain('screenshots/');
  });

  it('reports the .gitignore in created[] on first write', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    const { created } = scaffold(root, { mode: 'platform-aware' });
    expect(created.some((p) => p.endsWith(path.join('mobile-automator', '.gitignore')))).toBe(true);
  });

  it('never clobbers a .gitignore the user has edited', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    const gi = path.join(root, 'mobile-automator', '.gitignore');
    fs.writeFileSync(gi, '# mine\n');

    scaffold(root, { mode: 'platform-aware' });

    expect(fs.readFileSync(gi, 'utf8')).toBe('# mine\n');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/setup/scaffold.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open '.../mobile-automator/.gitignore'`

- [ ] **Step 3: Write the implementation**

In `src/setup/scaffold.js`, add above `scaffold()`:

```js
// Runtime artifacts that must never reach a user's git history. `.session/`
// has held a socket, pidfile and handle since the CLI landed; since #163 it
// also holds daemon.log, which carries device serials, adb/simctl output and
// stack traces. `.logs/` holds the structured event stream. Neither is
// reproducible input and both are noise in a diff.
//
// Written only when absent: a user who edits this file owns it thereafter.
const GITIGNORE_BODY = [
  '# Managed by `mauto setup`. Runtime artifacts — not source.',
  '.session/',
  '.logs/',
  'screenshots/',
  '',
].join('\n');
```

and inside `scaffold()`, after the `for (const sub of SUBDIRS)` loop:

```js
  const gitignorePath = path.join(baseDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_BODY);
    created.push(gitignorePath);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/setup/scaffold.test.js`
Expected: PASS

- [ ] **Step 5: Bump the version and write the changelog**

The CI gate `Verify version is bumped` fails any PR touching `src/` without a version not already tagged. `main` is at 0.24.0, and this is slice 1 of 5 under gate-then-graduate.

In `package.json`, set `"version": "0.25.0-rc.0"`, then:

```bash
npm install --package-lock-only
```

In `CHANGELOG.md`, add under `## [Unreleased]`:

```markdown
### Added
- Observability recorder seam (`src/observe/`): a single `record(event)` with a
  redaction-guarded event catalog, a stderr sink and an NDJSON file sink at
  `mobile-automator/.logs/mauto.ndjson`. Verb outcomes and measured durations
  are recorded at both CLI exit paths.
- `MAUTO_LOG_LEVEL` (`silent|error|warn|info|debug`; default `warn` on stderr,
  `info` in the file) and `MAUTO_LOG_DIR`.
- `mauto setup` now writes `mobile-automator/.gitignore`, keeping `.session/`
  (which since 0.24.0 holds `daemon.log` with device serials and stack traces),
  `.logs/` and `screenshots/` out of users' repositories.
```

- [ ] **Step 6: Run the full verification set and SHOW the output**

```bash
npm test
npm run lint:guides
npm run lint:schema-additive
./scripts/pack-smoke.sh
```

Expected: all green. Do not claim completion without pasting this output — the project's workflow requires evidence before any success claim.

- [ ] **Step 7: Commit and open a draft PR**

```bash
git add src/setup/scaffold.js tests/unit/setup/scaffold.test.js package.json package-lock.json CHANGELOG.md
git commit -m "feat(setup): write mobile-automator/.gitignore; bump to 0.25.0-rc.0"
git push -u origin sh3lan93/observability
```

Then open the draft PR with this body (fill the test-plan numbers from the
Step 6 output — do not invent them):

```bash
gh pr create --draft \
  --title "feat(observe): recorder seam, stderr + NDJSON sinks, workspace .gitignore" \
  --body "$(cat <<'BODY'
## What

Slice 1 of the observability design: the `record(event)` seam, a
redaction-guarded event catalog, a stderr sink and an NDJSON file sink at
\`mobile-automator/.logs/mauto.ndjson\`. Verb name, outcome, error kind, exit
code and a **measured** duration are now recorded at both CLI exit paths.
Also writes \`mobile-automator/.gitignore\` during \`mauto setup\`.

## Why

The CLI had no observability at all: zero \`console.*\` calls and nothing that
measures time. PR #176 made the daemon legible; this makes the CLI legible.

The \`.gitignore\` rides along because #176 raised the stakes on a pre-existing
gap: \`setup\` never wrote one, so \`mobile-automator/.session/\` — which now
holds \`daemon.log\` with device serials, adb output and stack traces — sits
untracked-but-unignored in users' projects where \`git add -A\` sweeps it up.
Invisible from inside this repo, whose own .gitignore covers that path.

## Design notes

- **Allowlist, not denylist.** \`telemetryPayload()\` iterates the catalog, never
  the event, so a field nobody classified is dropped rather than sent. No
  transport is wired in this slice; the guard exists so slice 5 cannot regress it.
- **The recorder never throws.** Each sink is individually guarded and the body
  is wrapped again. A read-only workspace or a full disk costs a log line, never
  a verb.
- **stdout is untouched.** Both sinks write to stderr or a file. Guarded per
  verb class at every log level, because \`guide\`/\`schema\`/\`bootstrap\` print
  raw markdown and can't be asserted as JSON.
- **One rotation policy.** The file sink reuses \`session-log.js\`'s
  \`MAX_LOG_BYTES\` rather than inventing a second constant.

## Test plan

\`npm test\`, \`npm run lint:guides\`, \`npm run lint:schema-additive\` and
\`./scripts/pack-smoke.sh\` all pass. New coverage: catalog integrity and
end-to-end redaction, level resolution, rotation and append semantics, sink
failure isolation, recorder failure transparency, the two CLI instrumentation
points as a drift guard, and stdout purity across five log levels.

Refs #168
BODY
)"
```

Do **not** write \`Closes #163\` — PR #176 closed it. Reference the gate issue
with \`Refs\`, never \`Closes\`; a gate closes when its last slice merges.

---

## Slices 2–5

Not planned here, deliberately. Each is a separate PR with its own rc bump, and detail written now would go stale exactly as this design's #176 assumptions did. Write each plan when its slice starts:

| Slice | Content | Version |
|---|---|---|
| 2 | Daemon instrumentation: call latency, timeouts, lifecycle, connect failures, undeliverable replies; introduces `session_id` | `0.25.0-rc.1` |
| 3 | Run traces, measured `duration_seconds`/retries in `finalize`, screenshot-on-failure, result-schema additivity guard + fixture | `0.25.0-rc.2` |
| 4 | `mauto crash` verb, failure-path auto-check, result-schema record, capability-catalog entry | `0.25.0-rc.3` |
| 5 | Opt-in PostHog spool + daemon flush, consent UX, privacy docs; removes the gate | `0.25.0` |
