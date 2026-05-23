/**
 * @jest-environment jsdom
 */

'use strict';

// Mark the environment so app.js does not auto-connect a real WebSocket.
window.__RECORDER_TEST__ = true;

const path = require('path');
const appPath = path.resolve(__dirname, '../../../tools/recorder/web/app.js');

// eslint-disable-next-line import/no-dynamic-require
const app = require(appPath);

describe('Add Assertion button', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-save"></button>
      <button id="btn-cancel"></button>
      <button id="btn-add-assertion" disabled></button>
      <ul id="step-list"></ul>
    `;
  });

  test('button #btn-add-assertion is disabled initially', () => {
    const btn = document.getElementById('btn-add-assertion');
    expect(btn.disabled).toBe(true);
  });

  test('button becomes enabled after first step-added WS message', () => {
    const btn = document.getElementById('btn-add-assertion');
    expect(btn.disabled).toBe(true);

    app.appendStep({ id: 'tap_login', index: 1, action: 'Tap', target: 'Login' });

    expect(btn.disabled).toBe(false);
  });

  test('clicking the button sends {type: "request-assertion-screenshot"} over the stub WS', () => {
    // First add a step so the button is enabled and latestStepId is set.
    app.appendStep({ id: 'tap_login', index: 1, action: 'Tap', target: 'Login' });

    const sent = [];
    const sendWs = (msg) => sent.push(msg);
    app.wireButtons({ document, sendWs });

    document.getElementById('btn-add-assertion').dispatchEvent(new window.Event('click'));

    expect(sent).toContainEqual({ type: 'request-assertion-screenshot' });
  });

  test('latestStepId is captured at click time, not at save time', () => {
    app.appendStep({ id: 'step_1', index: 1, action: 'Tap', target: 'A' });

    const capturedAnchors = [];
    const sendWs = jest.fn();
    app.wireButtons({
      document,
      sendWs,
      onAssertionScreenshotRequested: (anchor) => capturedAnchors.push(anchor),
    });

    document.getElementById('btn-add-assertion').dispatchEvent(new window.Event('click'));

    // The anchor captured must be step_1 (the step before click).
    expect(capturedAnchors).toEqual(['step_1']);

    // Now add another step (simulating further recording after click).
    app.appendStep({ id: 'step_2', index: 2, action: 'Tap', target: 'B' });

    // The originally captured anchor should still be step_1.
    expect(capturedAnchors).toEqual(['step_1']);
  });
});
