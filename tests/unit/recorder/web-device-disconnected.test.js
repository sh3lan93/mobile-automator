/**
 * @jest-environment jsdom
 *
 * Slice #10 — Recorder GUI: device-disconnected error banner.
 *
 * When the orchestrator broadcasts `{type:'device-disconnected', device_label, reason}`
 * the GUI must render a non-dismissible alert banner naming the device, hide the
 * live step list (recording is dead), and instruct the user to rerun
 * `/mobile-automator:record`. Idempotent: repeated messages must not stack
 * multiple banners.
 */

'use strict';

// Mark the environment so app.js does not auto-connect a real WebSocket.
window.__RECORDER_TEST__ = true;

const path = require('path');
const appPath = path.resolve(__dirname, '../../../tools/recorder/web/app.js');

// eslint-disable-next-line import/no-dynamic-require
const app = require(appPath);

function setupDom() {
  document.body.innerHTML = `
    <header>
      <h1>Mobile Automator Recorder</h1>
      <button id="btn-add-assertion" disabled></button>
      <div id="mode-banner" hidden></div>
    </header>
    <main><ul id="step-list"></ul></main>
    <footer>
      <button id="btn-cancel"></button>
      <button id="btn-save"></button>
    </footer>
    <div id="modal-root"></div>
  `;
}

// Fake WebSocket constructor that captures the most recent message handler so
// the test can drive it directly with {data: JSON.stringify(...)}.
function buildFakeWs() {
  const sent = [];
  let onMessage = null;
  const FakeWS = function () {
    this.send = (raw) => sent.push(raw);
    this.addEventListener = (type, fn) => {
      if (type === 'message') onMessage = fn;
    };
  };
  return { FakeWS, sent, fire: (payload) => onMessage({ data: JSON.stringify(payload) }) };
}

describe('recorder GUI: device-disconnected error banner (slice #10)', () => {
  beforeEach(() => {
    setupDom();
    app._resetSensitiveState();
  });

  test('device-disconnected renders a banner containing the device label', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'device-disconnected', device_label: 'Pixel_7_API_34', reason: 'adb stalled' });

    const banner = document.getElementById('device-disconnected-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Pixel_7_API_34');
  });

  test('banner is non-dismissible (role=alert, no close button)', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'device-disconnected', device_label: 'iPhone-15', reason: null });

    const banner = document.getElementById('device-disconnected-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.getAttribute('data-non-dismissible')).toBe('true');
    // No close button — search for any button with the usual close-affordance text.
    const closers = banner.querySelectorAll('button');
    expect(closers.length).toBe(0);
  });

  test('banner hides the live step list', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    // Pre-existing steps must visually disappear when the device drops.
    app.appendStep({ id: 'tap_x', index: 1, action: 'tap', target: 'Login' });

    fire({ type: 'device-disconnected', device_label: 'Pixel_7', reason: null });

    const list = document.getElementById('step-list');
    expect(list.hidden).toBe(true);
  });

  test('banner text instructs the user to rerun /mobile-automator:record', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'device-disconnected', device_label: 'Pixel_7', reason: null });

    const banner = document.getElementById('device-disconnected-banner');
    expect(banner.textContent).toContain('/mobile-automator:record');
  });

  test('repeated device-disconnected messages do not multiply banners (idempotent)', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'device-disconnected', device_label: 'Pixel_7', reason: null });
    fire({ type: 'device-disconnected', device_label: 'Pixel_7', reason: null });
    fire({ type: 'device-disconnected', device_label: 'Pixel_7', reason: null });

    const banners = document.querySelectorAll('#device-disconnected-banner');
    expect(banners.length).toBe(1);
  });
});
