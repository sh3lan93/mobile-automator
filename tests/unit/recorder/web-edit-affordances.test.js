/**
 * @jest-environment jsdom
 */
'use strict';

window.__RECORDER_TEST__ = true;
const path = require('path');
const app = require(path.resolve(__dirname, '../../../tools/recorder/web/app.js'));

describe('"⋯" menu rendering & per-row-type filtering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><ul id="step-list"></ul>';
  });

  test('every step row gets an always-visible .step-menu button', () => {
    const li = app.renderStepRow({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    const btn = li.querySelector('button.step-menu');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Edit step');
  });

  test('generic step row carries data-action for filtering', () => {
    const li = app.renderStepRow({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    expect(li.getAttribute('data-action')).toBe('tap');
  });

  test('opening the menu on a generic step shows Rename + Delete only', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });
    document.querySelector('[data-step-id="tap_login"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')].map((b) => b.getAttribute('data-edit-action'));
    expect(items).toEqual(['rename', 'delete']);
  });

  test('opening the menu on a type step also shows Edit value', () => {
    app.appendStep({ id: 'type_email', index: 1, action: 'type', value: 'a@b', field_label: 'Email' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });
    document.querySelector('[data-step-id="type_email"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')].map((b) => b.getAttribute('data-edit-action'));
    expect(items).toEqual(['rename', 'delete', 'edit-value']);
  });

  test('assertion row menu shows Edit text only (no reorder/insert/type-change anywhere)', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'Shown', anchor_step_id: 'tap_login' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });
    document.querySelector('[data-assertion-id="a1"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')].map((b) => b.getAttribute('data-edit-action'));
    expect(items).toEqual(['edit-assertion-text']);
    expect(document.body.innerHTML).not.toMatch(/reorder|insert|change-type/i);
  });

  test('assertion row carries data-anchor-step-id', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    const li = app.appendAssertionRow({ id: 'a1', nl_text: 'Shown', anchor_step_id: 'tap_login' });
    expect(li.getAttribute('data-anchor-step-id')).toBe('tap_login');
  });
});
