/**
 * @jest-environment jsdom
 *
 * Slice #10 — Recorder GUI: app-crashed sticky modal with 3-option prompt.
 *
 * On `{type:'app-crashed', log_path, in_bundle_log_path}` the GUI opens a sticky
 * modal with Relaunch / Save partial / Discard buttons, exposes the persistent
 * log path as a small link/code element, and dispatches the user's pick via
 * `{type:'crash-choice', choice}` over the existing socket. Modal is sticky:
 * Escape and backdrop click must NOT dismiss it. After a button click the modal
 * closes; a subsequent `app-crashed` message opens a fresh modal.
 */

'use strict';

window.__RECORDER_TEST__ = true;

const path = require('path');
const appPath = path.resolve(__dirname, '../../../tools/recorder/web/app.js');

// eslint-disable-next-line import/no-dynamic-require
const app = require(appPath);

function setupDom() {
  document.body.innerHTML = `
    <header>
      <h1>Mobile Automator Recorder</h1>
      <button id="btn-add-assertion" disabled></button>
      <div id="mode-banner" hidden></div>
    </header>
    <main><ul id="step-list"></ul></main>
    <footer>
      <button id="btn-cancel"></button>
      <button id="btn-save"></button>
    </footer>
    <div id="modal-root"></div>
  `;
}

function buildFakeWs() {
  const sent = [];
  let onMessage = null;
  const FakeWS = function () {
    this.send = (raw) => sent.push(JSON.parse(raw));
    this.addEventListener = (type, fn) => {
      if (type === 'message') onMessage = fn;
    };
  };
  return { FakeWS, sent, fire: (payload) => onMessage({ data: JSON.stringify(payload) }) };
}

const SAMPLE_LOG = '/abs/project/mobile-automator/crash-logs/login-2026-05-20T14-22-10Z.log';
const SAMPLE_IN_BUNDLE = '/abs/project/mobile-automator/bundles/.../crashes/2026-05-20T14-22-10Z.log';

describe('recorder GUI: app-crashed sticky modal (slice #10)', () => {
  beforeEach(() => {
    setupDom();
    app._resetSensitiveState();
  });

  test('app-crashed opens a modal with Relaunch / Save partial / Discard buttons', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    const modal = document.getElementById('crash-modal');
    expect(modal).not.toBeNull();

    const relaunch = modal.querySelector('[data-crash-choice="relaunch"]');
    const save = modal.querySelector('[data-crash-choice="save"]');
    const discard = modal.querySelector('[data-crash-choice="discard"]');
    expect(relaunch).not.toBeNull();
    expect(save).not.toBeNull();
    expect(discard).not.toBeNull();
    expect(relaunch.textContent).toMatch(/relaunch/i);
    expect(save.textContent).toMatch(/save/i);
    expect(discard.textContent).toMatch(/discard/i);
  });

  test('modal renders the persistent log_path text', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    const modal = document.getElementById('crash-modal');
    expect(modal.textContent).toContain(SAMPLE_LOG);
    // Path is rendered as either a <code> or <a> element (small affordance).
    const codeOrLink = modal.querySelector('code, a');
    expect(codeOrLink).not.toBeNull();
    expect(codeOrLink.textContent).toContain(SAMPLE_LOG);
  });

  test('clicking Relaunch sends {type:"crash-choice", choice:"relaunch"}', () => {
    const { FakeWS, sent, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    const btn = document.querySelector('#crash-modal [data-crash-choice="relaunch"]');
    btn.dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([{ type: 'crash-choice', choice: 'relaunch' }]);
  });

  test('clicking Save partial sends {type:"crash-choice", choice:"save"}', () => {
    const { FakeWS, sent, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    const btn = document.querySelector('#crash-modal [data-crash-choice="save"]');
    btn.dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([{ type: 'crash-choice', choice: 'save' }]);
  });

  test('clicking Discard sends {type:"crash-choice", choice:"discard"}', () => {
    const { FakeWS, sent, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    const btn = document.querySelector('#crash-modal [data-crash-choice="discard"]');
    btn.dispatchEvent(new window.Event('click'));

    expect(sent).toEqual([{ type: 'crash-choice', choice: 'discard' }]);
  });

  test('modal is sticky: Escape key does NOT close it', () => {
    const { FakeWS, sent, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    expect(document.getElementById('crash-modal')).not.toBeNull();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.getElementById('crash-modal')).not.toBeNull();
    expect(sent).toEqual([]);
  });

  test('modal is sticky: clicking the backdrop does NOT close it', () => {
    const { FakeWS, sent, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    const modal = document.getElementById('crash-modal');
    // Click the modal root container (outside the inner panel).
    modal.dispatchEvent(new window.Event('click'));

    expect(document.getElementById('crash-modal')).not.toBeNull();
    expect(sent).toEqual([]);
  });

  test('after picking a choice the modal closes', () => {
    const { FakeWS, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });
    document
      .querySelector('#crash-modal [data-crash-choice="relaunch"]')
      .dispatchEvent(new window.Event('click'));

    expect(document.getElementById('crash-modal')).toBeNull();
  });

  test('a subsequent app-crashed message opens a fresh modal', () => {
    const { FakeWS, sent, fire } = buildFakeWs();
    app.attachWsClient({ url: 'ws://x', WebSocketCtor: FakeWS });

    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });
    document
      .querySelector('#crash-modal [data-crash-choice="save"]')
      .dispatchEvent(new window.Event('click'));
    expect(document.getElementById('crash-modal')).toBeNull();

    // Second crash on the same recording session — the GUI is idempotent per
    // message and renders a fresh modal.
    fire({ type: 'app-crashed', log_path: SAMPLE_LOG, in_bundle_log_path: SAMPLE_IN_BUNDLE });

    const modal2 = document.getElementById('crash-modal');
    expect(modal2).not.toBeNull();
    expect(modal2.querySelector('[data-crash-choice="discard"]')).not.toBeNull();
    expect(sent).toEqual([{ type: 'crash-choice', choice: 'save' }]);
  });
});
