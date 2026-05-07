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
    test('returns an <li> with data attributes and three child spans (no step-menu)', () => {
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

      // Per #22 AC the step-menu (edit affordances) is intentionally NOT rendered.
      expect(li.querySelector('.step-menu')).toBeNull();
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
