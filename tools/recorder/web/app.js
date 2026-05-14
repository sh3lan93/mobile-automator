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

  var latestStepId = null;

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

    // Slice #24: long-press / double-tap render as `<verb> "<target>"`. The
    // target comes in unquoted; the renderer wraps with literal `"` chars to
    // match the issue's user-visible spec (mirrors the type branch's quoting
    // contract, not the legacy tap branch's caller-pre-quotes expectation).
    if (step && (step.action === 'long_press' || step.action === 'double_tap')) {
      const verb = step.action === 'long_press' ? 'Long press' : 'Double tap';
      li.setAttribute('data-action', step.action);

      const action = doc.createElement('span');
      action.className = 'step-action';
      action.textContent = verb;

      const target = doc.createElement('span');
      target.className = 'step-target';
      target.textContent = '"' + (step.target == null ? '' : String(step.target)) + '"';

      li.appendChild(num);
      li.appendChild(action);
      li.appendChild(target);
      return li;
    }

    // Slice #24: swipe renders as `Swipe <direction>` — no target span. The
    // direction lives in its own span so CSS can style it independently of the
    // verb.
    if (step && step.action === 'swipe') {
      li.setAttribute('data-action', 'swipe');

      const action = doc.createElement('span');
      action.className = 'step-action';
      action.textContent = 'Swipe';

      const direction = doc.createElement('span');
      direction.className = 'step-direction';
      direction.textContent = step.direction == null ? '' : String(step.direction);

      li.appendChild(num);
      li.appendChild(action);
      li.appendChild(direction);
      return li;
    }

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
    latestStepId = step.id;
    var btn = root.document.getElementById('btn-add-assertion');
    if (btn) btn.disabled = false;
    return li;
  }

  function attachWsClient(options) {
    const opts = options || {};
    const url = opts.url;
    const onStepAdded = opts.onStepAdded || function () {};
    const onAssertionScreenshotReady = opts.onAssertionScreenshotReady || null;
    const onAssertionAdded = opts.onAssertionAdded || null;
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
      if (!payload) return;
      if (payload.type === 'step-added') {
        onStepAdded(payload.step);
        return;
      }
      if (payload.type === 'assertion-screenshot-ready' && typeof onAssertionScreenshotReady === 'function') {
        onAssertionScreenshotReady(payload);
        return;
      }
      if (payload.type === 'assertion-added' && typeof onAssertionAdded === 'function') {
        onAssertionAdded(payload.assertion);
        return;
      }
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

    function bindAddAssertion() {
      var btn = doc.getElementById('btn-add-assertion');
      if (!btn) return;
      if (btn.getAttribute('data-recorder-wired') === '1') return;
      btn.setAttribute('data-recorder-wired', '1');
      btn.addEventListener('click', function () {
        if (latestStepId === null) return;
        var anchor = latestStepId;
        sendWs({ type: 'request-assertion-screenshot' });
        if (typeof opts.onAssertionScreenshotRequested === 'function') {
          opts.onAssertionScreenshotRequested(anchor);
        }
      });
    }
    bindAddAssertion();
  }

  function renderAssertionModal(opts) {
    // opts: { assertion_id, screenshot_url, anchor_step_id, onSave, onCancel }
    var doc = root.document;
    var overlay = doc.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var panel = doc.createElement('div');
    panel.className = 'modal-panel';

    var img = doc.createElement('img');
    img.src = opts.screenshot_url;
    img.alt = 'Assertion screenshot';
    img.className = 'modal-screenshot';

    var textarea = doc.createElement('textarea');
    textarea.id = 'assertion-text';
    textarea.placeholder = 'Describe what you expect…';
    textarea.setAttribute('aria-label', 'Assertion text');
    textarea.rows = 3;

    var btnRow = doc.createElement('div');
    btnRow.className = 'modal-btn-row';

    var btnSave = doc.createElement('button');
    btnSave.id = 'modal-btn-save';
    btnSave.textContent = 'Save';

    var btnCancel = doc.createElement('button');
    btnCancel.id = 'modal-btn-cancel';
    btnCancel.textContent = 'Cancel';

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      doc.removeEventListener('keydown', onKeyDown);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') { close(); opts.onCancel(); }
    }

    btnSave.addEventListener('click', function () {
      var text = textarea.value.trim();
      close();
      opts.onSave(text);
    });
    btnCancel.addEventListener('click', function () {
      close();
      opts.onCancel();
    });
    doc.addEventListener('keydown', onKeyDown);

    btnRow.appendChild(btnSave);
    btnRow.appendChild(btnCancel);
    panel.appendChild(img);
    panel.appendChild(textarea);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);

    var modalRoot = doc.getElementById('modal-root');
    if (modalRoot) modalRoot.appendChild(overlay);
    return overlay;
  }

  function appendAssertionRow(assertion) {
    // assertion: { id, nl_text, anchor_step_id }
    var doc = root.document;
    var li = doc.createElement('li');
    li.className = 'assertion-row';
    li.setAttribute('data-assertion-id', String(assertion.id));

    var label = doc.createElement('span');
    label.className = 'assertion-label';
    label.textContent = 'Verifies:';

    var text = doc.createElement('span');
    text.className = 'assertion-text';
    text.textContent = assertion.nl_text;

    li.appendChild(label);
    li.appendChild(text);

    var list = doc.getElementById('step-list');
    if (!list) return null;

    // Insert after the anchor step row. Fall back to append-at-end.
    var anchor = list.querySelector('[data-step-id="' + String(assertion.anchor_step_id) + '"]');
    if (anchor && anchor.nextSibling) {
      list.insertBefore(li, anchor.nextSibling);
    } else if (anchor) {
      anchor.parentNode.appendChild(li);
    } else {
      list.appendChild(li);
    }
    return li;
  }

  // Expose to the browser global.
  root.renderStepRow = renderStepRow;
  root.appendStep = appendStep;
  root.attachWsClient = attachWsClient;
  root.wireButtons = wireButtons;
  root.renderAssertionModal = renderAssertionModal;
  root.appendAssertionRow = appendAssertionRow;

  // Expose to CommonJS (jest).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      renderStepRow: renderStepRow,
      appendStep: appendStep,
      attachWsClient: attachWsClient,
      wireButtons: wireButtons,
      renderAssertionModal: renderAssertionModal,
      appendAssertionRow: appendAssertionRow,
    };
  }

  // Auto-connect only in a real browser, never under tests.
  if (typeof window !== 'undefined' && !window.__RECORDER_TEST__ && typeof window.WebSocket !== 'undefined') {
    const port = (typeof process !== 'undefined' && process.env && process.env.MOBILE_AUTOMATOR_RECORDER_PORT)
      || (window.MOBILE_AUTOMATOR_RECORDER_PORT)
      || '7681';
    try {
      var pendingAnchorStepId = null;

      var ws = attachWsClient({
        url: 'ws://localhost:' + port + '/ws',
        onStepAdded: appendStep,
        onAssertionScreenshotReady: function (payload) {
          if (pendingAnchorStepId === null) return;
          var anchor = pendingAnchorStepId;
          pendingAnchorStepId = null;
          renderAssertionModal({
            assertion_id: payload.assertion_id,
            screenshot_url: payload.image_url,
            anchor_step_id: anchor,
            onSave: function (text) {
              ws.send(JSON.stringify({ type: 'save-assertion', assertion_id: payload.assertion_id, nl_text: text, anchor_step_id: anchor }));
            },
            onCancel: function () {
              ws.send(JSON.stringify({ type: 'cancel-assertion', assertion_id: payload.assertion_id }));
            },
          });
        },
        onAssertionAdded: appendAssertionRow,
      });

      wireButtons({
        document: document,
        sendWs: function (msg) { ws.send(JSON.stringify(msg)); },
        onAssertionScreenshotRequested: function (anchor) { pendingAnchorStepId = anchor; },
      });
    } catch (_err) {
      // Swallow connection setup errors — the GUI will still render manually-
      // appended rows.
    }
  }
}(typeof window !== 'undefined' ? window : globalThis));
