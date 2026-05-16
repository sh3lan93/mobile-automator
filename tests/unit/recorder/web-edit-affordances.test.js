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

describe('inline editors send the correct WS message', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><ul id="step-list"></ul>';
  });

  function openMenuAndClick(selectorRoot, action) {
    document.querySelector(selectorRoot + ' button.step-menu').click();
    [...document.querySelectorAll('.step-menu-popover .menu-item')]
      .find((b) => b.getAttribute('data-edit-action') === action).click();
  }

  test('rename: commit with Enter sends rename-step', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    app.attachEditAffordances({ document, sendWs });
    openMenuAndClick('[data-step-id="tap_login"]', 'rename');
    const input = document.querySelector('[data-step-id="tap_login"] input.inline-edit');
    expect(input).not.toBeNull();
    input.value = 'Tap the Login button';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendWs).toHaveBeenCalledWith({ type: 'rename-step', step_id: 'tap_login', new_display_name: 'Tap the Login button' });
  });

  test('rename: Escape cancels — no WS, input removed', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    app.attachEditAffordances({ document, sendWs });
    openMenuAndClick('[data-step-id="tap_login"]', 'rename');
    const input = document.querySelector('[data-step-id="tap_login"] input.inline-edit');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sendWs).not.toHaveBeenCalled();
    expect(document.querySelector('[data-step-id="tap_login"] input.inline-edit')).toBeNull();
  });

  test('edit-value on type step sends edit-value', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'type_email', index: 1, action: 'type', value: 'usr@acme', field_label: 'Email' });
    app.attachEditAffordances({ document, sendWs });
    openMenuAndClick('[data-step-id="type_email"]', 'edit-value');
    const input = document.querySelector('[data-step-id="type_email"] input.inline-edit');
    expect(input.value).toBe('usr@acme');
    input.value = 'user@acme.io';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendWs).toHaveBeenCalledWith({ type: 'edit-value', step_id: 'type_email', new_value: 'user@acme.io' });
  });

  test('edit-assertion-text sends edit-assertion-text', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'old text', anchor_step_id: 'tap_login' });
    app.attachEditAffordances({ document, sendWs });
    openMenuAndClick('[data-assertion-id="a1"]', 'edit-assertion-text');
    const input = document.querySelector('[data-assertion-id="a1"] input.inline-edit');
    expect(input.value).toBe('old text');
    input.value = 'new text';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendWs).toHaveBeenCalledWith({ type: 'edit-assertion-text', assertion_id: 'a1', new_nl_text: 'new text' });
  });

  test('blank commit is ignored (no WS)', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: '"Login"' });
    app.attachEditAffordances({ document, sendWs });
    openMenuAndClick('[data-step-id="tap_login"]', 'rename');
    const input = document.querySelector('[data-step-id="tap_login"] input.inline-edit');
    input.value = '   ';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendWs).not.toHaveBeenCalled();
  });
});
