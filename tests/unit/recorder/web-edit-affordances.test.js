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
    const li = app.renderStepRow({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    const btn = li.querySelector('button.step-menu');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Edit step');
  });

  test('generic step row carries data-action for filtering', () => {
    const li = app.renderStepRow({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    expect(li.getAttribute('data-action')).toBe('tap');
  });

  test('opening the menu on a generic step shows Rename + Delete only', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });
    document.querySelector('[data-step-id="tap_login"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')].map((b) => b.getAttribute('data-edit-action'));
    expect(items).toEqual(['rename', 'delete']);
  });

  test('type step menu is Delete + Edit value (no Rename — slug derives from field)', () => {
    app.appendStep({ id: 'type_email', index: 1, action: 'type', value: 'a@b', field_label: 'Email' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });
    document.querySelector('[data-step-id="type_email"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')].map((b) => b.getAttribute('data-edit-action'));
    expect(items).toEqual(['delete', 'edit-value']);
  });

  test('swipe step menu is Delete only (no Rename — row has no name span)', () => {
    app.appendStep({ id: 'swipe_left', index: 1, action: 'swipe', direction: 'left' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });
    document.querySelector('[data-step-id="swipe_left"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')].map((b) => b.getAttribute('data-edit-action'));
    expect(items).toEqual(['delete']);
  });

  test('assertion row menu shows Edit text only (no reorder/insert/type-change anywhere)', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'Shown', anchor_step_id: 'tap_login' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });
    document.querySelector('[data-assertion-id="a1"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')].map((b) => b.getAttribute('data-edit-action'));
    expect(items).toEqual(['edit-assertion-text']);
    expect(document.body.innerHTML).not.toMatch(/reorder|insert|change-type/i);
  });

  test('assertion row carries data-anchor-step-id', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
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
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
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
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
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
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
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
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    app.attachEditAffordances({ document, sendWs });
    openMenuAndClick('[data-step-id="tap_login"]', 'rename');
    const input = document.querySelector('[data-step-id="tap_login"] input.inline-edit');
    input.value = '   ';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sendWs).not.toHaveBeenCalled();
  });
});

describe('delete prompt', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><ul id="step-list"></ul>';
  });
  function openDelete(stepSel) {
    document.querySelector(stepSel + ' button.step-menu').click();
    [...document.querySelectorAll('.step-menu-popover .menu-item')]
      .find((b) => b.getAttribute('data-edit-action') === 'delete').click();
  }

  test('no anchored assertions → plain confirm → delete-step policy none', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_skip', index: 1, action: 'tap', target: 'Skip' });
    app.attachEditAffordances({ document, sendWs });
    openDelete('[data-step-id="tap_skip"]');
    const prompt = document.querySelector('.delete-prompt');
    expect(prompt).not.toBeNull();
    expect(prompt.querySelectorAll('.delete-option').length).toBe(0);
    prompt.querySelector('[data-delete-confirm]').click();
    expect(sendWs).toHaveBeenCalledWith({ type: 'delete-step', step_id: 'tap_skip', assertion_policy: 'none' });
  });

  test('anchored assertions → 3-option prompt, reanchor is the default', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_submit', index: 1, action: 'tap', target: 'Submit' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'Dashboard', anchor_step_id: 'tap_submit' });
    app.appendAssertionRow({ id: 'a2', nl_text: 'Toast', anchor_step_id: 'tap_submit' });
    app.attachEditAffordances({ document, sendWs });
    openDelete('[data-step-id="tap_submit"]');
    const prompt = document.querySelector('.delete-prompt');
    const opts = [...prompt.querySelectorAll('.delete-option')].map((o) => o.getAttribute('data-policy'));
    expect(opts).toEqual(['reanchor', 'cascade']);
    expect(prompt.querySelector('input[name="delete-policy"]:checked').value).toBe('reanchor');
    prompt.querySelector('[data-delete-confirm]').click();
    expect(sendWs).toHaveBeenCalledWith({ type: 'delete-step', step_id: 'tap_submit', assertion_policy: 'reanchor' });
  });

  test('choosing cascade sends cascade', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_submit', index: 1, action: 'tap', target: 'Submit' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'Dashboard', anchor_step_id: 'tap_submit' });
    app.attachEditAffordances({ document, sendWs });
    openDelete('[data-step-id="tap_submit"]');
    const prompt = document.querySelector('.delete-prompt');
    prompt.querySelector('input[name="delete-policy"][value="cascade"]').checked = true;
    prompt.querySelector('[data-delete-confirm]').click();
    expect(sendWs).toHaveBeenCalledWith({ type: 'delete-step', step_id: 'tap_submit', assertion_policy: 'cascade' });
  });

  test('cancel sends nothing and removes the prompt', () => {
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_submit', index: 1, action: 'tap', target: 'Submit' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'Dashboard', anchor_step_id: 'tap_submit' });
    app.attachEditAffordances({ document, sendWs });
    openDelete('[data-step-id="tap_submit"]');
    document.querySelector('.delete-prompt [data-delete-cancel]').click();
    expect(sendWs).not.toHaveBeenCalled();
    expect(document.querySelector('.delete-prompt')).toBeNull();
  });
});

