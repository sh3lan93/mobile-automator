/**
 * @jest-environment jsdom
 */
'use strict';

window.__RECORDER_TEST__ = true;
const path = require('path');
const app = require(path.resolve(__dirname, '../../../tools/recorder/web/app.js'));

// Helper: open the ⋯ menu on a row and return all menu-item data-edit-action values.
function openMenuActions(stepSel) {
  document.querySelector(stepSel + ' button.step-menu').click();
  return [...document.querySelectorAll('.step-menu-popover .menu-item')].map(
    (b) => b.getAttribute('data-edit-action')
  );
}

// Helper: open the ⋯ menu and click a specific action item.
function openMenuAndClick(stepSel, action) {
  document.querySelector(stepSel + ' button.step-menu').click();
  const item = [...document.querySelectorAll('.step-menu-popover .menu-item')].find(
    (b) => b.getAttribute('data-edit-action') === action
  );
  if (item) item.click();
}

describe('Mark as dismiss_keyboard — agnostic mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><ul id="step-list"></ul>';
    // Reset mode to aware between tests so tests are isolated.
    app._setMode('platform-aware');
  });

  test('agnostic mode: tap row menu contains mark-as-semantic item with correct text', () => {
    app._setMode('platform-agnostic');
    app.appendStep({ id: 'tap_x', index: 1, action: 'tap', target: 'Button' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });

    // Open the menu and inspect the items in one operation.
    document.querySelector('[data-step-id="tap_x"] button.step-menu').click();
    const items = [...document.querySelectorAll('.step-menu-popover .menu-item')];
    const actions = items.map((b) => b.getAttribute('data-edit-action'));
    expect(actions).toContain('mark-as-semantic');

    // Verify item label text.
    const item = items.find((b) => b.getAttribute('data-edit-action') === 'mark-as-semantic');
    expect(item).not.toBeNull();
    expect(item.textContent).toBe('Mark as dismiss_keyboard');
  });

  test('aware mode: tap row menu has Rename + Delete only (no mark-as-semantic)', () => {
    app._setMode('platform-aware');
    app.appendStep({ id: 'tap_x', index: 1, action: 'tap', target: 'Button' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });

    const actions = openMenuActions('[data-step-id="tap_x"]');
    expect(actions).toEqual(['rename', 'delete']);
    expect(actions).not.toContain('mark-as-semantic');
  });

  test('agnostic mode: swipe and type rows do NOT expose mark-as-semantic', () => {
    app._setMode('platform-agnostic');
    app.appendStep({ id: 'swipe_left', index: 1, action: 'swipe', direction: 'left' });
    app.appendStep({ id: 'type_email', index: 2, action: 'type', value: 'a@b', field_label: 'Email' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });

    const swipeActions = openMenuActions('[data-step-id="swipe_left"]');
    expect(swipeActions).not.toContain('mark-as-semantic');

    // Close popover before opening next
    const open = document.querySelector('.step-menu-popover');
    if (open && open.parentNode) open.parentNode.removeChild(open);

    const typeActions = openMenuActions('[data-step-id="type_email"]');
    expect(typeActions).not.toContain('mark-as-semantic');
  });

  test('agnostic mode: long_press, double_tap, press_button rows do NOT expose mark-as-semantic', () => {
    app._setMode('platform-agnostic');
    app.appendStep({ id: 'lp_1', index: 1, action: 'long_press', target: 'Icon' });
    app.appendStep({ id: 'dt_1', index: 2, action: 'double_tap', target: 'Logo' });
    app.appendStep({ id: 'pb_1', index: 3, action: 'press_button', target: 'OK' });
    app.attachEditAffordances({ document, sendWs: jest.fn() });

    const lpActions = openMenuActions('[data-step-id="lp_1"]');
    expect(lpActions).not.toContain('mark-as-semantic');
    expect(lpActions).toEqual(['rename', 'delete']);

    const open1 = document.querySelector('.step-menu-popover');
    if (open1 && open1.parentNode) open1.parentNode.removeChild(open1);

    const dtActions = openMenuActions('[data-step-id="dt_1"]');
    expect(dtActions).not.toContain('mark-as-semantic');
    expect(dtActions).toEqual(['rename', 'delete']);

    const open2 = document.querySelector('.step-menu-popover');
    if (open2 && open2.parentNode) open2.parentNode.removeChild(open2);

    const pbActions = openMenuActions('[data-step-id="pb_1"]');
    expect(pbActions).not.toContain('mark-as-semantic');
    expect(pbActions).toEqual(['rename', 'delete']);
  });

  test('agnostic mode: clicking mark-as-semantic sends correct WS message', () => {
    app._setMode('platform-agnostic');
    const sendWs = jest.fn();
    app.appendStep({ id: 'tap_x', index: 1, action: 'tap', target: 'Button' });
    app.attachEditAffordances({ document, sendWs });

    openMenuAndClick('[data-step-id="tap_x"]', 'mark-as-semantic');

    expect(sendWs).toHaveBeenCalledWith({
      type: 'mark-as-semantic',
      step_id: 'tap_x',
      semantic_action: 'dismiss_keyboard',
    });
  });

  test('step-marked-semantic WS message updates row data-action and .step-action text', () => {
    app._setMode('platform-agnostic');
    app.appendStep({ id: 'tap_x', index: 1, action: 'tap', target: 'Button' });

    // Simulate receiving step-marked-semantic from the server.
    app.applyStepMarkedSemantic(document, {
      step_id: 'tap_x',
      semantic_action: 'dismiss_keyboard',
    });

    const li = document.querySelector('[data-step-id="tap_x"]');
    expect(li.getAttribute('data-action')).toBe('dismiss_keyboard');
    expect(li.querySelector('.step-action').textContent).toBe('dismiss_keyboard');
  });
});

describe('mode-banner visibility', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="modal-root"></div><ul id="step-list"></ul><div id="mode-banner" hidden></div>';
    app._setMode('platform-aware');
  });

  test('_setMode platform-agnostic: unhides banner and sets exact text', () => {
    app._setMode('platform-agnostic');
    app.applyModeBanner(document);

    const banner = document.getElementById('mode-banner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe(
      "Recording in agnostic mode. press_back / grant_permission / deny_permission auto-detected; click 'Mark as dismiss_keyboard' on a tap step to mark it manually."
    );
  });

  test('_setMode platform-aware: banner stays hidden', () => {
    app._setMode('platform-aware');
    app.applyModeBanner(document);

    const banner = document.getElementById('mode-banner');
    expect(banner.hidden).toBe(true);
  });
});

describe('attachWsClient routes step-marked-semantic', () => {
  test('step-marked-semantic is routed to onStepMarkedSemantic handler', () => {
    const calls = [];
    const FakeWS = function () {
      this.addEventListener = (t, fn) => {
        this._fn = fn;
      };
    };
    const ws = app.attachWsClient({
      url: 'ws://x',
      WebSocketCtor: FakeWS,
      onStepMarkedSemantic: (p) => calls.push(['m', p.step_id, p.semantic_action]),
    });
    ws._fn({
      data: JSON.stringify({
        type: 'step-marked-semantic',
        step_id: 'tap_x',
        semantic_action: 'dismiss_keyboard',
      }),
    });
    expect(calls).toEqual([['m', 'tap_x', 'dismiss_keyboard']]);
  });
});
