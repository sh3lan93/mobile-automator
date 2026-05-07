/* Mobile Automator Recorder GUI — step-list rendering and WebSocket client.
 *
 * Dual-target module: works as a classic <script> in the browser AND as a
 * CommonJS module under jest+jsdom. We attach helpers to `window` for the
 * browser and `module.exports` for tests when `module` is defined.
 *
 * Per #22 acceptance criteria the rendered <li> intentionally OMITS the
 * step-menu (edit affordances) span — those land in slice #28.
 */
(function (root) {
  'use strict';

  function renderStepRow(step) {
    const doc = root.document;
    const li = doc.createElement('li');
    li.classList.add('step-row');
    if (step && step.is_unnamed) {
      li.classList.add('unnamed');
    }
    li.setAttribute('data-step-id', String(step.id));
    li.setAttribute('data-index', String(step.index));

    const num = doc.createElement('span');
    num.className = 'step-num';
    num.textContent = String(step.index) + '.';

    if (step && step.action === 'type') {
      // Render: <num>. Type "<value>" into "<field_label>"
      // Slice #35 review fix: when step.sensitive === true the value is
      // masked here in the GUI render path with bullet characters of
      // matching length. The full sensitive-input UX (caution badges,
      // Save-time confirmation modal, --allow-sensitive-input flag, and
      // on-disk redaction) still lands in slice #30.
      li.setAttribute('data-action', 'type');

      const action = doc.createElement('span');
      action.className = 'step-action';
      action.textContent = 'Type';

      const rawValue = step.value == null ? '' : String(step.value);
      let displayValue;
      if (step.sensitive === true) {
        // Cap the bullet count so a degenerate (very long or zero-length)
        // value renders sensibly. Min 1 bullet so an empty sensitive value
        // doesn't betray its zero length.
        const len = Math.min(Math.max(rawValue.length, 1), 32);
        displayValue = '•'.repeat(len);
      } else {
        displayValue = rawValue;
      }
      const value = doc.createElement('span');
      value.className = 'step-value';
      value.textContent = '"' + displayValue + '"';

      const into = doc.createElement('span');
      into.className = 'step-into';
      into.textContent = 'into';

      const target = doc.createElement('span');
      target.className = 'step-target';
      target.textContent = '"' + (step.field_label == null ? '' : String(step.field_label)) + '"';

      li.appendChild(num);
      li.appendChild(action);
      li.appendChild(value);
      li.appendChild(into);
      li.appendChild(target);
      return li;
    }

    const action = doc.createElement('span');
    action.className = 'step-action';
    action.textContent = String(step.action);

    const target = doc.createElement('span');
    target.className = 'step-target';
    target.textContent = step.target == null ? '' : String(step.target);

    li.appendChild(num);
    li.appendChild(action);
    li.appendChild(target);
    return li;
  }

  function appendStep(step) {
    const list = root.document.getElementById('step-list');
    if (!list) return null;
    const li = renderStepRow(step);
    list.appendChild(li);
    return li;
  }

  function attachWsClient(options) {
    const opts = options || {};
    const url = opts.url;
    const onStepAdded = opts.onStepAdded || function () {};
    const Ctor = opts.WebSocketCtor || root.WebSocket;
    if (!Ctor) {
      throw new Error('attachWsClient: no WebSocket constructor available');
    }
    const ws = new Ctor(url);
    ws.addEventListener('message', function (event) {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_err) {
        return;
      }
      if (!payload || payload.type !== 'step-added') return;
      onStepAdded(payload.step);
    });
    return ws;
  }

  function wireButtons(options) {
    const opts = options || {};
    const doc = opts.document;
    const sendWs = opts.sendWs;
    if (!doc || typeof sendWs !== 'function') {
      throw new Error('wireButtons: requires {document, sendWs}');
    }
    function bindOnce(id, message) {
      const btn = doc.getElementById(id);
      if (!btn) return;
      if (btn.getAttribute('data-recorder-wired') === '1') return;
      btn.setAttribute('data-recorder-wired', '1');
      btn.addEventListener('click', function () {
        sendWs(message);
      });
    }
    bindOnce('btn-save', { type: 'save' });
    bindOnce('btn-cancel', { type: 'cancel' });
  }

  // Expose to the browser global.
  root.renderStepRow = renderStepRow;
  root.appendStep = appendStep;
  root.attachWsClient = attachWsClient;
  root.wireButtons = wireButtons;

  // Expose to CommonJS (jest).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      renderStepRow: renderStepRow,
      appendStep: appendStep,
      attachWsClient: attachWsClient,
      wireButtons: wireButtons,
    };
  }

  // Auto-connect only in a real browser, never under tests.
  if (typeof window !== 'undefined' && !window.__RECORDER_TEST__ && typeof window.WebSocket !== 'undefined') {
    const port = (typeof process !== 'undefined' && process.env && process.env.MOBILE_AUTOMATOR_RECORDER_PORT)
      || (window.MOBILE_AUTOMATOR_RECORDER_PORT)
      || '7681';
    try {
      attachWsClient({
        url: 'ws://localhost:' + port + '/ws',
        onStepAdded: appendStep,
      });
    } catch (_err) {
      // Swallow connection setup errors — the GUI will still render manually-
      // appended rows.
    }
  }
}(typeof window !== 'undefined' ? window : globalThis));