describe('confirmation display-effect', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><ul id="step-list"></ul>';
  });

  test('applyStepRenamed relabels the row target with the same quote-wrap contract as renderStepRow (#40)', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    app.applyStepRenamed(document, { step_id: 'tap_login', new_display_name: 'Tap the Login button' });
    const li = document.querySelector('[data-step-id="tap_login"]');
    expect(li.querySelector('.step-target').textContent).toBe('"Tap the Login button"');
    expect(li.getAttribute('data-step-id')).toBe('tap_login');
  });

  test('applyValueEdited updates the type step value span', () => {
    app.appendStep({ id: 'type_email', index: 1, action: 'type', value: 'a@b', field_label: 'Email' });
    app.applyValueEdited(document, { step_id: 'type_email', new_value: 'user@acme.io' });
    expect(document.querySelector('[data-step-id="type_email"] .step-value').textContent).toBe('"user@acme.io"');
  });

  test('applyAssertionTextEdited updates the assertion text span', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'tap', target: 'Login' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'old', anchor_step_id: 'tap_login' });
    app.applyAssertionTextEdited(document, { assertion_id: 'a1', new_nl_text: 'new text' });
    expect(document.querySelector('[data-assertion-id="a1"] .assertion-text').textContent).toBe('new text');
  });

  test('applyStepDeleted cascade removes the step and its anchored assertions', () => {
    app.appendStep({ id: 'tap_a', index: 1, action: 'tap', target: 'A' });
    app.appendStep({ id: 'tap_b', index: 2, action: 'tap', target: 'B' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'x', anchor_step_id: 'tap_b' });
    app.applyStepDeleted(document, { step_id: 'tap_b', assertion_policy: 'cascade' });
    expect(document.querySelector('[data-step-id="tap_b"]')).toBeNull();
    expect(document.querySelector('[data-assertion-id="a1"]')).toBeNull();
  });

  test('applyStepDeleted reanchor moves assertions to the previous surviving step', () => {
    app.appendStep({ id: 'tap_a', index: 1, action: 'tap', target: 'A' });
    app.appendStep({ id: 'tap_b', index: 2, action: 'tap', target: 'B' });
    app.appendStep({ id: 'tap_c', index: 3, action: 'tap', target: 'C' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'x', anchor_step_id: 'tap_b' });
    app.applyStepDeleted(document, { step_id: 'tap_b', assertion_policy: 'reanchor' });
    const a = document.querySelector('[data-assertion-id="a1"]');
    expect(a).not.toBeNull();
    expect(a.getAttribute('data-anchor-step-id')).toBe('tap_a');
    expect(document.querySelector('[data-step-id="tap_b"]')).toBeNull();
  });

  test('applyStepDeleted reanchor preserves relative order of multiple assertions', () => {
    app.appendStep({ id: 'tap_a', index: 1, action: 'tap', target: 'A' });
    app.appendStep({ id: 'tap_b', index: 2, action: 'tap', target: 'B' });
    app.appendAssertionRow({ id: 'a1', nl_text: 'first', anchor_step_id: 'tap_b' });
    app.appendAssertionRow({ id: 'a2', nl_text: 'second', anchor_step_id: 'tap_b' });
    const before = [...document.querySelectorAll('.assertion-row')].map((r) => r.getAttribute('data-assertion-id'));
    app.applyStepDeleted(document, { step_id: 'tap_b', assertion_policy: 'reanchor' });
    const after = [...document.querySelectorAll('.assertion-row')].map((r) => r.getAttribute('data-assertion-id'));
    // The move must not reorder the assertions relative to each other.
    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
    after.forEach((id) => {
      expect(document.querySelector('[data-assertion-id="' + id + '"]').getAttribute('data-anchor-step-id')).toBe('tap_a');
    });
  });

  test('attachWsClient routes the 4 confirmations to their handlers', () => {
    const calls = [];
    const FakeWS = function () { this.addEventListener = (t, fn) => { this._fn = fn; }; };
    const ws = app.attachWsClient({
      url: 'ws://x', WebSocketCtor: FakeWS,
      onStepRenamed: (p) => calls.push(['r', p.step_id]),
      onStepDeleted: (p) => calls.push(['d', p.step_id]),
      onValueEdited: (p) => calls.push(['v', p.step_id]),
      onAssertionTextEdited: (p) => calls.push(['a', p.assertion_id]),
    });
    ws._fn({ data: JSON.stringify({ type: 'step-renamed', step_id: 'tap_x', new_display_name: 'X' }) });
    ws._fn({ data: JSON.stringify({ type: 'step-deleted', step_id: 'tap_y', assertion_policy: 'none' }) });
    ws._fn({ data: JSON.stringify({ type: 'value-edited', step_id: 'type_z', new_value: 'v' }) });
    ws._fn({ data: JSON.stringify({ type: 'assertion-text-edited', assertion_id: 'a9', new_nl_text: 't' }) });
    expect(calls).toEqual([['r', 'tap_x'], ['d', 'tap_y'], ['v', 'type_z'], ['a', 'a9']]);
  });
});
