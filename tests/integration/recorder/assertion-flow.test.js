'use strict';

// Integration tests for the assertion flow message handlers.
//
// Drives requestAssertionScreenshot, saveAssertion, and cancelAssertion
// directly (not through the full HTTP/WebSocket server lifecycle) to verify
// the artifact-level contract:
//
//   1. requestAssertionScreenshot → saves screenshot file + broadcasts
//      assertion-screenshot-ready.
//   2. saveAssertion → appends correct entry to assertions.json + broadcasts
//      assertion-added.
//   3. cancelAssertion → deletes screenshot file; assertions.json unchanged.
//   4. Full flow: 2 taps + 1 assertion (save) → assertions.json has correct
//      entry + file exists.
//
// Uses a real temp directory (os.tmpdir() + unique sub-dir) and asserts file
// system state after each operation. McpBridge.call is mocked to write a zero-
// byte placeholder instead of talking to a real device.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');
const { McpBridge } = require('../../../tools/recorder/src/capture/mobile-mcp-bridge');
const {
  handleRequestAssertionScreenshot,
  handleSaveAssertion,
  handleCancelAssertion,
} = require('../../../tools/recorder/src/session-handlers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build a mock `call` function for McpBridge that, when asked to save a
 * screenshot, writes a small placeholder file at the requested path and
 * resolves with `{ path: destPath }`.
 */
function makeMockCall() {
  const calls = [];
  const call = async (toolName, args) => {
    calls.push({ toolName, args });
    if (toolName === 'mobile_save_screenshot') {
      const destPath = args.path;
      // Ensure parent directory exists (the store creates it during init, but
      // be safe in case the test bypasses init).
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.alloc(10)); // 10 zero bytes placeholder
      return { path: destPath };
    }
    return {};
  };
  return { call, calls };
}

/** Collect broadcast messages into an array. */
function makeBroadcast() {
  const messages = [];
  const broadcast = (msg) => messages.push(msg);
  return { broadcast, messages };
}

/** Simple monotonic ID allocator for assertion IDs in tests. */
function makeAllocateId(prefix = 'assert') {
  let counter = 0;
  return () => `${prefix}_${++counter}`;
}

// ---------------------------------------------------------------------------
// Test suite 1: requestAssertionScreenshot
// ---------------------------------------------------------------------------

describe('handleRequestAssertionScreenshot', () => {
  let tmp;
  let store;
  let mcp;
  let broadcast;
  let messages;
  let calls;

  beforeEach(() => {
    tmp = makeTempDir('rec-assert-req-');
    store = new ArtifactsStore({ projectRoot: tmp, scenarioId: 'assert_req_test' });
    store.init({ scenario_id: 'assert_req_test', mode: 'platform-aware' });

    const mock = makeMockCall();
    calls = mock.calls;
    mcp = new McpBridge({ call: mock.call });

    const b = makeBroadcast();
    broadcast = b.broadcast;
    messages = b.messages;
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('saves screenshot file to store path', async () => {
    const allocateId = makeAllocateId('a');
    await handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId });

    const expectedPath = store.assertScreenshotPath('a_1');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.statSync(expectedPath).isFile()).toBe(true);
  });

  test('broadcasts assertion-screenshot-ready with correct assertion_id and image_url', async () => {
    const allocateId = makeAllocateId('x');
    await handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId });

    expect(messages.length).toBe(1);
    const msg = messages[0];
    expect(msg.type).toBe('assertion-screenshot-ready');
    expect(msg.assertion_id).toBe('x_1');
    expect(msg.image_url).toBe('/screenshots/assert_x_1.png');
  });

  test('calls mobile_save_screenshot with the store assertion path', async () => {
    const allocateId = makeAllocateId('b');
    await handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId });

    expect(calls.length).toBe(1);
    expect(calls[0].toolName).toBe('mobile_save_screenshot');
    expect(calls[0].args.path).toBe(store.assertScreenshotPath('b_1'));
  });

  test('broadcasts assertion-screenshot-error when mcp throws', async () => {
    const failCall = async () => {
      throw new Error('device unreachable');
    };
    const failMcp = new McpBridge({ call: failCall });
    const allocateId = makeAllocateId('c');
    await handleRequestAssertionScreenshot({ store, mcp: failMcp, broadcast, allocateId });

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('assertion-screenshot-error');
    expect(messages[0].error).toBe('device unreachable');
  });
});

