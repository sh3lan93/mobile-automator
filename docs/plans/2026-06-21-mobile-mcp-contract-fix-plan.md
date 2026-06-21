# mobile-mcp 0.0.55 Contract Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore mauto's device-driving + element resolution against pinned `@mobilenext/mobile-mcp@0.0.55` (device-as-arg, prefixed-string elements, coordinates-object).

**Architecture:** Thread a resolved device id into every mobile-mcp tool call from one place (the `createCall` wrapper) with explicit→selection→auto-discover resolution; parse mobile-mcp's prefixed-string element response and its `coordinates` object shape via shared pure helpers used by both the CLI `DeviceBridge` and the recorder; guard with recorded-fixture tests.

**Tech Stack:** Node.js (CommonJS), `@modelcontextprotocol/sdk`, `@mobilenext/mobile-mcp@0.0.55`, jest.

## Global Constraints

- Branch `fix/105-mobile-mcp-device-contract` (worktree `../mauto-mcp-contract`, off `main`). Subagents start at repo root — `cd` in and verify `git rev-parse --abbrev-ref HEAD` first.
- CI version-bump gate: a PR touching `src/`/`bin/`/`tools/`/`package.json` must bump `package.json` `version` to a value not in `git tag`. `main` is `0.17.0` (tagged). Target `0.18.0`. Bump once (Task 9). (If #104 merges first and ships `0.18.0`, rebase and use `0.19.0`.)
- Platform-agnostic invariant: never surface mobile-mcp's `identifier` (resource-id, e.g. `home_product_card_p001`) as a display name/label. Derive names from `label`/`text` only.
- Uniform JSON envelope unchanged: device-resolution failures are `error.kind="device"`, exit kind `device`, with an actionable `hint`.
- Do NOT change the mobile-mcp pin.
- mobile-mcp 0.0.55 facts (verbatim): every tool EXCEPT `mobile_list_available_devices` requires `device: z.string()`. `mobile_list_elements_on_screen` returns the string `Found these elements on screen: <JSON array>`. Each element: `{type, text, label, name, value, identifier, coordinates:{x,y,width,height}}`.

---

## Task 1: Pure helper — inject `device` into tool args

**Files:**
- Create: `src/device/tool-args.js`
- Test: `tests/unit/device/tool-args.test.js`

**Interfaces:**
- Produces: `injectDeviceArg(toolName, args, deviceId) -> object` — returns `{...args, device: deviceId}` for every tool EXCEPT `mobile_list_available_devices` (returned unchanged). If `deviceId` is falsy, returns `args` unchanged (caller resolves first).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/device/tool-args.test.js`:
```javascript
'use strict';
const { injectDeviceArg } = require('../../../src/device/tool-args');

describe('injectDeviceArg', () => {
  test('injects device into a normal tool call', () => {
    expect(injectDeviceArg('mobile_click_on_screen_at_coordinates', { x: 1, y: 2 }, 'emulator-5554'))
      .toEqual({ x: 1, y: 2, device: 'emulator-5554' });
  });
  test('does NOT inject device into mobile_list_available_devices', () => {
    expect(injectDeviceArg('mobile_list_available_devices', {}, 'emulator-5554')).toEqual({});
  });
  test('leaves args unchanged when deviceId is falsy', () => {
    expect(injectDeviceArg('mobile_type_keys', { text: 'hi' }, null)).toEqual({ text: 'hi' });
  });
  test('does not mutate the input args', () => {
    const args = { x: 1 };
    injectDeviceArg('mobile_swipe_on_screen', args, 'd');
    expect(args).toEqual({ x: 1 });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx jest tests/unit/device/tool-args.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/device/tool-args.js`:
```javascript
'use strict';

// mobile-mcp 0.0.55 requires `device` on every tool EXCEPT the discovery verb.
// Centralizing the injection (and its one exception) here keeps every call
// site correct. Pure + non-mutating so it is trivially testable.
const NO_DEVICE_TOOLS = new Set(['mobile_list_available_devices']);

function injectDeviceArg(toolName, args = {}, deviceId = null) {
  if (NO_DEVICE_TOOLS.has(toolName)) return args;
  if (!deviceId) return args;
  return { ...args, device: deviceId };
}

module.exports = { injectDeviceArg, NO_DEVICE_TOOLS };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx jest tests/unit/device/tool-args.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/device/tool-args.js tests/unit/device/tool-args.test.js
git commit -m "feat(device): pure helper to inject device arg into mobile-mcp tool calls (#105)"
```

---

## Task 2: Pure helper — resolve a single device + typed error

**Files:**
- Create: `src/device/device-resolver.js`
- Test: `tests/unit/device/device-resolver.test.js`

**Interfaces:**
- Produces: `class DeviceResolutionError extends Error { kind = 'device'; hint }`.
- Produces: `resolveSingleDevice(devices) -> string` (the single device id) or throws `DeviceResolutionError` with an actionable hint when `devices.length !== 1`. `devices` is the agnostic device-model array (`{id,name,platform,state}`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/device/device-resolver.test.js`:
```javascript
'use strict';
const { resolveSingleDevice, DeviceResolutionError } = require('../../../src/device/device-resolver');

describe('resolveSingleDevice', () => {
  test('returns the id when exactly one device is active', () => {
    expect(resolveSingleDevice([{ id: 'emulator-5554', name: 'Pixel', platform: 'android', state: 'booted' }]))
      .toBe('emulator-5554');
  });
  test('throws an actionable error when no device is active', () => {
    expect(() => resolveSingleDevice([])).toThrow(DeviceResolutionError);
    try { resolveSingleDevice([]); } catch (e) {
      expect(e.kind).toBe('device');
      expect(e.message).toMatch(/no active device/i);
      expect(e.hint).toMatch(/--device/);
    }
  });
  test('throws an actionable error listing ids when multiple are active', () => {
    const devices = [{ id: 'emulator-5554', name: 'Pixel' }, { id: 'AAAA-BBBB', name: 'iPhone 16' }];
    try { resolveSingleDevice(devices); throw new Error('did not throw'); } catch (e) {
      expect(e).toBeInstanceOf(DeviceResolutionError);
      expect(e.message).toContain('emulator-5554');
      expect(e.message).toContain('AAAA-BBBB');
      expect(e.hint).toMatch(/mauto devices use|--device/);
    }
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx jest tests/unit/device/device-resolver.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/device/device-resolver.js`:
```javascript
'use strict';

// Typed error so callers (CLI verb handlers) can map it onto the `device`
// envelope with the carried, actionable hint.
class DeviceResolutionError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'DeviceResolutionError';
    this.kind = 'device';
    this.hint = hint;
  }
}

// mobile-mcp 0.0.55 requires a concrete device id on every action/read tool.
// When the caller pinned nothing (no --device, no persisted selection), we
// auto-discover: exactly one active device is used; zero or many is a clear,
// actionable failure rather than a silent empty result.
function resolveSingleDevice(devices) {
  const list = Array.isArray(devices) ? devices : [];
  if (list.length === 1) return list[0].id;
  if (list.length === 0) {
    throw new DeviceResolutionError(
      'No active device or emulator found.',
      'Start an emulator/simulator (or connect a device), or pass --device <id>.'
    );
  }
  const ids = list.map((d) => (d && d.name ? `${d.id} (${d.name})` : d.id)).join(', ');
  throw new DeviceResolutionError(
    `Multiple active devices: ${ids}.`,
    'Pick one with --device <id> or persist it via `mauto devices use <id>`.'
  );
}

module.exports = { resolveSingleDevice, DeviceResolutionError };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx jest tests/unit/device/device-resolver.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src/device/device-resolver.js tests/unit/device/device-resolver.test.js
git commit -m "feat(device): single-device auto-resolve with actionable errors (#105)"
```

---

## Task 3: Wire device-injection + lazy auto-discovery into `createCall`

**Files:**
- Modify: `src/device/mobile-mcp-client.js` (the `createCall` function + `call` wrapper)
- Test: `tests/unit/device/mobile-mcp-client-inject.test.js`

**Interfaces:**
- Consumes: `injectDeviceArg` (Task 1), `resolveSingleDevice` + `DeviceResolutionError` (Task 2), `normalizeDevices` (`src/device/device-model.js`), `parseToolResult` (existing).
- Produces: the returned `call(toolName, args)` now (a) passes `mobile_list_available_devices` through untouched, (b) for any other tool, ensures a concrete device id (the one passed to `createCall`, else lazily discovered once via `mobile_list_available_devices` + `resolveSingleDevice`, cached), and injects it. To make the orchestration testable without spawning mobile-mcp, factor the wrapper into a pure `makeCall({ rawCall, device })` that takes a low-level `rawCall(toolName, args) -> Promise` and returns `{ call }`.

- [ ] **Step 1: Write the failing test (against the extracted `makeCall`)**

Create `tests/unit/device/mobile-mcp-client-inject.test.js`:
```javascript
'use strict';
const { makeCall } = require('../../../src/device/mobile-mcp-client');
const { DeviceResolutionError } = require('../../../src/device/device-resolver');

function rawWith(devices) {
  const calls = [];
  const rawCall = jest.fn(async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'mobile_list_available_devices') return devices;  // parsed already
    return `ok:${tool}`;
  });
  return { rawCall, calls };
}

describe('makeCall device threading', () => {
  test('injects an explicit device into action tool calls', async () => {
    const { rawCall, calls } = rawWith([]);
    const { call } = makeCall({ rawCall, device: 'emulator-5554' });
    await call('mobile_click_on_screen_at_coordinates', { x: 1, y: 2 });
    expect(calls[0]).toEqual({ tool: 'mobile_click_on_screen_at_coordinates', args: { x: 1, y: 2, device: 'emulator-5554' } });
  });

  test('auto-discovers the single device when none was pinned, and caches it', async () => {
    const { rawCall, calls } = rawWith([{ id: 'emulator-5554', name: 'Pixel' }]);
    const { call } = makeCall({ rawCall, device: null });
    await call('mobile_type_keys', { text: 'a' });
    await call('mobile_swipe_on_screen', { direction: 'up' });
    // one discovery call + two action calls, all actions carry the resolved device
    const discovery = calls.filter((c) => c.tool === 'mobile_list_available_devices');
    expect(discovery).toHaveLength(1);
    expect(calls.find((c) => c.tool === 'mobile_type_keys').args.device).toBe('emulator-5554');
    expect(calls.find((c) => c.tool === 'mobile_swipe_on_screen').args.device).toBe('emulator-5554');
  });

  test('mobile_list_available_devices itself never carries a device arg', async () => {
    const { rawCall, calls } = rawWith([{ id: 'd1' }]);
    const { call } = makeCall({ rawCall, device: null });
    await call('mobile_list_available_devices', {});
    expect(calls[0].args).toEqual({});
  });

  test('throws DeviceResolutionError when discovery finds no device', async () => {
    const { rawCall } = rawWith([]);
    const { call } = makeCall({ rawCall, device: null });
    await expect(call('mobile_save_screenshot', { path: '/tmp/x.png' })).rejects.toBeInstanceOf(DeviceResolutionError);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx jest tests/unit/device/mobile-mcp-client-inject.test.js`
Expected: FAIL — `makeCall` not exported.

- [ ] **Step 3: Implement `makeCall` and rewire `createCall`**

In `src/device/mobile-mcp-client.js`, add the requires near the top:
```javascript
const { injectDeviceArg } = require('./tool-args');
const { resolveSingleDevice } = require('./device-resolver');
const { normalizeDevices } = require('./device-model');
```

Add the extracted, testable orchestrator (above `module.exports`):
```javascript
// Pure orchestration over a low-level rawCall(toolName, args) => Promise<parsed>.
// Threads a concrete device id into every tool call except the discovery verb,
// lazily auto-discovering a single device when none was pinned (cached after
// the first resolution). Extracted from createCall so it is unit-testable
// without spawning mobile-mcp.
function makeCall({ rawCall, device = null }) {
  let resolved = device || null;
  async function ensureDevice() {
    if (resolved) return resolved;
    const listed = await rawCall('mobile_list_available_devices', {});
    resolved = resolveSingleDevice(normalizeDevices(listed)); // throws DeviceResolutionError on 0/many
    return resolved;
  }
  async function call(toolName, args = {}) {
    if (toolName === 'mobile_list_available_devices') {
      return rawCall(toolName, args);
    }
    const deviceId = await ensureDevice();
    return rawCall(toolName, injectDeviceArg(toolName, args, deviceId));
  }
  return { call };
}
```

Rewire `createCall` so its returned `call` delegates to `makeCall` over a `rawCall` that does the MCP round-trip + `parseToolResult`. Replace the existing inner `call`:
```javascript
  async function rawCall(toolName, args = {}) {
    const res = await client.callTool({ name: toolName, arguments: args });
    return parseToolResult(res);
  }
  const { call } = makeCall({ rawCall, device });
```
Keep the existing `close()` and `return { call, close }`. Update `module.exports` to `{ createCall, makeCall }`.

> Note: `createCall` no longer needs the `MOBILE_MCP_DEVICE` env (device now flows as a tool arg) — leave the env line as-is (harmless) OR remove it; do not block on it.

- [ ] **Step 4: Run to confirm it passes**

Run: `npx jest tests/unit/device/mobile-mcp-client-inject.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the device suite + commit**

Run: `npx jest tests/unit/device`
Expected: PASS.
```bash
git add src/device/mobile-mcp-client.js tests/unit/device/mobile-mcp-client-inject.test.js
git commit -m "feat(device): thread resolved device into every mobile-mcp tool call (#105)"
```

---

## Task 4: Surface `DeviceResolutionError.hint` in CLI verb handlers

**Files:**
- Modify: `src/cli.js` (verb handler `catch` blocks: `handleElements`, `handleScreenshot`, `handleTap`, `handleType`, `handleSwipe`, `handlePress`, and any other device verb)
- Test: `tests/unit/cli.test.js` (add a case)

**Interfaces:**
- Consumes: `DeviceResolutionError` (thrown through the bridge from Task 3).
- Produces: handler catches use `err.hint` when present so 0/many-device failures carry their actionable hint into the envelope.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cli.test.js` (reuse its handler-import style; `handleElements` is exported or invoked via the file's existing pattern — match it):
```javascript
  test('handleElements surfaces a DeviceResolutionError hint into the envelope', async () => {
    const { DeviceResolutionError } = require('../../src/device/device-resolver');
    const deviceBridge = { listElements: async () => { throw new DeviceResolutionError('No active device or emulator found.', 'Start an emulator/simulator (or connect a device), or pass --device <id>.'); } };
    const { envelope, exitKind } = await handleElements({ deviceBridge });
    expect(exitKind).toBe('device');
    expect(envelope.ok).toBe(false);
    expect(envelope.error.kind).toBe('device');
    expect(envelope.hint).toContain('--device');
  });
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx jest tests/unit/cli.test.js -t "DeviceResolutionError hint"`
Expected: FAIL — the hardcoded hint doesn't contain `--device` (it says "Ensure a device... is connected").

- [ ] **Step 3: Implement**

In each device-verb handler `catch (err)` block in `src/cli.js`, change the `fail('device', ..., '<hardcoded hint>')` call to prefer the carried hint:
```javascript
fail('device', err.message || String(err), err.hint || '<existing default hint for this handler>')
```
Apply to every handler that catches device errors (`handleElements`, `handleScreenshot`, `handleTap`, `handleType`, `handleSwipe`, `handlePress`, plus any sibling). Keep each handler's existing default hint string as the fallback.

- [ ] **Step 4: Run to confirm it passes**

Run: `npx jest tests/unit/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/cli.js tests/unit/cli.test.js
git commit -m "feat(cli): surface device-resolution hints in verb envelopes (#105)"
```

---

## Task 5: Parse mobile-mcp's prefixed-string element response

**Files:**
- Modify: `src/device/element-model.js` (add `parseElements`, export it)
- Modify: `src/device/bridge.js` (`listElements` uses it)
- Test: `tests/unit/device/element-model.test.js` (add cases; create if absent)

**Interfaces:**
- Produces: `parseElements(raw) -> Array<object>` — accepts the string `Found these elements on screen: <JSON array>`, a bare array, or `{elements:[...]}`; returns the array of raw mobile-mcp element objects (or `[]`).
- Consumes (Task 6 also uses it): `parseElements`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/device/element-model.test.js`:
```javascript
const { parseElements } = require('../../../src/device/element-model');

describe('parseElements', () => {
  const FIXTURE = 'Found these elements on screen: ' + JSON.stringify([
    { type: 'android.view.View', text: '', label: 'Sample Shop', coordinates: { x: 48, y: 198, width: 388, height: 84 } },
    { type: 'android.widget.Button', text: '', label: '', identifier: 'home_product_card_p001', coordinates: { x: 0, y: 804, width: 640, height: 853 } },
  ]);
  test('parses the prefixed string form', () => {
    const els = parseElements(FIXTURE);
    expect(els).toHaveLength(2);
    expect(els[0].label).toBe('Sample Shop');
  });
  test('passes a bare array through', () => {
    expect(parseElements([{ label: 'x' }])).toEqual([{ label: 'x' }]);
  });
  test('handles the {elements:[...]} envelope', () => {
    expect(parseElements({ elements: [{ label: 'y' }] })).toEqual([{ label: 'y' }]);
  });
  test('returns [] for unparseable input', () => {
    expect(parseElements('totally not elements')).toEqual([]);
    expect(parseElements(null)).toEqual([]);
  });
  test('tolerates labels containing brackets/quotes', () => {
    const tricky = 'Found these elements on screen: ' + JSON.stringify([{ label: 'a]b"c', coordinates: { x: 0, y: 0, width: 1, height: 1 } }]);
    expect(parseElements(tricky)[0].label).toBe('a]b"c');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx jest tests/unit/device/element-model.test.js -t parseElements`
Expected: FAIL — `parseElements` not exported.

- [ ] **Step 3: Implement**

In `src/device/element-model.js`, add and export `parseElements`:
```javascript
// mobile-mcp 0.0.55 returns elements as the string
// `Found these elements on screen: <JSON array>`. Earlier/other shapes may be
// a bare array or `{elements:[...]}`. Parse all three into the raw element
// array. Parse the WHOLE JSON array (never per-element regex) so labels
// containing brackets/quotes/newlines survive.
function parseElements(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.elements)) return raw.elements;
  if (typeof raw === 'string') {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch (_e) { /* fall through */ }
    }
  }
  return [];
}
```
Add `parseElements` to `module.exports`.

In `src/device/bridge.js`, change `listElements`:
```javascript
  async listElements() {
    const result = await this._call('mobile_list_elements_on_screen', {});
    return normalize(parseElements(result));
  }
```
and import it: `const { normalize, parseElements } = require('./element-model');`

- [ ] **Step 4: Run to confirm it passes**

Run: `npx jest tests/unit/device/element-model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/device/element-model.js src/device/bridge.js tests/unit/device/element-model.test.js
git commit -m "feat(device): parse mobile-mcp prefixed-string element response (#105)"
```

---

## Task 6: Handle `coordinates` object shape in bounds

**Files:**
- Modify: `src/device/element-model.js` (`resolveBounds`)
- Test: `tests/unit/device/element-model.test.js` (add cases)

**Interfaces:**
- Consumes: nothing new. Produces: `normalize` now yields elements for mobile-mcp's `coordinates:{x,y,width,height}` object form.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/device/element-model.test.js`:
```javascript
const { normalize } = require('../../../src/device/element-model');

describe('normalize with mobile-mcp coordinates object', () => {
  test('maps coordinates:{x,y,width,height} to bounds + center, label to accessibility_label', () => {
    const out = normalize([{ type: 'android.widget.Button', text: '', label: 'Wireless Earbuds', identifier: 'home_product_card_p001', coordinates: { x: 10, y: 20, width: 100, height: 50 } }]);
    expect(out).toHaveLength(1);
    expect(out[0].bounds).toEqual([10, 20, 110, 70]);
    expect(out[0].center).toEqual([60, 45]);
    expect(out[0].accessibility_label).toBe('Wireless Earbuds');
  });
  test('never surfaces identifier (resource-id) as a field', () => {
    const out = normalize([{ label: 'x', identifier: 'res_id_secret', coordinates: { x: 0, y: 0, width: 2, height: 2 } }]);
    expect(JSON.stringify(out)).not.toContain('res_id_secret');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx jest tests/unit/device/element-model.test.js -t "coordinates object"`
Expected: FAIL — `resolveBounds` returns null for object coordinates → element skipped → `out` is empty.

- [ ] **Step 3: Implement**

In `src/device/element-model.js` `resolveBounds`, add an object-coordinates branch BEFORE the array-coordinates check (or after `rect`):
```javascript
  if (raw.coordinates && typeof raw.coordinates === 'object' && !Array.isArray(raw.coordinates)) {
    const { x, y, width, height } = raw.coordinates;
    if ([x, y, width, height].every((v) => typeof v === 'number')) {
      return [x, y, x + width, y + height];
    }
  }
```
(`normalize` already drops `identifier` — it only emits `text`/`accessibility_label`/`bounds`/`center`/`type`. Do not add `identifier`.)

- [ ] **Step 4: Run to confirm it passes**

Run: `npx jest tests/unit/device/element-model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/device/element-model.js tests/unit/device/element-model.test.js
git commit -m "feat(device): map mobile-mcp coordinates object to bounds (#105)"
```

---

## Task 7: Recorder alignment — resolve real targets

**Files:**
- Create: `tools/recorder/src/capture/mcp-element-map.js` (map mobile-mcp element → recorder element shape)
- Modify: `tools/recorder/src/capture/mobile-mcp-bridge.js` (`listElementsOnScreen` parses + maps)
- Test: `tests/unit/recorder/mcp-element-map.test.js`
- Test: `tests/unit/recorder/mobile-mcp-bridge.test.js` (create/extend)

**Interfaces:**
- Consumes: `parseElements` (Task 5, from `src/device/element-model`).
- Produces: `mapMcpElement(el) -> { type, text, accessibility_label, bounds }` — the shape `tools/recorder/src/capture/element-resolver.js resolveElement` hit-tests (reads `el.bounds` [x1,y1,x2,y2], `el.accessibility_label`, `el.text`, `el.type`). `bounds` from `coordinates:{x,y,width,height}` → `[x,y,x+width,y+height]`; `accessibility_label` from `label`; **never** sets `resource_id`/`identifier` (so the resolver's resource-id fallback never fires → agnostic).
- Produces: `McpBridge.listElementsOnScreen()` returns `{ elements: [...mapped] }` so the existing `HierarchyPoller` line `snap.elements || []` works unchanged.

- [ ] **Step 1: Write the failing test for the mapper**

Create `tests/unit/recorder/mcp-element-map.test.js`:
```javascript
'use strict';
const { mapMcpElement } = require('../../../tools/recorder/src/capture/mcp-element-map');
const { resolveElement } = require('../../../tools/recorder/src/capture/element-resolver');

describe('mapMcpElement', () => {
  test('maps mobile-mcp element to the recorder resolver shape', () => {
    const el = mapMcpElement({ type: 'android.widget.Button', text: '', label: 'Wireless Earbuds', identifier: 'home_product_card_p001', coordinates: { x: 0, y: 804, width: 640, height: 853 } });
    expect(el.bounds).toEqual([0, 804, 640, 1657]);
    expect(el.accessibility_label).toBe('Wireless Earbuds');
    expect(el.resource_id).toBeUndefined();        // agnostic: never carry identifier
  });
  test('resolveElement resolves a tapped target from a mapped element (no tap_unknown)', () => {
    const snapshot = { elements: [mapMcpElement({ type: 'android.widget.Button', label: 'Wireless Earbuds', identifier: 'x', coordinates: { x: 0, y: 804, width: 640, height: 853 } })] };
    const r = resolveElement(snapshot, 320, 1100);
    expect(r).not.toBeNull();
    expect(r.display_name).toBe('Wireless Earbuds');
    expect(r.is_unnamed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx jest tests/unit/recorder/mcp-element-map.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapper**

Create `tools/recorder/src/capture/mcp-element-map.js`:
```javascript
'use strict';

// Map a mobile-mcp 0.0.55 element ({type,text,label,identifier,coordinates})
// onto the shape tools/recorder/src/capture/element-resolver.js hit-tests:
// { type, text, accessibility_label, bounds:[x1,y1,x2,y2] }. We deliberately
// drop `identifier` (resource-id) so the resolver's resource-id fallback never
// fires — captured targets stay platform-agnostic (label/text only).
function mapMcpElement(el) {
  const c = (el && el.coordinates) || {};
  const bounds = ['x', 'y', 'width', 'height'].every((k) => typeof c[k] === 'number')
    ? [c.x, c.y, c.x + c.width, c.y + c.height]
    : null;
  return {
    type: el && el.type != null ? el.type : null,
    text: el && el.text != null ? el.text : null,
    accessibility_label: el && el.label != null ? el.label : null,
    bounds,
  };
}

module.exports = { mapMcpElement };
```

- [ ] **Step 4: Run the mapper test**

Run: `npx jest tests/unit/recorder/mcp-element-map.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the bridge + write its test**

Modify `tools/recorder/src/capture/mobile-mcp-bridge.js` `listElementsOnScreen`:
```javascript
  async listElementsOnScreen() {
    const { parseElements } = require('../../../../src/device/element-model');
    const { mapMcpElement } = require('./mcp-element-map');
    const raw = await this._call('mobile_list_elements_on_screen', {});
    return { elements: parseElements(raw).map(mapMcpElement).filter((e) => Array.isArray(e.bounds)) };
  }
```
> Verify the relative path from `tools/recorder/src/capture/` to `src/device/element-model.js` resolves (`../../../../src/device/element-model`); adjust the `../` depth if the require throws.

Create `tests/unit/recorder/mobile-mcp-bridge.test.js`:
```javascript
'use strict';
const { McpBridge } = require('../../../tools/recorder/src/capture/mobile-mcp-bridge');

test('listElementsOnScreen parses mobile-mcp string + maps to resolver shape', async () => {
  const fixture = 'Found these elements on screen: ' + JSON.stringify([
    { type: 'android.widget.Button', text: '', label: 'Smart Watch', identifier: 'home_product_card_p002', coordinates: { x: 640, y: 804, width: 640, height: 853 } },
  ]);
  const bridge = new McpBridge({ call: async () => fixture });
  const snap = await bridge.listElementsOnScreen();
  expect(snap.elements).toHaveLength(1);
  expect(snap.elements[0].accessibility_label).toBe('Smart Watch');
  expect(snap.elements[0].bounds).toEqual([640, 804, 1280, 1657]);
});
```

- [ ] **Step 6: Run recorder suite + commit**

Run: `npx jest tests/unit/recorder/mcp-element-map.test.js tests/unit/recorder/mobile-mcp-bridge.test.js && npx jest tests/unit/recorder`
Expected: PASS.
```bash
git add tools/recorder/src/capture/mcp-element-map.js tools/recorder/src/capture/mobile-mcp-bridge.js \
        tests/unit/recorder/mcp-element-map.test.js tests/unit/recorder/mobile-mcp-bridge.test.js
git commit -m "feat(recorder): resolve real tap targets from mobile-mcp elements (#105)"
```

---

## Task 8: Recorded-fixture regression test (real 0.0.55 shapes)

**Files:**
- Create: `tests/fixtures/device/mcp-list-elements-0.0.55.txt` (the real prefixed-string response)
- Create: `tests/fixtures/device/mcp-list-devices-0.0.55.json` (a real device list)
- Test: `tests/unit/device/contract-0.0.55.test.js`

**Interfaces:**
- Consumes: `parseElements`, `normalize` (Task 5/6), `injectDeviceArg` (Task 1), `resolveSingleDevice` (Task 2).

- [ ] **Step 1: Create the fixtures**

Create `tests/fixtures/device/mcp-list-elements-0.0.55.txt` with a real captured response (verbatim shape):
```
Found these elements on screen: [{"type":"android.view.View","text":"","label":"Sample Shop","coordinates":{"x":48,"y":198,"width":388,"height":84}},{"type":"android.widget.Button","text":"","label":"","identifier":"appbar_icon_cart","coordinates":{"x":1136,"y":168,"width":144,"height":144}},{"type":"android.widget.Button","text":"","label":"Wireless Earbuds","identifier":"home_product_card_p001","coordinates":{"x":0,"y":804,"width":640,"height":853}},{"type":"android.widget.Button","text":"","label":"Home\nTab 1 of 3","identifier":"bottom_nav_home","coordinates":{"x":0,"y":2610,"width":427,"height":174}}]
```
Create `tests/fixtures/device/mcp-list-devices-0.0.55.json`:
```json
[{"id":"emulator-5554","name":"Pixel_9_Pro","platform":"android","state":"booted"}]
```

- [ ] **Step 2: Write the contract test**

Create `tests/unit/device/contract-0.0.55.test.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const { parseElements, normalize } = require('../../../src/device/element-model');
const { injectDeviceArg } = require('../../../src/device/tool-args');
const { resolveSingleDevice } = require('../../../src/device/device-resolver');
const { normalizeDevices } = require('../../../src/device/device-model');

const FX = path.join(__dirname, '../../fixtures/device');
const elementsRaw = fs.readFileSync(path.join(FX, 'mcp-list-elements-0.0.55.txt'), 'utf8');
const devicesRaw = JSON.parse(fs.readFileSync(path.join(FX, 'mcp-list-devices-0.0.55.json'), 'utf8'));

describe('mobile-mcp 0.0.55 contract (recorded fixtures)', () => {
  test('the prefixed element string normalizes to positioned, label-bearing elements', () => {
    const els = normalize(parseElements(elementsRaw));
    expect(els.length).toBeGreaterThanOrEqual(4);
    const labels = els.map((e) => e.accessibility_label);
    expect(labels).toContain('Sample Shop');
    expect(labels).toContain('Wireless Earbuds');
    els.forEach((e) => { expect(e.bounds).toHaveLength(4); });
  });
  test('no resource-id/identifier leaks into the normalized output', () => {
    const els = normalize(parseElements(elementsRaw));
    expect(JSON.stringify(els)).not.toContain('home_product_card_p001');
    expect(JSON.stringify(els)).not.toContain('bottom_nav_home');
  });
  test('device is injected for action tools, not for discovery', () => {
    const id = resolveSingleDevice(normalizeDevices(devicesRaw));
    expect(injectDeviceArg('mobile_click_on_screen_at_coordinates', { x: 1, y: 2 }, id))
      .toEqual({ x: 1, y: 2, device: 'emulator-5554' });
    expect(injectDeviceArg('mobile_list_available_devices', {}, id)).toEqual({});
  });
});
```

- [ ] **Step 3: Run to confirm it passes (after Tasks 1–6 landed)**

Run: `npx jest tests/unit/device/contract-0.0.55.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add tests/fixtures/device tests/unit/device/contract-0.0.55.test.js
git commit -m "test(device): recorded-fixture regression guard for mobile-mcp 0.0.55 contract (#105)"
```

---

## Task 9: Version bump + full verification

**Files:**
- Modify: `package.json` (`version`)

- [ ] **Step 1: Bump version**

In `package.json`, set `"version": "0.18.0"` (or `0.19.0` if `0.18.0` is already tagged because #104 merged first — check `git tag`).

- [ ] **Step 2: Full suite + lint**

Run: `npx jest && npm run lint:guides`
Expected: all PASS.

- [ ] **Step 3: Commit**
```bash
git add package.json
git commit -m "chore: bump version for mobile-mcp contract fix (#105)"
```

---

## Task 10: On-device validation (manual)

No code — the acceptance gate. The unit/fixture tests prove parsing/injection; only a real device proves the live round-trip.

- [ ] Boot the emulator, launch the sample app (`io.github.sh3lan93.mobile_automator.sample_shop`).
- [ ] `node bin/mauto.js elements` → **non-empty** `data` with product labels (e.g. "Wireless Earbuds"), each with `bounds`/`center`; **no** `identifier`/resource-id present.
- [ ] `node bin/mauto.js tap --at <x,y>` (a product center from `elements`) → succeeds (envelope `ok`), app responds.
- [ ] With **no** device pinned and exactly one emulator → verbs auto-use it. Stop the emulator → a verb fails with `error.kind=device` and the "no active device" hint. (If you can boot a second device, confirm the "multiple devices" hint.)
- [ ] **Recorder (needs #104's branch too):** record a scenario, tap products → steps resolve real `target`s (NOT `tap_unknown`); `events.jsonl` targets match tapped products.
- [ ] Do NOT mark done until `mauto elements` returns real elements and at least one `mauto tap` lands on a resolved target on a real device.

---

## Final: PR

- [ ] Open a draft PR (base `main`), title `fix: restore element/device resolution against mobile-mcp 0.0.55 (#105)`, body: the three drifts, the device-resolution UX, the test plan, on-device evidence. `Closes #105` on its own line.
- [ ] Re-confirm full `npx jest` + `npm run lint:guides` green in the PR description.
