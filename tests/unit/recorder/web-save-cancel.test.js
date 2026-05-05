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

describe('recorder GUI: Save & Cancel button wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-save"></button>
      <button id="btn-cancel"></button>
    `;
  });

  test('clicking #btn-save invokes sendWs with {type: "save"}', () => {
    const sent = [];
    const sendWs = (msg) => sent.push(msg);
    app.wireButtons({ document, sendWs });

    document.getElementById('btn-save').dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([{ type: 'save' }]);
  });

  test('clicking #btn-cancel invokes sendWs with {type: "cancel"}', () => {
    const sent = [];
    const sendWs = (msg) => sent.push(msg);
    app.wireButtons({ document, sendWs });

    document.getElementById('btn-cancel').dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([{ type: 'cancel' }]);
  });

  test('wiring twice does not double-bind handlers (idempotent)', () => {
    const sent = [];
    const sendWs = (msg) => sent.push(msg);
    app.wireButtons({ document, sendWs });
    app.wireButtons({ document, sendWs });

    document.getElementById('btn-save').dispatchEvent(new window.Event('click'));
    document.getElementById('btn-cancel').dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([{ type: 'save' }, { type: 'cancel' }]);
  });
});
