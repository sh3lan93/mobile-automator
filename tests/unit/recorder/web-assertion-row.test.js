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

describe('appendAssertionRow', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="step-list"></ul>';
  });

  test('inserts <li class="assertion-row"> after the anchor step row', () => {
    // Add an anchor step row manually.
    const list = document.getElementById('step-list');
    app.appendStep({ id: 'tap_login', index: 1, action: 'Tap', target: '"Login"' });
    app.appendStep({ id: 'tap_submit', index: 2, action: 'Tap', target: '"Submit"' });

    app.appendAssertionRow({
      id: 'a1',
      nl_text: 'Welcome screen is shown',
      anchor_step_id: 'tap_login',
    });

    const anchorLi = list.querySelector('[data-step-id="tap_login"]');
    const assertionLi = anchorLi.nextSibling;

    expect(assertionLi).not.toBeNull();
    expect(assertionLi.classList.contains('assertion-row')).toBe(true);
    expect(assertionLi.getAttribute('data-assertion-id')).toBe('a1');
  });

  test('renders "Verifies:" label and nl_text', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'Tap', target: '"Login"' });

    const li = app.appendAssertionRow({
      id: 'a1',
      nl_text: 'Button is visible',
      anchor_step_id: 'tap_login',
    });

    const label = li.querySelector('.assertion-label');
    expect(label).not.toBeNull();
    expect(label.textContent).toBe('Verifies:');

    const text = li.querySelector('.assertion-text');
    expect(text).not.toBeNull();
    expect(text.textContent).toBe('Button is visible');
  });

  test('falls back to append-at-end when anchor step not found', () => {
    app.appendStep({ id: 'tap_login', index: 1, action: 'Tap', target: '"Login"' });

    const list = document.getElementById('step-list');
    const beforeCount = list.children.length;

    const li = app.appendAssertionRow({
      id: 'a2',
      nl_text: 'Some assertion',
      anchor_step_id: 'non_existent_step',
    });

    expect(li).not.toBeNull();
    expect(list.children.length).toBe(beforeCount + 1);
    // Should be appended at the end.
    expect(list.lastElementChild).toBe(li);
    expect(li.classList.contains('assertion-row')).toBe(true);
  });
});