// ---------------------------------------------------------------------------
// Test suite 2: handleSaveAssertion
// ---------------------------------------------------------------------------

describe('handleSaveAssertion', () => {
  let tmp;
  let store;
  let broadcast;
  let messages;

  beforeEach(() => {
    tmp = makeTempDir('rec-assert-save-');
    store = new ArtifactsStore({ projectRoot: tmp, scenarioId: 'assert_save_test' });
    store.init({ scenario_id: 'assert_save_test', mode: 'platform-aware' });

    const b = makeBroadcast();
    broadcast = b.broadcast;
    messages = b.messages;
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('appends correct entry to assertions.json', () => {
    handleSaveAssertion({
      store,
      broadcast,
      msg: {
        assertion_id: 'a1',
        nl_text: 'the welcome banner appears',
        anchor_step_id: 'tap_login',
      },
    });

    const assertionsPath = path.join(store.rootPath(), 'assertions.json');
    const arr = JSON.parse(fs.readFileSync(assertionsPath, 'utf8'));
    expect(arr.length).toBe(1);
    const entry = arr[0];
    expect(entry.id).toBe('a1');
    expect(entry.nl_text).toBe('the welcome banner appears');
    expect(entry.screenshot).toBe('screenshots/assert_a1.png');
    expect(entry.anchor_step_id).toBe('tap_login');
    expect(typeof entry.captured_at).toBe('string');
    // captured_at must be an ISO 8601 datetime string.
    expect(() => new Date(entry.captured_at).toISOString()).not.toThrow();
  });

  test('multiple saves accumulate entries in order', () => {
    handleSaveAssertion({
      store,
      broadcast,
      msg: { assertion_id: 'a1', nl_text: 'first assertion', anchor_step_id: 'tap_login' },
    });
    handleSaveAssertion({
      store,
      broadcast,
      msg: { assertion_id: 'a2', nl_text: 'second assertion', anchor_step_id: 'tap_email' },
    });

    const assertionsPath = path.join(store.rootPath(), 'assertions.json');
    const arr = JSON.parse(fs.readFileSync(assertionsPath, 'utf8'));
    expect(arr.length).toBe(2);
    expect(arr[0].id).toBe('a1');
    expect(arr[1].id).toBe('a2');
  });

  test('broadcasts assertion-added with id, nl_text, anchor_step_id', () => {
    handleSaveAssertion({
      store,
      broadcast,
      msg: {
        assertion_id: 'a1',
        nl_text: 'the Login button is visible',
        anchor_step_id: 'tap_email',
      },
    });

    expect(messages.length).toBe(1);
    const msg = messages[0];
    expect(msg.type).toBe('assertion-added');
    expect(msg.assertion.id).toBe('a1');
    expect(msg.assertion.nl_text).toBe('the Login button is visible');
    expect(msg.assertion.anchor_step_id).toBe('tap_email');
  });

  test('broadcast payload does not include screenshot or captured_at', () => {
    handleSaveAssertion({
      store,
      broadcast,
      msg: { assertion_id: 'a1', nl_text: 'test', anchor_step_id: 'tap_login' },
    });

    const payload = messages[0].assertion;
    expect(payload.screenshot).toBeUndefined();
    expect(payload.captured_at).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test suite 3: handleCancelAssertion
// ---------------------------------------------------------------------------

describe('handleCancelAssertion', () => {
  let tmp;
  let store;

  beforeEach(() => {
    tmp = makeTempDir('rec-assert-cancel-');
    store = new ArtifactsStore({ projectRoot: tmp, scenarioId: 'assert_cancel_test' });
    store.init({ scenario_id: 'assert_cancel_test', mode: 'platform-aware' });
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('deletes the assertion screenshot file', () => {
    // Manually place a placeholder screenshot as the store would.
    const screenshotPath = store.assertScreenshotPath('a1');
    fs.writeFileSync(screenshotPath, Buffer.alloc(10));
    expect(fs.existsSync(screenshotPath)).toBe(true);

    handleCancelAssertion({ store, msg: { assertion_id: 'a1' } });

    expect(fs.existsSync(screenshotPath)).toBe(false);
  });

  test('assertions.json is unchanged after cancel', () => {
    // Pre-seed one saved assertion.
    store.appendAssertion({
      id: 'a1',
      nl_text: 'pre-existing assertion',
      screenshot: 'screenshots/assert_a1.png',
      anchor_step_id: 'tap_login',
      captured_at: new Date().toISOString(),
    });

    // Place the screenshot for a different (unsaved) assertion and cancel it.
    const screenshotPath = store.assertScreenshotPath('a2');
    fs.writeFileSync(screenshotPath, Buffer.alloc(10));

    handleCancelAssertion({ store, msg: { assertion_id: 'a2' } });

    const assertionsPath = path.join(store.rootPath(), 'assertions.json');
    const arr = JSON.parse(fs.readFileSync(assertionsPath, 'utf8'));
    expect(arr.length).toBe(1);
    expect(arr[0].id).toBe('a1');
  });

  test('is a no-op when screenshot does not exist', () => {
    // Should not throw even if the file is absent.
    expect(() => {
      handleCancelAssertion({ store, msg: { assertion_id: 'nonexistent' } });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test suite 4: Full flow — 2 taps + 1 assertion (save)
// ---------------------------------------------------------------------------

describe('full flow: 2 taps + 1 saved assertion', () => {
  let tmp;
  let store;
  let mcp;
  let broadcast;
  let messages;

  beforeEach(async () => {
    tmp = makeTempDir('rec-assert-full-');
    store = new ArtifactsStore({ projectRoot: tmp, scenarioId: 'full_flow_test' });
    store.init({ scenario_id: 'full_flow_test', mode: 'platform-aware' });

    const mock = makeMockCall();
    mcp = new McpBridge({ call: mock.call });

    const b = makeBroadcast();
    broadcast = b.broadcast;
    messages = b.messages;

    // Simulate 2 tap events appended to events.jsonl.
    store.appendEvent({
      seq: 1,
      kind: 'tap',
      t: 1000,
      x: 540,
      y: 1090,
      target: 'Login',
      step_id: 'tap_login',
      screenshot_ref: 'screenshots/step_1.png',
    });
    store.appendEvent({
      seq: 2,
      kind: 'tap',
      t: 2000,
      x: 540,
      y: 800,
      target: 'Email',
      step_id: 'tap_email',
      screenshot_ref: 'screenshots/step_2.png',
    });

    // Request an assertion screenshot, then save it.
    const allocateId = makeAllocateId('flow');
    await handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId });

    const readyMsg = messages.find((m) => m.type === 'assertion-screenshot-ready');
    handleSaveAssertion({
      store,
      broadcast,
      msg: {
        assertion_id: readyMsg.assertion_id,
        nl_text: 'the welcome banner appears',
        anchor_step_id: 'tap_login',
      },
    });
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('assertions.json has exactly 1 entry', () => {
    const assertionsPath = path.join(store.rootPath(), 'assertions.json');
    const arr = JSON.parse(fs.readFileSync(assertionsPath, 'utf8'));
    expect(arr.length).toBe(1);
  });

  test('assertion entry has all required fields with correct values', () => {
    const assertionsPath = path.join(store.rootPath(), 'assertions.json');
    const arr = JSON.parse(fs.readFileSync(assertionsPath, 'utf8'));
    const entry = arr[0];
    expect(entry.id).toBe('flow_1');
    expect(entry.nl_text).toBe('the welcome banner appears');
    expect(entry.screenshot).toBe('screenshots/assert_flow_1.png');
    expect(entry.anchor_step_id).toBe('tap_login');
    expect(typeof entry.captured_at).toBe('string');
  });

  test('screenshot file exists on disk', () => {
    const screenshotPath = store.assertScreenshotPath('flow_1');
    expect(fs.existsSync(screenshotPath)).toBe(true);
  });

  test('events.jsonl still has 2 tap events', () => {
    const eventsPath = path.join(store.rootPath(), 'events.jsonl');
    const raw = fs.readFileSync(eventsPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    const events = lines.map((l) => JSON.parse(l));
    expect(events[0].step_id).toBe('tap_login');
    expect(events[1].step_id).toBe('tap_email');
  });

  test('broadcasts assertion-screenshot-ready then assertion-added in order', () => {
    const types = messages.map((m) => m.type);
    expect(types).toContain('assertion-screenshot-ready');
    expect(types).toContain('assertion-added');
    const readyIdx = types.indexOf('assertion-screenshot-ready');
    const addedIdx = types.indexOf('assertion-added');
    expect(readyIdx).toBeLessThan(addedIdx);
  });
});
