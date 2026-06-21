# Recorder Live Interaction Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mauto record` actually capture taps/gestures live and show them in the GUI as they happen, on both Android (getevent) and iOS Simulator (screenshot polling).

**Architecture:** Replace the batch-at-`stop()` video tap detection with live per-platform tap sources that emit the existing `{t,kind,x,y}` event shape in real time. Wire a `step-added` WebSocket broadcast so captured steps render in the GUI immediately, and make session teardown await the tap source so end-of-session events are not dropped.

**Tech Stack:** Node.js (CommonJS), `adb` (Android getevent), `xcrun simctl` (iOS screenshots), `pngjs` (already a dep) for frame decoding, `ws` (already a dep), jest.

## Global Constraints

- Branch: `recorder/103-live-capture`; worktree `../mauto-live-capture`. Subagents start at repo root — `cd` into the worktree and verify `git rev-parse --abbrev-ref HEAD` = `recorder/103-live-capture` before any edit.
- CI version-bump gate: any PR touching `tools/`/`src/`/`bin/`/`package.json` must bump `package.json` `version` to a value not yet in `git tag`. Current main is `0.17.0` (tagged). This work targets `0.18.0`. Bump once, in Task 1.
- Platform-agnostic invariant: never emit `resource-id`/OS-specific element ids in captured steps (the existing `resolveElement`/`reinterpret` path already honors this — do not bypass it).
- Unit suite stays device-free: all new device access (`adb`, `simctl`) goes through injected `spawn`/`exec` seams so tests never touch a real device.
- Event shape is unchanged: tap sources emit `{ t:<ms>, kind:'down'|'move'|'up', x:<px>, y:<px> }` (plus `{kind:'key', t, key, state}` for hardware keys). Existing `GestureClassifier` consumes this verbatim.
- Test require base from `tests/unit/recorder/`: `../../../tools/recorder/src/...` (and `../../../tools/recorder/web/...`).

---

## Task 1: Live `step-added` broadcast (Defect B)

Makes captured steps appear in the GUI immediately. Platform-agnostic and fully unit-testable without a device. The stored event shape (`kind`, `step_id`, `target`, `value`, `field_label`, `direction`, `sensitive`) must be mapped to the GUI step shape (`id`, `index`, `action`, `target`, `value`, `field_label`, `direction`, `sensitive`, `is_unnamed`) that `web/app.js renderStepRow` reads.

**Files:**
- Create: `tools/recorder/src/coalesce/step-view.js`
- Test: `tests/unit/recorder/step-view.test.js`
- Modify: `tools/recorder/src/lifecycle/mode-b.js` (emit closures ~118–147; add helper + counter)
- Modify: `tests/unit/recorder/lifecycle-mode-b.test.js` (add broadcast assertion)
- Modify: `package.json` (`version` → `0.18.0`)

**Interfaces:**
- Produces: `toStepView(ev, index) -> { id, index, action, target, value, field_label, direction, sensitive, is_unnamed }` (pure).
- Produces: in `mode-b.js`, an internal `recordStep(ev)` that persists then broadcasts; both emit closures call it.
- Consumes: `wsCtx.broadcast(msg)`, `store.appendEvent(ev)` (existing).

- [ ] **Step 1: Write the failing test for `toStepView`**

Create `tests/unit/recorder/step-view.test.js`:

```javascript
'use strict';

const { toStepView } = require('../../../tools/recorder/src/coalesce/step-view');

describe('toStepView', () => {
  test('maps a resolved tap event to the GUI step shape', () => {
    const ev = { kind: 'tap', step_id: 'tap_wireless_earbuds', target: 'Wireless Earbuds' };
    expect(toStepView(ev, 1)).toEqual({
      id: 'tap_wireless_earbuds',
      index: 1,
      action: 'tap',
      target: 'Wireless Earbuds',
      value: null,
      field_label: null,
      direction: null,
      sensitive: false,
      is_unnamed: false,
    });
  });

  test('flags an unresolved tap (no target) as unnamed', () => {
    const ev = { kind: 'tap', step_id: 'tap_unknown' };
    const view = toStepView(ev, 4);
    expect(view.index).toBe(4);
    expect(view.action).toBe('tap');
    expect(view.target).toBeNull();
    expect(view.is_unnamed).toBe(true);
  });

  test('maps a type event with sensitive + field_label', () => {
    const ev = { kind: 'type', step_id: 'type_password', value: 'hunter2', field_label: 'Password', sensitive: true };
    expect(toStepView(ev, 2)).toEqual({
      id: 'type_password',
      index: 2,
      action: 'type',
      target: null,
      value: 'hunter2',
      field_label: 'Password',
      direction: null,
      sensitive: true,
      is_unnamed: false,
    });
  });

  test('maps a swipe event with direction (no target/unnamed)', () => {
    const ev = { kind: 'swipe', step_id: 'swipe_unknown', direction: 'up' };
    const view = toStepView(ev, 3);
    expect(view.action).toBe('swipe');
    expect(view.direction).toBe('up');
    expect(view.is_unnamed).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/unit/recorder/step-view.test.js`
Expected: FAIL — `Cannot find module '.../step-view'`.

- [ ] **Step 3: Implement `step-view.js`**

Create `tools/recorder/src/coalesce/step-view.js`:

