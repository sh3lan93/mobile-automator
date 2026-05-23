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

function setupDom() {
  document.body.innerHTML = `
    <ul id="step-list"></ul>
    <footer>
      <button id="btn-cancel"></button>
      <button id="btn-save"></button>
    </footer>
  `;
}

function clickSave() {
  document.getElementById('btn-save').dispatchEvent(new window.Event('click'));
}

describe('recorder GUI: Save-time sensitive-input confirmation (slice #9)', () => {
  beforeEach(() => {
    setupDom();
    app._resetSensitiveState();
  });

  test('Save with zero sensitive steps sends {type:"save"} immediately', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });

    clickSave();
    expect(sent).toEqual([{ type: 'save' }]);
    expect(document.getElementById('save-sensitive-confirm')).toBeNull();
  });

  test('Save with one flagged sensitive step shows inline confirmation and suppresses save', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({
      id: 'type_pw',
      index: 1,
      action: 'type',
      value: 'secret',
      field_label: 'Password',
      sensitive: true,
    });

    clickSave();

    const confirm = document.getElementById('save-sensitive-confirm');
    expect(confirm).not.toBeNull();
    expect(confirm.getAttribute('role')).toBe('alert');
    expect(confirm.textContent).toContain('1 sensitive step captured as literal value. Save anyway?');
    expect(sent).toEqual([]);
  });

  test('N=3 flagged sensitive steps produces plural text with the number', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    for (let i = 1; i <= 3; i++) {
      app.appendStep({
        id: 'type_pw' + i,
        index: i,
        action: 'type',
        value: 'x',
        field_label: 'Password',
        sensitive: true,
      });
    }

    clickSave();

    const confirm = document.getElementById('save-sensitive-confirm');
    expect(confirm).not.toBeNull();
    expect(confirm.textContent).toContain('3 sensitive steps captured as literal values. Save anyway?');
    expect(sent).toEqual([]);
  });

  test('"Save anyway" button sends {type:"save"} and removes the prompt', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'type_pw', index: 1, action: 'type', value: 'secret', field_label: 'Password', sensitive: true });
    clickSave();

    const confirm = document.getElementById('save-sensitive-confirm');
    const saveAnyway = confirm.querySelector('[data-action="save-anyway"]');
    expect(saveAnyway).not.toBeNull();
    saveAnyway.dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([{ type: 'save' }]);
    expect(document.getElementById('save-sensitive-confirm')).toBeNull();
  });

  test('"Cancel" button removes the prompt and does NOT send anything', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'type_pw', index: 1, action: 'type', value: 'secret', field_label: 'Password', sensitive: true });
    clickSave();

    const confirm = document.getElementById('save-sensitive-confirm');
    const cancel = confirm.querySelector('[data-action="cancel"]');
    expect(cancel).not.toBeNull();
    cancel.dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([]);
    expect(document.getElementById('save-sensitive-confirm')).toBeNull();
  });

  test('--allow-sensitive-input bypasses the prompt even with flagged steps', () => {
    app._setAllowSensitiveInput(true);
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'type_pw', index: 1, action: 'type', value: 'secret', field_label: 'Password', sensitive: true });

    clickSave();

    expect(sent).toEqual([{ type: 'save' }]);
    expect(document.getElementById('save-sensitive-confirm')).toBeNull();
  });

  test('A sensitive step edited via applyValueEdited no longer counts at Save time', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'type_pw', index: 1, action: 'type', value: 'secret', field_label: 'Password', sensitive: true });
    app.applyValueEdited(document, { step_id: 'type_pw', new_value: '${env.PASSWORD}' });

    clickSave();

    expect(sent).toEqual([{ type: 'save' }]);
    expect(document.getElementById('save-sensitive-confirm')).toBeNull();
  });

  test('Save clicked twice while the prompt is open does not duplicate the prompt', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'type_pw', index: 1, action: 'type', value: 'secret', field_label: 'Password', sensitive: true });

    clickSave();
    clickSave();

    expect(document.querySelectorAll('#save-sensitive-confirm').length).toBe(1);
    expect(sent).toEqual([]);
  });

  test('Mixed sensitive + non-sensitive: count reflects only flagged steps', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    app.appendStep({ id: 'type_email', index: 2, action: 'type', value: 'a@b.com', field_label: 'Email', sensitive: false });
    app.appendStep({ id: 'type_pw', index: 3, action: 'type', value: 'secret', field_label: 'Password', sensitive: true });

    clickSave();

    const confirm = document.getElementById('save-sensitive-confirm');
    expect(confirm).not.toBeNull();
    expect(confirm.textContent).toContain('1 sensitive step captured as literal value. Save anyway?');
  });

  test('Deleting the only sensitive step causes Save to be direct', () => {
    const sent = [];
    app.wireButtons({ document, sendWs: (m) => sent.push(m) });

    app.appendStep({ id: 'type_pw', index: 1, action: 'type', value: 'secret', field_label: 'Password', sensitive: true });
    app.applyStepDeleted(document, { step_id: 'type_pw', assertion_policy: 'none' });

    clickSave();

    expect(sent).toEqual([{ type: 'save' }]);
    expect(document.getElementById('save-sensitive-confirm')).toBeNull();
  });
});
