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

  function _makeStepMenuButton(doc) {
    const btn = doc.createElement('button');
    btn.className = 'step-menu';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Edit step');
    btn.textContent = '⋯';
    return btn;
  }

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
      li.appendChild(_makeStepMenuButton(doc));
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
      li.appendChild(_makeStepMenuButton(doc));
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
      li.appendChild(_makeStepMenuButton(doc));
      return li;
    }

    li.setAttribute('data-action', String(step.action));

    const action = doc.createElement('span');
    action.className = 'step-action';
    action.textContent = String(step.action);

    const target = doc.createElement('span');
    target.className = 'step-target';
    target.textContent = step.target == null ? '' : String(step.target);

    li.appendChild(num);
    li.appendChild(action);
    li.appendChild(target);
    li.appendChild(_makeStepMenuButton(doc));
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
    const onAssertionScreenshotError = opts.onAssertionScreenshotError || null;
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
      if (payload.type === 'assertion-screenshot-error' && typeof onAssertionScreenshotError === 'function') {
        onAssertionScreenshotError(payload);
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
    var screenshotUrl = String(opts.screenshot_url || '');
    if (!/^\/screenshots\/[^/]+\.png$/.test(screenshotUrl)) {
      throw new Error('renderAssertionModal: invalid screenshot_url: ' + screenshotUrl);
    }
    img.src = screenshotUrl;
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
    setTimeout(function () { textarea.focus(); }, 0);
    return overlay;
  }

  function appendAssertionRow(assertion) {
    // assertion: { id, nl_text, anchor_step_id }
    var doc = root.document;
    var li = doc.createElement('li');
    li.className = 'assertion-row';
    li.setAttribute('data-assertion-id', String(assertion.id));
    li.setAttribute('data-anchor-step-id', String(assertion.anchor_step_id));

    var label = doc.createElement('span');
    label.className = 'assertion-label';
    label.textContent = 'Verifies:';

    var text = doc.createElement('span');
    text.className = 'assertion-text';
    text.textContent = assertion.nl_text;

    li.appendChild(label);
    li.appendChild(text);
    li.appendChild(_makeStepMenuButton(doc));

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

  function _closeAnyPopover(doc) {
    const open = doc.querySelector('.step-menu-popover');
    if (open && open.parentNode) open.parentNode.removeChild(open);
  }

  function _menuActionsForRow(li) {
    if (li.classList.contains('assertion-row')) return [['edit-assertion-text', 'Edit text']];
    const base = [['rename', 'Rename'], ['delete', 'Delete']];
    if (li.getAttribute('data-action') === 'type') base.push(['edit-value', 'Edit value']);
    return base;
  }

  function attachEditAffordances(options) {
    const opts = options || {};
    const doc = opts.document;
    const sendWs = opts.sendWs;
    if (!doc || typeof sendWs !== 'function') {
      throw new Error('attachEditAffordances: requires {document, sendWs}');
    }
    const list = doc.getElementById('step-list');
    if (!list) return;
    if (list.getAttribute('data-edit-wired') === '1') return;
    list.setAttribute('data-edit-wired', '1');

    list.addEventListener('click', function (e) {
      const menuBtn = e.target.closest && e.target.closest('button.step-menu');
      if (menuBtn) {
        const li = menuBtn.closest('li');
        const wasOpen = !!doc.querySelector('.step-menu-popover');
        _closeAnyPopover(doc);
        if (wasOpen) return;
        const pop = doc.createElement('div');
        pop.className = 'step-menu-popover';
        for (const pair of _menuActionsForRow(li)) {
          const item = doc.createElement('button');
          item.type = 'button';
          item.className = 'menu-item';
          item.setAttribute('data-edit-action', pair[0]);
          item.textContent = pair[1];
          pop.appendChild(item);
        }
        li.appendChild(pop);
        return;
      }
      const item = e.target.closest && e.target.closest('.step-menu-popover .menu-item');
      if (item) {
        const li = item.closest('li');
        const action = item.getAttribute('data-edit-action');
        _closeAnyPopover(doc);
        _dispatchEditAction(doc, li, action, sendWs);
      }
    });
  }

  function _editableSpan(li) {
    if (li.classList.contains('assertion-row')) return li.querySelector('.assertion-text');
    if (li.getAttribute('data-action') === 'type') {
      return li.querySelector('.step-target');
    }
    return li.querySelector('.step-target') || li.querySelector('.step-action');
  }

  function _beginInlineEdit(doc, li, span, currentValue, onCommit) {
    if (!span) return;
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit';
    input.value = currentValue == null ? '' : String(currentValue);
    const prevDisplay = span.style.display;
    span.style.display = 'none';
    span.parentNode.insertBefore(input, span.nextSibling);
    let done = false;
    function cleanup() {
      if (input.parentNode) input.parentNode.removeChild(input);
      span.style.display = prevDisplay;
    }
    function commit() {
      if (done) return;
      done = true;
      const v = input.value.trim();
      cleanup();
      if (v.length > 0) onCommit(v);
    }
    function cancel() {
      if (done) return;
      done = true;
      cleanup();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
    setTimeout(function () { input.focus(); }, 0);
  }

  function _dispatchEditAction(doc, li, action, sendWs) {
    if (action === 'rename') {
      const span = _editableSpan(li);
      const stepId = li.getAttribute('data-step-id');
      _beginInlineEdit(doc, li, span, span ? span.textContent.replace(/^"|"$/g, '') : '', function (v) {
        sendWs({ type: 'rename-step', step_id: stepId, new_display_name: v });
      });
    } else if (action === 'edit-value') {
      const span = li.querySelector('.step-value');
      const stepId = li.getAttribute('data-step-id');
      _beginInlineEdit(doc, li, span, span ? span.textContent.replace(/^"|"$/g, '') : '', function (v) {
        sendWs({ type: 'edit-value', step_id: stepId, new_value: v });
      });
    } else if (action === 'edit-assertion-text') {
      const span = li.querySelector('.assertion-text');
      const aid = li.getAttribute('data-assertion-id');
      _beginInlineEdit(doc, li, span, span ? span.textContent : '', function (v) {
        sendWs({ type: 'edit-assertion-text', assertion_id: aid, new_nl_text: v });
      });
    } else if (action === 'delete') {
      _beginDelete(doc, li, sendWs);
    }
  }

  function _beginDelete(doc, li, sendWs) { /* Task 6 */ }

  // Expose to the browser global.
  root.renderStepRow = renderStepRow;
  root.appendStep = appendStep;
  root.attachWsClient = attachWsClient;
  root.wireButtons = wireButtons;
  root.renderAssertionModal = renderAssertionModal;
  root.appendAssertionRow = appendAssertionRow;
  root.attachEditAffordances = attachEditAffordances;

  // Expose to CommonJS (jest).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      renderStepRow: renderStepRow,
      appendStep: appendStep,
      attachWsClient: attachWsClient,
      wireButtons: wireButtons,
      renderAssertionModal: renderAssertionModal,
      appendAssertionRow: appendAssertionRow,
      attachEditAffordances: attachEditAffordances,
    };
  }

  // Auto-connect only in a real browser, never under tests.
  if (typeof window !== 'undefined' && !window.__RECORDER_TEST__ && typeof window.WebSocket !== 'undefined') {
    const port = (typeof process !== 'undefined' && process.env && process.env.MOBILE_AUTOMATOR_RECORDER_PORT)
      || (window.MOBILE_AUTOMATOR_RECORDER_PORT)
      || '7681';
    try {
      var pendingAnchorStepId = null;

      function onAssertionError() {
        pendingAnchorStepId = null;
        var btn = document.getElementById('btn-add-assertion');
        if (btn) btn.disabled = false;
      }

      var ws = attachWsClient({
        url: 'ws://localhost:' + port + '/ws',
        onStepAdded: appendStep,
        onAssertionScreenshotReady: function (payload) {
          if (pendingAnchorStepId === null) return;
          var anchor = pendingAnchorStepId;
          pendingAnchorStepId = null;
          var assertBtn = document.getElementById('btn-add-assertion');
          if (assertBtn) assertBtn.disabled = false;
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
        onAssertionScreenshotError: onAssertionError,
        onAssertionAdded: appendAssertionRow,
      });

      wireButtons({
        document: document,
        sendWs: function (msg) { ws.send(JSON.stringify(msg)); },
        onAssertionScreenshotRequested: function (anchor) {
          pendingAnchorStepId = anchor;
          var btn = document.getElementById('btn-add-assertion');
          if (btn) btn.disabled = true;
        },
        onAssertionScreenshotError: onAssertionError,
      });
    } catch (_err) {
      // Swallow connection setup errors — the GUI will still render manually-
      // appended rows.
    }
  }
}(typeof window !== 'undefined' ? window : globalThis));