```javascript
'use strict';

// Maps a STORED recorder event (events.jsonl shape produced by the mode-b
// emit closures + reinterpret(): `kind`, `step_id`, `target`, `value`,
// `field_label`, `direction`, `sensitive`) onto the GUI step shape consumed by
// tools/recorder/web/app.js renderStepRow (`id`, `index`, `action`, `target`,
// `value`, `field_label`, `direction`, `sensitive`, `is_unnamed`). Pure and
// side-effect free so it is trivially unit-tested and reusable by any live
// producer. Index is assigned by the caller (1-based running counter).
function toStepView(ev, index) {
  const e = ev || {};
  // "Unnamed" only applies to target-bearing actions that failed to resolve an
  // element label. type (uses field_label) and swipe (uses direction) carry no
  // target concept, so they are never unnamed.
  const targetBearing = e.kind === 'tap' || e.kind === 'long_press' || e.kind === 'double_tap';
  return {
    id: e.step_id,
    index,
    action: e.kind,
    target: e.target != null ? e.target : null,
    value: e.value != null ? e.value : null,
    field_label: e.field_label != null ? e.field_label : null,
    direction: e.direction != null ? e.direction : null,
    sensitive: e.sensitive === true,
    is_unnamed: targetBearing && (e.target == null),
  };
}

module.exports = { toStepView };
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx jest tests/unit/recorder/step-view.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `recordStep` into `mode-b.js`**

In `tools/recorder/src/lifecycle/mode-b.js`, add the require near the other coalesce requires (top of file, alongside `const { reinterpret } = require('../coalesce/semantic-reinterpreter');`):

```javascript
const { toStepView } = require('../coalesce/step-view');
```

Immediately BEFORE the `const typeBuffer = new TypeBuffer({` line (~line 118), insert:

```javascript
  // Persist a captured step AND broadcast it so the GUI renders it live
  // (defect B fix — #103). The store write is the source of truth; we only
  // broadcast on a successful append. The index is a 1-based running counter
  // matching the order steps land in events.jsonl.
  let stepIndex = 0;
  const recordStep = (ev) => {
    try { store.appendEvent(ev); } catch (_e) { return; }
    try { wsCtx.broadcast({ type: 'step-added', step: toStepView(ev, ++stepIndex) }); } catch (_e) { /* swallow */ }
  };
```

Replace the `typeBuffer` emit body's `store.appendEvent(...)` line:

```javascript
      try {
        store.appendEvent(reinterpret({ ...e, step_id: stepId }, null, emitMode));
      } catch (_e) { /* swallow */ }
```

with:

```javascript
      recordStep(reinterpret({ ...e, step_id: stepId }, null, emitMode));
```

Replace the `classifier` emit body's `store.appendEvent(...)` line:

```javascript
      try {
        store.appendEvent(reinterpret({ ...g, target: resolved?.display_name, step_id: stepId }, snap, emitMode));
      } catch (_e) { /* swallow */ }
```

with:

```javascript
      recordStep(reinterpret({ ...g, target: resolved?.display_name, step_id: stepId }, snap, emitMode));
```

- [ ] **Step 6: Write the failing broadcast test in `lifecycle-mode-b.test.js`**

Read the existing `tests/unit/recorder/lifecycle-mode-b.test.js` to reuse its `makeFakeWsCtx()` / `makeFakeStore()` / injected `tapSource` (an `EventEmitter`) pattern. Add this test inside the top-level `describe`:

```javascript
  test('broadcasts step-added when a tap is captured (#103 defect B)', async () => {
    const tapSource = new EventEmitter();
    tapSource.start = jest.fn();
    tapSource.stop = jest.fn();
    const wsCtx = makeFakeWsCtx();           // captures broadcasts in wsCtx._broadcasts
    const store = makeFakeStore();           // records appended events

    await startModeB({
      store,
      wsCtx,
      httpSrv: {},
      projectRoot: makeTempProject(),        // platform-aware config helper used elsewhere in this file
      scenarioId: 'scn',
      platform: 'android',
      appPackage: 'com.example.app',
      opts: {},
      deps: {
        tapSource,
        mcpCall: async () => ({ elements: [] }),
        pollIntervalMs: 10_000,              // keep the hierarchy poller idle
        attachFailureModes: () => ({ stopAll() {} }),
      },
    });

    // Drive a canonical tap: down then up at the same coordinate.
    tapSource.emit('tap', { t: 0, kind: 'down', x: 100, y: 200 });
    tapSource.emit('tap', { t: 80, kind: 'up', x: 100, y: 200 });

    const added = wsCtx._broadcasts.filter((m) => m.type === 'step-added');
    expect(added).toHaveLength(1);
    expect(added[0].step).toMatchObject({ index: 1, action: 'tap' });
  });
```

> Note: if `makeFakeStore` / `makeTempProject` helpers don't exist verbatim in this file, mirror the existing fakes already used by the other `startModeB` tests (the file already constructs a fake store and project root for its current cases — reuse those exact helpers). The classifier turns a `down`+`up` at one coordinate into a single `tap`.

- [ ] **Step 7: Run the broadcast test to confirm it fails, then passes**

Run: `npx jest tests/unit/recorder/lifecycle-mode-b.test.js -t "step-added"`
Expected: FAIL before Step 5's wiring is in place / PASS after. (You wrote Step 5 first, so confirm PASS; if you want a true red, stash the mode-b edit, run, unstash.)

- [ ] **Step 8: Bump version**

In `package.json`, change `"version": "0.17.0"` to `"version": "0.18.0"`.

- [ ] **Step 9: Run the full recorder suite + lint**

Run: `npx jest tests/unit/recorder && npm run lint:guides`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add tools/recorder/src/coalesce/step-view.js tests/unit/recorder/step-view.test.js \
        tools/recorder/src/lifecycle/mode-b.js tests/unit/recorder/lifecycle-mode-b.test.js package.json
git commit -m "feat(recorder): broadcast step-added so captured steps render live (#103)

Defect B: store.appendEvent was the only sink; the GUI never heard about
captured steps. Add a pure toStepView mapper (stored event -> GUI step
shape) and a recordStep helper that appends then broadcasts step-added.

Refs #103"
```

---

## Task 2: Android live tap source via getevent

Stream live touch from `adb shell getevent -lt`. Parse `EV_ABS ABS_MT_POSITION_X/Y` + `EV_KEY BTN_TOUCH` + `EV_SYN SYN_REPORT` into `{t,kind,x,y}`, scaling raw input coords to screen pixels. Also emit hardware keys. Pure parser is unit-tested with synthetic getevent lines; the process wiring is injected.

**Files:**
- Create: `tools/recorder/src/capture/getevent-touch-parser.js` (pure stream parser)
- Create: `tools/recorder/src/capture/getevent-tap-source.js` (process wiring + scaling)
- Test: `tests/unit/recorder/getevent-touch-parser.test.js`
- Test: `tests/unit/recorder/getevent-tap-source.test.js`
- Modify: `tools/recorder/src/lifecycle/mode-b.js` (platform selection of default tap source)
- Test: `tests/unit/recorder/lifecycle-mode-b.test.js` (android selects getevent source)

**Interfaces:**
- Produces: `class GeteventTouchParser { constructor({ emit, scaleX, scaleY, tStart }) ; feedChunk(str) ; end() }` — emits `{kind:'down'|'move'|'up', t, x, y}` (scaled) and `{kind:'key', t, key, state}`.
- Produces: `createGeteventTapSource({ deviceLabel, spawn, computeScale }) -> EventEmitter & { start(), stop() }` emitting `'tap'` events.
- Consumes (Task 1): the `{t,kind,x,y}` shape that `GestureClassifier.feed` already accepts.

**Reference — `adb shell getevent -lt` line format (hex values, one event per line, frames flushed by `SYN_REPORT`):**
```
[   12345.678901] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    000002a3
[   12345.678901] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    00000510
[   12345.678901] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN
[   12345.678901] /dev/input/event3: EV_SYN       SYN_REPORT           00000000
[   12345.690000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP
[   12345.690000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000
```

- [ ] **Step 1: Write the failing parser test**

Create `tests/unit/recorder/getevent-touch-parser.test.js`:

```javascript
'use strict';

const { GeteventTouchParser } = require('../../../tools/recorder/src/capture/getevent-touch-parser');

function collect(lines, opts = {}) {
  const events = [];
  const p = new GeteventTouchParser({ emit: (e) => events.push(e), scaleX: 1, scaleY: 1, tStart: 0, ...opts });
  p.feedChunk(lines.join('\n') + '\n');
  p.end();
  return events;
}

describe('GeteventTouchParser', () => {
  test('emits down then up for a single tap frame sequence', () => {
    const events = collect([
      '[   100.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064',
      '[   100.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    000000c8',
      '[   100.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN',
      '[   100.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   100.080000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP',
      '[   100.080000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
    ]);
    expect(events).toEqual([
      { kind: 'down', t: 0, x: 100, y: 200 },
      { kind: 'up', t: 80, x: 100, y: 200 },
    ]);
  });

  test('emits move frames while touch is held and position changes', () => {
    const events = collect([
      '[   200.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    0000000a',
      '[   200.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    0000000a',
      '[   200.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN',
      '[   200.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   200.050000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000014',
      '[   200.050000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   200.100000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP',
      '[   200.100000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
    ]);
    expect(events.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
    expect(events[1]).toEqual({ kind: 'move', t: 50, x: 20, y: 10 });
  });

  test('applies scale factors to raw coordinates', () => {
    const events = collect([
      '[   300.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064',
      '[   300.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    00000064',
      '[   300.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN',
      '[   300.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
      '[   300.010000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP',
      '[   300.010000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000',
    ], { scaleX: 2, scaleY: 3 });
    expect(events[0]).toEqual({ kind: 'down', t: 0, x: 200, y: 300 });
  });

  test('emits hardware key events', () => {
    const events = collect([
      '[   400.000000] /dev/input/event1: EV_KEY       KEY_BACK             DOWN',
      '[   400.000000] /dev/input/event1: EV_KEY       KEY_BACK             UP',
    ]);
    expect(events).toEqual([
      { kind: 'key', t: 0, key: 'BACK', state: 'down' },
      { kind: 'key', t: 0, key: 'BACK', state: 'up' },
    ]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/unit/recorder/getevent-touch-parser.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `tools/recorder/src/capture/getevent-touch-parser.js`:

```javascript
'use strict';

// Pure streaming parser for `adb shell getevent -lt` output. Accumulates
// ABS_MT_POSITION_X/Y and BTN_TOUCH state, and on each SYN_REPORT emits a
// touch event ({kind:'down'|'move'|'up', t, x, y}) with coordinates scaled
// from raw input-device units to screen pixels. Hardware keys (EV_KEY KEY_*)
// are emitted as {kind:'key', t, key, state}. Timestamps are ms relative to
// tStart. No device access here — feed it raw stdout chunks.

const LINE_RE = /^\[\s*(\d+\.\d+)\]\s+\/dev\/input\/event\d+:\s+(EV_\w+)\s+(\w+)\s+(\S+)\s*$/;

class GeteventTouchParser {
  constructor({ emit, scaleX = 1, scaleY = 1, tStart = 0 }) {
    this._emit = emit;
    this._scaleX = scaleX;
    this._scaleY = scaleY;
    this._tStart = tStart;
    this._tail = '';
    this._x = null;
    this._y = null;
    this._touching = false;   // BTN_TOUCH state
    this._active = false;     // whether we've emitted a down for the current touch
    this._frameT = 0;
  }

  feedChunk(chunk) {
    const data = this._tail + chunk;
    const lines = data.split('\n');
    this._tail = lines.pop();
    for (const line of lines) this._consume(line);
  }

  _consume(line) {
    const m = line && line.match(LINE_RE);
    if (!m) return;
    const tMs = Math.round((parseFloat(m[1]) - this._tStart) * 1000);
    const type = m[2];
    const code = m[3];
    const value = m[4];
    this._frameT = tMs;

    if (type === 'EV_ABS' && code === 'ABS_MT_POSITION_X') {
      this._x = parseInt(value, 16);
      return;
    }
    if (type === 'EV_ABS' && code === 'ABS_MT_POSITION_Y') {
      this._y = parseInt(value, 16);
      return;
    }
    if (type === 'EV_KEY' && code === 'BTN_TOUCH') {
      this._touching = value.toUpperCase() === 'DOWN';
      return;
    }
    if (type === 'EV_KEY' && code.startsWith('KEY_')) {
      const state = value.toUpperCase() === 'DOWN' ? 'down' : 'up';
      this._emit({ kind: 'key', t: tMs, key: code.slice(4), state });
      return;
    }
    if (type === 'EV_SYN' && code === 'SYN_REPORT') {
      this._flushFrame();
    }
  }

  _flushFrame() {
    const x = this._scaled(this._x, this._scaleX);
    const y = this._scaled(this._y, this._scaleY);
    if (this._touching && !this._active) {
      this._active = true;
      this._lastX = x; this._lastY = y;
      this._emit({ kind: 'down', t: this._frameT, x, y });
    } else if (this._touching && this._active) {
      if (x !== this._lastX || y !== this._lastY) {
        this._lastX = x; this._lastY = y;
        this._emit({ kind: 'move', t: this._frameT, x, y });
      }
    } else if (!this._touching && this._active) {
      this._active = false;
      this._emit({ kind: 'up', t: this._frameT, x: this._lastX, y: this._lastY });
    }
  }

  _scaled(raw, scale) {
    return raw == null ? 0 : Math.round(raw * scale);
  }

  end() {
    if (this._tail) { this._consume(this._tail); this._tail = ''; }
  }
}

module.exports = { GeteventTouchParser };
```

- [ ] **Step 4: Run the parser test to confirm it passes**

Run: `npx jest tests/unit/recorder/getevent-touch-parser.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing tap-source test**

Create `tests/unit/recorder/getevent-tap-source.test.js`:

```javascript
'use strict';

const { EventEmitter } = require('events');
const { createGeteventTapSource } = require('../../../tools/recorder/src/capture/getevent-tap-source');

function fakeSpawn() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdout.setEncoding = () => {};
  proc.kill = jest.fn();
  return proc;
}

describe('createGeteventTapSource', () => {
  test('spawns getevent and re-emits parsed taps as tap events', async () => {
    const proc = fakeSpawn();
    const spawn = jest.fn(() => proc);
    const computeScale = jest.fn(async () => ({ scaleX: 1, scaleY: 1 }));
    const src = createGeteventTapSource({ deviceLabel: 'emulator-5554', spawn, computeScale });

    const taps = [];
    src.on('tap', (e) => taps.push(e));
    await src.start();

    expect(spawn).toHaveBeenCalledWith('adb', expect.arrayContaining(['shell', 'getevent', '-lt']), expect.anything());
    proc.stdout.emit('data',
      '[   1.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_X    00000064\n' +
      '[   1.000000] /dev/input/event3: EV_ABS       ABS_MT_POSITION_Y    000000c8\n' +
      '[   1.000000] /dev/input/event3: EV_KEY       BTN_TOUCH            DOWN\n' +
      '[   1.000000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000\n' +
      '[   1.080000] /dev/input/event3: EV_KEY       BTN_TOUCH            UP\n' +
      '[   1.080000] /dev/input/event3: EV_SYN       SYN_REPORT           00000000\n');

    expect(taps.map((t) => t.kind)).toEqual(['down', 'up']);
    expect(taps[0]).toMatchObject({ kind: 'down', x: 100, y: 200 });
  });

  test('stop() kills the process', async () => {
    const proc = fakeSpawn();
    const src = createGeteventTapSource({
      deviceLabel: 'd', spawn: () => proc, computeScale: async () => ({ scaleX: 1, scaleY: 1 }),
    });
    await src.start();
    await src.stop();
    expect(proc.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Implement the tap source**

Create `tools/recorder/src/capture/getevent-tap-source.js`:

```javascript
'use strict';

const { spawn: defaultSpawn } = require('child_process');
const { EventEmitter } = require('events');
const { GeteventTouchParser } = require('./getevent-touch-parser');
const { computeAndroidScale } = require('./android-scale');

// Live Android tap source. Spawns `adb shell getevent -lt`, scales raw coords
// to screen pixels (via computeScale), and re-emits parsed touch + key events
// as `tap` events for the mode-b pipeline. Best-effort: a spawn failure
// disables the source (warns once) rather than crashing the recorder.
function createGeteventTapSource({
  deviceLabel,
  spawn = defaultSpawn,
  computeScale = computeAndroidScale,
  warn = console.warn,
} = {}) {
  const emitter = new EventEmitter();
  let proc = null;
  let parser = null;

  emitter.start = async () => {
    if (proc) return;
    let scale;
    try {
      scale = await computeScale({ deviceLabel, spawn });
    } catch (_e) {
      scale = { scaleX: 1, scaleY: 1 };
    }
    parser = new GeteventTouchParser({
      emit: (e) => emitter.emit('tap', e),
      scaleX: scale.scaleX,
      scaleY: scale.scaleY,
      tStart: 0,
    });
    const args = deviceLabel
      ? ['-s', deviceLabel, 'shell', 'getevent', '-lt']
      : ['shell', 'getevent', '-lt'];
    try {
      proc = spawn('adb', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      warn(`[recorder] getevent unavailable (${err && err.message}); live taps disabled`);
      return;
    }
    if (proc.stdout) {
      if (proc.stdout.setEncoding) proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => { try { parser.feedChunk(String(chunk)); } catch (_e) {} });
    }
    if (typeof proc.on === 'function') {
      proc.on('error', (err) => warn(`[recorder] getevent error (${err && err.message})`));
    }
  };

  emitter.stop = async () => {
    if (proc) { try { proc.kill(); } catch (_e) {} proc = null; }
    if (parser) { try { parser.end(); } catch (_e) {} parser = null; }
  };

  return emitter;
}

module.exports = { createGeteventTapSource };
```

Create `tools/recorder/src/capture/android-scale.js`:

```javascript
'use strict';

const { execFile } = require('child_process');

// Computes raw-getevent -> screen-pixel scale factors. Reads the ABS axis
// maxima from `adb shell getevent -lp` and the screen size from
// `adb shell wm size`. If either is unavailable, returns 1:1 (correct on most
// emulators). `runAdb` is injectable for tests.
function defaultRunAdb({ deviceLabel }) {
  const base = deviceLabel ? ['-s', deviceLabel, 'shell'] : ['shell'];
  return (subArgs) => new Promise((resolve) => {
    execFile('adb', base.concat(subArgs), { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

async function computeAndroidScale({ deviceLabel, runAdb } = {}) {
  const run = runAdb || defaultRunAdb({ deviceLabel });
  const wm = await run(['wm', 'size']);             // "Physical size: 1280x2856"
  const lp = await run(['getevent', '-lp']);        // includes "ABS_MT_POSITION_X ... max 1279 ..."
  const wmMatch = wm.match(/(\d+)\s*x\s*(\d+)/);
  const screenW = wmMatch ? parseInt(wmMatch[1], 10) : null;
  const screenH = wmMatch ? parseInt(wmMatch[2], 10) : null;
  const xMax = matchAbsMax(lp, 'ABS_MT_POSITION_X');
  const yMax = matchAbsMax(lp, 'ABS_MT_POSITION_Y');
  const scaleX = (screenW && xMax) ? screenW / (xMax + 1) : 1;
  const scaleY = (screenH && yMax) ? screenH / (yMax + 1) : 1;
  return { scaleX, scaleY };
}

function matchAbsMax(lp, code) {
  // Match a getevent -lp block line like: "ABS_MT_POSITION_X   : value 0, min 0, max 1279, ..."
  const re = new RegExp(code + '[^\\n]*?max\\s+(\\d+)');
  const m = lp && lp.match(re);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = { computeAndroidScale, matchAbsMax };
```

> On-device note: scaling is device-dependent. The 1:1 fallback is correct on the Pixel emulator (raw ABS max ≈ screen px). Task 6 validates real coordinates land on the tapped element.

- [ ] **Step 7: Run the tap-source test**

Run: `npx jest tests/unit/recorder/getevent-tap-source.test.js`
Expected: PASS (2 tests).

- [ ] **Step 8: Add platform selection in `mode-b.js`**

Find the live tap-source default block (~lines 154–161) that currently always uses `createTapSource`:

```javascript
  let tapSource = deps.tapSource;
  let ownsTapSource = false;
  if (!tapSource && deps.useLiveDevice) {
    const { createTapSource } = require('../capture/tap-source');
    const _createTapSource = deps.createTapSource || createTapSource;
    tapSource = _createTapSource({ bridge: mcpBridge });
    ownsTapSource = true;
  }
```

Replace with platform-aware selection (Android → getevent; others keep the existing video source for now — iOS is replaced in Task 4):

```javascript
  let tapSource = deps.tapSource;
  let ownsTapSource = false;
  if (!tapSource && deps.useLiveDevice) {
    if (platform === 'android') {
      const { createGeteventTapSource } = require('../capture/getevent-tap-source');
      const _create = deps.createGeteventTapSource || createGeteventTapSource;
      tapSource = _create({ deviceLabel: deps.deviceLabel });
    } else {
      const { createTapSource } = require('../capture/tap-source');
      const _createTapSource = deps.createTapSource || createTapSource;
      tapSource = _createTapSource({ bridge: mcpBridge });
    }
    ownsTapSource = true;
  }
```

> `platform` is already a parameter of `startModeB` (currently `// eslint-disable-line no-unused-vars` — remove that comment since it's now used).

- [ ] **Step 9: Test platform selection**

Add to `tests/unit/recorder/lifecycle-mode-b.test.js`:

```javascript
  test('android live path selects the getevent tap source (#103)', async () => {
    const fakeSource = Object.assign(new EventEmitter(), { start: jest.fn(), stop: jest.fn() });
    const createGeteventTapSource = jest.fn(() => fakeSource);
    await startModeB({
      store: makeFakeStore(),
      wsCtx: makeFakeWsCtx(),
      httpSrv: {},
      projectRoot: makeTempProject(),
      scenarioId: 'scn',
      platform: 'android',
      appPackage: 'com.example.app',
      opts: {},
      deps: {
        useLiveDevice: true,
        createGeteventTapSource,
        mcpCall: async () => ({ elements: [] }),
        pollIntervalMs: 10_000,
        attachFailureModes: () => ({ stopAll() {} }),
      },
    });
    expect(createGeteventTapSource).toHaveBeenCalledTimes(1);
    expect(fakeSource.start).toHaveBeenCalled();
  });
```

- [ ] **Step 10: Run recorder suite + lint, then commit**

Run: `npx jest tests/unit/recorder && npm run lint:guides`
Expected: all PASS.

```bash
git add tools/recorder/src/capture/getevent-touch-parser.js \
        tools/recorder/src/capture/getevent-tap-source.js \
        tools/recorder/src/capture/android-scale.js \
        tools/recorder/src/lifecycle/mode-b.js \
        tests/unit/recorder/getevent-touch-parser.test.js \
        tests/unit/recorder/getevent-tap-source.test.js \
        tests/unit/recorder/lifecycle-mode-b.test.js
git commit -m "feat(recorder): live Android tap capture via getevent (#103)

Stream EV_ABS touch + EV_KEY keys from adb getevent -lt, scale raw coords
to screen pixels, emit live {t,kind,x,y}. Android live path now selects
this source instead of the batch video detector.

Refs #103"
```

---

## Task 3: Streaming frame detector (`feed()` on VideoTapDetector)

Promote `processFrames`' local `active` state to an instance field and add a `feed(frame)` that detects across calls. Needed by the iOS screenshot source (Task 4). Keep `processFrames`/`extractFrames` for back-compat.

**Files:**
- Modify: `tools/recorder/src/capture/video-tap-detector.js`
- Test: `tests/unit/recorder/video-tap-detector.test.js` (add streaming cases)

**Interfaces:**
- Produces: `detector.feed(frame) -> void` (emits down/move/up across calls); `detector.flush() -> void` (emits trailing `up` if a touch is still active).

- [ ] **Step 1: Write the failing streaming test**

Add to `tests/unit/recorder/video-tap-detector.test.js` (reuse its existing fixture-frame helpers; a frame is `{ t, buf }` with a PNG buffer where the indicator dot is present/absent):

```javascript
  describe('streaming feed()', () => {
    test('emits down on first dot frame, up after dot disappears', () => {
      const events = [];
      const det = new VideoTapDetector({ emit: (e) => events.push(e), color: 'light_blue' });
      det.feed({ t: 0, buf: frameWithDot(100, 200) });   // existing fixture helper
      det.feed({ t: 30, buf: frameWithDot(100, 200) });
      det.feed({ t: 60, buf: frameBlank() });            // existing fixture helper
      expect(events.map((e) => e.kind)).toEqual(['down', 'move', 'up']);
    });

    test('flush() emits a trailing up if a touch is still active', () => {
      const events = [];
      const det = new VideoTapDetector({ emit: (e) => events.push(e), color: 'light_blue' });
      det.feed({ t: 0, buf: frameWithDot(10, 10) });
      det.flush();
      expect(events.map((e) => e.kind)).toEqual(['down', 'up']);
    });
  });
```

> If `frameWithDot`/`frameBlank` helpers aren't already in this test file, build the two fixture frames the same way the existing `processFrames` tests construct their PNG buffers (reuse that exact construction).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/unit/recorder/video-tap-detector.test.js -t "streaming"`
Expected: FAIL — `det.feed is not a function`.

- [ ] **Step 3: Implement `feed()` / `flush()` and refactor `processFrames`**

In `tools/recorder/src/capture/video-tap-detector.js`, change the constructor to track active state on the instance and add `feed`/`flush`; reimplement `processFrames` on top of them so behavior is identical:

```javascript
class VideoTapDetector {
  constructor({ emit, color = 'light_blue', fps = 30 }) {
    this._emit = emit;
    this._color = color;
    this._fps = fps;
    this._active = null;       // {x,y} of in-progress touch, or null
    this._lastT = 0;
  }

  feed(frame) {
    this._lastT = frame.t;
    const dot = detectIndicatorInFrame(frame.buf, { color: this._color });
    if (dot && !this._active) {
      this._emit({ kind: 'down', t: frame.t, x: dot.x, y: dot.y });
      this._active = { x: dot.x, y: dot.y };
    } else if (dot && this._active) {
      this._emit({ kind: 'move', t: frame.t, x: dot.x, y: dot.y });
      this._active = { x: dot.x, y: dot.y };
    } else if (!dot && this._active) {
      this._emit({ kind: 'up', t: frame.t, x: this._active.x, y: this._active.y });
      this._active = null;
    }
  }

  flush() {
    if (this._active) {
      this._emit({ kind: 'up', t: this._lastT, x: this._active.x, y: this._active.y });
      this._active = null;
    }
  }

  processFrames(frames) {
    // Back-compat batch API: a fresh, self-contained detection over `frames`.
    const saved = this._active; this._active = null;
    for (const frame of frames) this.feed(frame);
    if (this._active) {
      const last = frames[frames.length - 1];
      this._emit({ kind: 'up', t: last.t, x: this._active.x, y: this._active.y });
      this._active = null;
    }
    this._active = saved;
  }
```

(Leave `extractFrames` and the rest of the class unchanged.)

- [ ] **Step 4: Run the full detector test file**

Run: `npx jest tests/unit/recorder/video-tap-detector.test.js`
Expected: PASS — existing `processFrames` cases AND new streaming cases.

- [ ] **Step 5: Commit**

```bash
git add tools/recorder/src/capture/video-tap-detector.js tests/unit/recorder/video-tap-detector.test.js
git commit -m "feat(recorder): streaming feed()/flush() on VideoTapDetector (#103)

Promote per-frame active-touch state to the instance so frames can be fed
one at a time (for the iOS screenshot source). processFrames is reimplemented
on top of feed() and keeps identical batch behavior.

Refs #103"
```

---

## Task 4: iOS Simulator live tap source via screenshot polling

Poll `xcrun simctl io <udid> screenshot` at ~8 fps, feed each PNG to the streaming detector, re-emit detected touches as `tap` events. Replace the iOS branch of the mode-b platform selection.

**Files:**
- Create: `tools/recorder/src/capture/screenshot-tap-source.js`
- Test: `tests/unit/recorder/screenshot-tap-source.test.js`
- Modify: `tools/recorder/src/lifecycle/mode-b.js` (iOS branch → screenshot source)

**Interfaces:**
- Produces: `createScreenshotTapSource({ deviceLabel, intervalMs, color, captureFrame, setInterval, clearInterval }) -> EventEmitter & { start(), stop() }` emitting `'tap'`.
- Consumes (Task 3): `VideoTapDetector.feed/flush`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/recorder/screenshot-tap-source.test.js`:

```javascript
'use strict';

const { createScreenshotTapSource } = require('../../../tools/recorder/src/capture/screenshot-tap-source');

describe('createScreenshotTapSource', () => {
  test('feeds polled frames to the detector and emits taps', async () => {
    // Drive the poll loop manually via a fake timer.
    let tick = null;
    const fakeSetInterval = (fn) => { tick = fn; return 1; };
    const fakeClearInterval = jest.fn();

    // captureFrame returns a sequence: dot, dot, blank → down, move, up.
    const frames = [{ buf: Buffer.from('DOT') }, { buf: Buffer.from('DOT') }, { buf: Buffer.from('BLANK') }];
    let i = 0;
    const captureFrame = jest.fn(async () => frames[i++] || { buf: Buffer.from('BLANK') });

    // Inject a fake detector via the `makeDetector` seam so we don't decode PNGs here.
    const emitted = [];
    const fakeDetector = {
      feed: (f) => { if (String(f.buf) === 'DOT' && !fakeDetector._a) { fakeDetector._a = true; emitted.push('down'); }
                     else if (String(f.buf) === 'DOT') { emitted.push('move'); }
                     else if (fakeDetector._a) { fakeDetector._a = false; emitted.push('up'); } },
      flush: () => {},
    };

    const src = createScreenshotTapSource({
      deviceLabel: 'UDID', intervalMs: 125, captureFrame,
      setInterval: fakeSetInterval, clearInterval: fakeClearInterval,
      makeDetector: () => fakeDetector,
    });
    await src.start();
    await tick(); await tick(); await tick();   // three polls
    await src.stop();

    expect(emitted).toEqual(['down', 'move', 'up']);
    expect(fakeClearInterval).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/unit/recorder/screenshot-tap-source.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the screenshot tap source**

Create `tools/recorder/src/capture/screenshot-tap-source.js`:

```javascript
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { VideoTapDetector } = require('./video-tap-detector');

// Default frame capture: `xcrun simctl io <udid> screenshot <file>` then read
// the PNG bytes. Injectable so tests never shell out.
function defaultCaptureFrame({ deviceLabel }) {
  return () => new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `recorder-shot-${process.pid}.png`);
    execFile('xcrun', ['simctl', 'io', deviceLabel, 'screenshot', file], (err) => {
      if (err) { resolve(null); return; }
      fs.readFile(file, (rErr, buf) => resolve(rErr ? null : { buf }));
    });
  });
}

function createScreenshotTapSource({
  deviceLabel,
  intervalMs = 125,                 // ~8 fps
  color = 'ios_simulator',
  captureFrame,
  makeDetector,
  setInterval: setIntervalFn = setInterval,
  clearInterval: clearIntervalFn = clearInterval,
} = {}) {
  const emitter = new EventEmitter();
  const detector = (makeDetector || (() => new VideoTapDetector({ emit: (e) => emitter.emit('tap', e), color })))();
  const capture = captureFrame || defaultCaptureFrame({ deviceLabel });
  let timer = null;
  let busy = false;
  const tStart = 0;
  let t = 0;

  emitter.start = async () => {
    if (timer) return;
    timer = setIntervalFn(async () => {
      if (busy) return;               // skip if a capture is still in flight
      busy = true;
      try {
        const frame = await capture();
        if (frame && frame.buf) { t += intervalMs; detector.feed({ t: t + tStart, buf: frame.buf }); }
      } catch (_e) { /* best-effort: drop this frame */ }
      busy = false;
    }, intervalMs);
  };

  emitter.stop = async () => {
    if (timer) { clearIntervalFn(timer); timer = null; }
    try { detector.flush(); } catch (_e) {}
  };

  return emitter;
}

module.exports = { createScreenshotTapSource };
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest tests/unit/recorder/screenshot-tap-source.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the iOS branch in `mode-b.js`**

Update the platform selection from Task 2 so the non-android branch uses the screenshot source:

```javascript
  let tapSource = deps.tapSource;
  let ownsTapSource = false;
  if (!tapSource && deps.useLiveDevice) {
    if (platform === 'android') {
      const { createGeteventTapSource } = require('../capture/getevent-tap-source');
      const _create = deps.createGeteventTapSource || createGeteventTapSource;
      tapSource = _create({ deviceLabel: deps.deviceLabel });
    } else {
      const { createScreenshotTapSource } = require('../capture/screenshot-tap-source');
      const _create = deps.createScreenshotTapSource || createScreenshotTapSource;
      tapSource = _create({ deviceLabel: deps.deviceLabel });
    }
    ownsTapSource = true;
  }
```

- [ ] **Step 6: Test iOS selection**

Add to `tests/unit/recorder/lifecycle-mode-b.test.js`:

```javascript
  test('ios live path selects the screenshot tap source (#103)', async () => {
    const fakeSource = Object.assign(new EventEmitter(), { start: jest.fn(), stop: jest.fn() });
    const createScreenshotTapSource = jest.fn(() => fakeSource);
    await startModeB({
      store: makeFakeStore(), wsCtx: makeFakeWsCtx(), httpSrv: {},
      projectRoot: makeTempProject(), scenarioId: 'scn', platform: 'ios',
      appPackage: 'com.example.app', opts: {},
      deps: {
        useLiveDevice: true, createScreenshotTapSource,
        mcpCall: async () => ({ elements: [] }), pollIntervalMs: 10_000,
        attachFailureModes: () => ({ stopAll() {} }),
      },
    });
    expect(createScreenshotTapSource).toHaveBeenCalledTimes(1);
    expect(fakeSource.start).toHaveBeenCalled();
  });
```

- [ ] **Step 7: Run recorder suite + lint, then commit**

Run: `npx jest tests/unit/recorder && npm run lint:guides`
Expected: all PASS.

```bash
git add tools/recorder/src/capture/screenshot-tap-source.js \
        tests/unit/recorder/screenshot-tap-source.test.js \
        tools/recorder/src/lifecycle/mode-b.js \
        tests/unit/recorder/lifecycle-mode-b.test.js
git commit -m "feat(recorder): live iOS tap capture via screenshot polling (#103)

Poll simctl io screenshot ~8fps into the streaming VideoTapDetector; iOS
live path now selects this source.

Refs #103"
```

---

## Task 5: Async teardown ordering (Defect C)

Make `finish()` await the tap source's `stop()` BEFORE flushing the classifier/typeBuffer so the final `up`/gesture is captured, then resolve the exit. Thread async through the save/cancel handlers.

**Files:**
- Modify: `tools/recorder/src/lifecycle/mode-b.js` (`finish()` ~173–193, dispatch ~220–258)
- Test: `tests/unit/recorder/lifecycle-mode-b.test.js`

**Interfaces:**
- Produces: `finish(code) -> Promise<void>` (now async); callers `await` it.

- [ ] **Step 1: Write the failing ordering test**

Add to `tests/unit/recorder/lifecycle-mode-b.test.js`:

```javascript
  test('finish awaits tapSource.stop before flushing (#103 defect C)', async () => {
    const order = [];
    const tapSource = Object.assign(new EventEmitter(), {
      start: jest.fn(),
      stop: jest.fn(async () => { await Promise.resolve(); order.push('stop'); }),
    });
    const classifier = { feed: () => {}, flush: jest.fn(() => order.push('flush')) };

    let savedFinish;
    const wsCtx = makeFakeWsCtx();
    await startModeB({
      store: makeFakeStore(), wsCtx, httpSrv: {},
      projectRoot: makeTempProject(), scenarioId: 'scn', platform: 'android',
      appPackage: 'com.example.app', opts: {},
      deps: {
        tapSource, classifier,                 // inject classifier (add this seam in Step 3)
        mcpCall: async () => ({ elements: [] }), pollIntervalMs: 10_000,
        attachFailureModes: ({ onDone }) => { savedFinish = onDone; return { stopAll() {} }; },
      },
    });

    await savedFinish(0);                       // simulate a watchdog/save completion
    expect(order).toEqual(['stop', 'flush']);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/unit/recorder/lifecycle-mode-b.test.js -t "awaits tapSource.stop"`
Expected: FAIL — order is `['flush', 'stop']` (or stop missing), since finish currently flushes first and never awaits stop.

- [ ] **Step 3: Make `finish()` async and reorder**

In `mode-b.js`, allow a `deps.classifier` injection seam (so the test can observe flush order): where the classifier is constructed, prefix with `const classifier = deps.classifier || new GestureClassifier({ ... });`.

Rewrite `finish()`:

```javascript
  let resolveExit;
  const exitPromise = new Promise((res) => { resolveExit = res; });
  let resolved = false;
  async function finish(code) {
    if (resolved) return;
    resolved = true;
    try { hierarchyPoller.stop(); } catch (_e) { /* swallow */ }
    // Stop the live tap source FIRST and AWAIT it so any final up/gesture is
    // delivered to the classifier before we flush (defect C fix — #103).
    if (ownsTapSource && tapSource && typeof tapSource.stop === 'function') {
      try { await tapSource.stop(); } catch (_e) { /* swallow */ }
    }
    try { classifier.flush(); } catch (_e) { /* swallow */ }
    try { typeBuffer.flush(); } catch (_e) { /* swallow */ }
    if (failureCtx && typeof failureCtx.stopAll === 'function') {
      try { failureCtx.stopAll(); } catch (_e) { /* swallow */ }
    }
    if (deviceConn && typeof deviceConn.close === 'function') {
      try { deviceConn.close(); } catch (_e) { /* swallow */ }
    }
    resolveExit(code);
  }
```

Update the dispatch + failure callers to not depend on finish being sync. `finish` is fire-and-forget from the WS dispatch (its returned promise can float — the exit is signaled via `resolveExit`), so the existing `onDone: (code) => finish(code)` calls still work (they just don't await). No further change needed there, but ensure no caller relies on a synchronous return value (none do).

- [ ] **Step 4: Run the ordering test + full file**

Run: `npx jest tests/unit/recorder/lifecycle-mode-b.test.js`
Expected: PASS (ordering test + all prior cases).

- [ ] **Step 5: Run recorder suite + lint, then commit**

Run: `npx jest tests/unit/recorder && npm run lint:guides`
Expected: all PASS.

```bash
git add tools/recorder/src/lifecycle/mode-b.js tests/unit/recorder/lifecycle-mode-b.test.js
git commit -m "fix(recorder): await tapSource.stop before flush on teardown (#103)

Defect C: finish() flushed then fired stop() un-awaited and exited,
dropping the final up/gesture. finish() is now async and awaits stop()
before flushing the classifier/typeBuffer.

Refs #103"
```

---

## Task 6: On-device validation (manual — both platforms)

No code; this is the acceptance gate. The unit suite cannot exercise real devices, so validate the end-to-end live path on a real Android emulator and an iOS Simulator. Capture evidence.

**Android (Pixel emulator):**

- [ ] Boot: `"$HOME/Library/Android/sdk/emulator/emulator" -avd Pixel_9_Pro -no-snapshot-load &` then `adb wait-for-device && (until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done)`
- [ ] Install + launch the sample app: `adb install -r -g sample-app/build/app/outputs/flutter-apk/app-debug.apk` then `adb shell monkey -p io.github.sh3lan93.mobile_automator.sample_shop -c android.intent.category.LAUNCHER 1`
- [ ] In `sample-app/`, run `node ../bin/mauto.js record smoke_android --platform android` (from the worktree; the sample-app config is `platform-agnostic`).
- [ ] **Expect:** the GUI auto-opens AND tapping products makes step rows appear **live** in the GUI.
- [ ] Tap 3 products, then Save in the GUI.
- [ ] **Verify:** `sample-app/mobile-automator/.recorder/smoke_android/events.jsonl` is non-empty with `tap` events whose targets match the tapped products (NOT `*_unknown`). Confirm `wm size` scaling put coordinates on the right elements.

**iOS Simulator:**

- [ ] Boot: `xcrun simctl boot "iPhone 16 Pro" && open -a Simulator`
- [ ] Build + install the iOS sample app (per `sample-app` build docs), launch it.
- [ ] Run `node ../bin/mauto.js record smoke_ios --platform ios` in `sample-app/`.
- [ ] **Expect:** GUI auto-opens; tapping makes step rows appear live (≤ ~1 frame-interval lag).
- [ ] Tap 3 elements, Save.
- [ ] **Verify:** `events.jsonl` non-empty with sensible targets.

- [ ] If validation surfaces bugs (coordinate scaling off, detector color profile, fps too low), file follow-ups or fix within the relevant task before merging. Do NOT mark this task done until a real recording produces a non-empty, correct scenario on at least Android.

---

## Final: PR

- [ ] Open a draft PR (base `main`) titled `feat(recorder): live interaction capture (#103)`, body: the three defects, the per-platform approach, the test plan, and the on-device evidence from Task 6. Include `Closes #103` on its own line and `Refs #21`.
- [ ] Re-confirm `npx jest` (full suite) + `npm run lint:guides` green in the PR description.
