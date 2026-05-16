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

describe('recorder GUI: step-list rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="step-list"></ul>';
  });

  describe('renderStepRow', () => {
    test('returns an <li> with data attributes, three child spans, and a step-menu button (slice #28)', () => {
      const li = app.renderStepRow({
        id: 'tap_login',
        index: 3,
        action: 'Tap',
        target: '"Login"',
      });

      expect(li).toBeInstanceOf(window.HTMLLIElement);
      expect(li.classList.contains('step-row')).toBe(true);
      expect(li.getAttribute('data-step-id')).toBe('tap_login');
      expect(li.getAttribute('data-index')).toBe('3');

      const spans = li.querySelectorAll('span');
      expect(spans.length).toBe(3);

      const num = li.querySelector('.step-num');
      const action = li.querySelector('.step-action');
      const target = li.querySelector('.step-target');
      expect(num).not.toBeNull();
      expect(action).not.toBeNull();
      expect(target).not.toBeNull();
      expect(num.textContent).toBe('3.');
      expect(action.textContent).toBe('Tap');
      expect(target.textContent).toBe('"Login"');

      // Per #28 the always-visible step-menu (⋯) button is now rendered on every row.
      expect(li.querySelector('button.step-menu')).not.toBeNull();
    });

    test('adds "unnamed" class when is_unnamed is true', () => {
      const li = app.renderStepRow({
        id: 'unnamed_step_1',
        index: 1,
        action: 'Tap',
        target: '(unknown)',
        is_unnamed: true,
      });

      expect(li.classList.contains('step-row')).toBe(true);
      expect(li.classList.contains('unnamed')).toBe(true);
    });

    test('omits "unnamed" class when is_unnamed is falsy', () => {
      const li = app.renderStepRow({
        id: 'tap_x',
        index: 2,
        action: 'Tap',
        target: 'X',
      });
      expect(li.classList.contains('unnamed')).toBe(false);
    });

    test('renders a type step as `Type "<value>" into "<field_label>"`', () => {
      const li = app.renderStepRow({
        id: 'type_email',
        index: 4,
        action: 'type',
        value: 'test@example.com',
        field_label: 'Email',
      });

      expect(li).toBeInstanceOf(window.HTMLLIElement);
      expect(li.classList.contains('step-row')).toBe(true);
      expect(li.getAttribute('data-step-id')).toBe('type_email');
      expect(li.getAttribute('data-index')).toBe('4');
      expect(li.textContent).toMatch(
        /^\s*\d+\.\s*Type\s*"test@example\.com"\s*into\s*"Email"\s*⋯\s*$/,
      );
    });

    test('marks type-step <li> with data-action="type" for CSS targeting', () => {
      const li = app.renderStepRow({
        id: 'type_email',
        index: 4,
        action: 'type',
        value: 'hello',
        field_label: 'Email',
      });
      expect(li.getAttribute('data-action')).toBe('type');
    });

    test('masks sensitive type values with bullet characters (full caution UI in #30)', () => {
      const li = app.renderStepRow({
        id: 'type_password',
        index: 5,
        action: 'type',
        value: 'p4ssw0rd!',
        field_label: 'Password',
        sensitive: true,
      });

      // The literal value must NOT appear in the rendered DOM.
      expect(li.textContent).not.toContain('p4ssw0rd!');
      // The field label is still shown (not sensitive).
      expect(li.textContent).toContain('"Password"');

      // The value span should contain only bullet characters, length matching
      // the original value length.
      const valueSpan = li.querySelector('.step-value');
      expect(valueSpan).not.toBeNull();
      const inner = valueSpan.textContent.replace(/^"|"$/g, '');
      expect(inner.length).toBe('p4ssw0rd!'.length);
      expect(inner).toMatch(/^•+$/);
    });

    test('renders non-sensitive type values literally (regression guard)', () => {
      const li = app.renderStepRow({
        id: 'type_email_plain',
        index: 6,
        action: 'type',
        value: 'user@example.com',
        field_label: 'Email',
        sensitive: false,
      });

      expect(li.textContent).toContain('"user@example.com"');
      expect(li.textContent).not.toMatch(/•/);
    });

    // Slice #24: long-press / double-tap / swipe rendering. The classifier
    // already detects all three (slice #22); these tests pin the user-visible
    // surface — the human-readable labels the issue spec calls for.

    test('renders a long_press step as `Long press "<target>"`', () => {
      const li = app.renderStepRow({
        id: 'long_press_settings_icon',
        index: 7,
        action: 'long_press',
        target: 'Settings Icon',
      });

      expect(li).toBeInstanceOf(window.HTMLLIElement);
      expect(li.classList.contains('step-row')).toBe(true);
      expect(li.getAttribute('data-step-id')).toBe('long_press_settings_icon');
      expect(li.getAttribute('data-action')).toBe('long_press');
      expect(li.textContent).toMatch(
        /^\s*\d+\.\s*Long press\s*"Settings Icon"\s*⋯\s*$/,
      );
      const action = li.querySelector('.step-action');
      const target = li.querySelector('.step-target');
      expect(action).not.toBeNull();
      expect(action.textContent).toBe('Long press');
      expect(target).not.toBeNull();
      expect(target.textContent).toBe('"Settings Icon"');
    });

    test('renders a double_tap step as `Double tap "<target>"`', () => {
      const li = app.renderStepRow({
        id: 'double_tap_like_button',
        index: 8,
        action: 'double_tap',
        target: 'Like Button',
      });

      expect(li.getAttribute('data-action')).toBe('double_tap');
      expect(li.textContent).toMatch(
        /^\s*\d+\.\s*Double tap\s*"Like Button"\s*⋯\s*$/,
      );
      const action = li.querySelector('.step-action');
      const target = li.querySelector('.step-target');
      expect(action.textContent).toBe('Double tap');
      expect(target.textContent).toBe('"Like Button"');
    });

    test('renders a swipe step as `Swipe <direction>` with no target span', () => {
      const li = app.renderStepRow({
        id: 'swipe_feed',
        index: 9,
        action: 'swipe',
        direction: 'up',
        target: 'Feed',
      });

      expect(li.getAttribute('data-action')).toBe('swipe');
      expect(li.textContent).toMatch(/^\s*\d+\.\s*Swipe\s*up\s*⋯\s*$/);
      const action = li.querySelector('.step-action');
      expect(action.textContent).toBe('Swipe');
      // Per the issue spec the swipe label is direction-only: no target span.
      expect(li.querySelector('.step-target')).toBeNull();
      // The direction text lives in its own span for CSS targeting.
      const direction = li.querySelector('.step-direction');
      expect(direction).not.toBeNull();
      expect(direction.textContent).toBe('up');
    });
  });

  describe('appendStep', () => {
    test('appends a row to #step-list in the DOM', () => {
      const list = document.getElementById('step-list');
      expect(list.children.length).toBe(0);

      app.appendStep({
        id: 'tap_login',
        index: 1,
        action: 'Tap',
        target: '"Login"',
      });

      expect(list.children.length).toBe(1);
      const li = list.firstElementChild;
      expect(li.tagName).toBe('LI');
      expect(li.getAttribute('data-step-id')).toBe('tap_login');
    });

    test('appends multiple rows in order', () => {
      app.appendStep({ id: 'a', index: 1, action: 'Tap', target: 'A' });
      app.appendStep({ id: 'b', index: 2, action: 'Tap', target: 'B' });
      app.appendStep({ id: 'c', index: 3, action: 'Tap', target: 'C' });

      const list = document.getElementById('step-list');
      expect(list.children.length).toBe(3);
      expect(list.children[0].getAttribute('data-step-id')).toBe('a');
      expect(list.children[1].getAttribute('data-step-id')).toBe('b');
      expect(list.children[2].getAttribute('data-step-id')).toBe('c');
    });
  });

  describe('attachWsClient', () => {
    test('dispatches step-added messages to onStepAdded', () => {
      const handlers = {};
      class FakeWs {
        constructor(url) {
          this.url = url;
          FakeWs.lastInstance = this;
        }
        addEventListener(type, fn) {
          handlers[type] = fn;
        }
      }

      const received = [];
      const client = app.attachWsClient({
        url: 'ws://localhost:9999/ws',
        onStepAdded: (payload) => received.push(payload),
        WebSocketCtor: FakeWs,
      });

      expect(client).toBeDefined();
      expect(FakeWs.lastInstance.url).toBe('ws://localhost:9999/ws');
      expect(typeof handlers.message).toBe('function');

      handlers.message({
        data: JSON.stringify({
          type: 'step-added',
          step: { id: 'tap_login', index: 1, action: 'Tap', target: '"Login"' },
        }),
      });

      expect(received.length).toBe(1);
      expect(received[0]).toEqual({
        id: 'tap_login',
        index: 1,
        action: 'Tap',
        target: '"Login"',
      });
    });

    test('ignores non step-added message types', () => {
      const handlers = {};
      class FakeWs {
        addEventListener(type, fn) {
          handlers[type] = fn;
        }
      }

      const received = [];
      app.attachWsClient({
        url: 'ws://localhost:9999/ws',
        onStepAdded: (p) => received.push(p),
        WebSocketCtor: FakeWs,
      });

      handlers.message({ data: JSON.stringify({ type: 'hello' }) });
      handlers.message({ data: 'not-json' });

      expect(received.length).toBe(0);
    });
  });
});
