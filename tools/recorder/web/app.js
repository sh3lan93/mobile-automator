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
  var _mode = 'platform-aware';

  var AGNOSTIC_BANNER_TEXT =
    "Recording in agnostic mode. press_back / grant_permission / deny_permission auto-detected; click 'Mark as dismiss_keyboard' on a tap step to mark it manually.";

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
    const onStepRenamed = opts.onStepRenamed || null;
    const onStepDeleted = opts.onStepDeleted || null;
    const onValueEdited = opts.onValueEdited || null;
    const onAssertionTextEdited = opts.onAssertionTextEdited || null;
    const onStepMarkedSemantic = opts.onStepMarkedSemantic || null;
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
      if (payload.type === 'step-renamed' && typeof onStepRenamed === 'function') { onStepRenamed(payload); return; }
      if (payload.type === 'step-deleted' && typeof onStepDeleted === 'function') { onStepDeleted(payload); return; }
      if (payload.type === 'value-edited' && typeof onValueEdited === 'function') { onValueEdited(payload); return; }
      if (payload.type === 'assertion-text-edited' && typeof onAssertionTextEdited === 'function') { onAssertionTextEdited(payload); return; }
      if (payload.type === 'step-marked-semantic' && typeof onStepMarkedSemantic === 'function') { onStepMarkedSemantic(payload); return; }
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

  function applyModeBanner(doc) {
    var banner = doc.getElementById('mode-banner');
    if (!banner) return;
    if (_mode === 'platform-agnostic') {
      banner.textContent = AGNOSTIC_BANNER_TEXT;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  function _menuActionsForRow(li) {
    if (li.classList.contains('assertion-row')) return [['edit-assertion-text', 'Edit text']];
    const action = li.getAttribute('data-action');
    // A `type` step's slug derives from its field, not a free-text name, and
    // its row has no dedicated name span — so it offers Edit value (the
    // meaningful typo-fix), not Rename.
    if (action === 'type') return [['delete', 'Delete'], ['edit-value', 'Edit value']];
    // A `swipe` row has no target/name span (renders "Swipe <direction>"), so
    // Rename has nothing sensible to edit — Delete only, same rationale as type.
    if (action === 'swipe') return [['delete', 'Delete']];
    // A `tap` row in agnostic mode gets the additional Mark as dismiss_keyboard item.
    if (action === 'tap') {
      const items = [['rename', 'Rename'], ['delete', 'Delete']];
      if (_mode === 'platform-agnostic') {
        items.push(['mark-as-semantic', 'Mark as dismiss_keyboard']);
      }
      return items;
    }
    // long_press / double_tap / press_button rows have a target span.
    return [['rename', 'Rename'], ['delete', 'Delete']];
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
    // Rename is not offered on `type` rows (see _menuActionsForRow), so only
    // generic/gesture/swipe rows reach here: prefer the target span, falling
    // back to the action verb for swipe rows (which have no target span).
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
    } else if (action === 'mark-as-semantic') {
      const stepId = li.getAttribute('data-step-id');
      sendWs({ type: 'mark-as-semantic', step_id: stepId, semantic_action: 'dismiss_keyboard' });
    } else if (action === 'delete') {
      _beginDelete(doc, li, sendWs);
    }
  }

  function _renderDeletePrompt(doc, opts) {
    const overlay = doc.createElement('div');
    overlay.className = 'modal-overlay delete-prompt';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const panel = doc.createElement('div');
    panel.className = 'modal-panel';

    const title = doc.createElement('h4');
    title.textContent = 'Delete this step?';
    panel.appendChild(title);

    let getPolicy = function () { return 'none'; };

    if (opts.anchoredCount > 0) {
      const warn = doc.createElement('div');
      warn.className = 'delete-warn';
      warn.textContent = '⚠ ' + opts.anchoredCount + ' assertion(s) are anchored to this step.';
      panel.appendChild(warn);
      const policies = [
        ['reanchor', 'Re-anchor to previous step'],
        ['cascade', 'Cascade-delete the assertions'],
      ];
      policies.forEach(function (p, i) {
        const row = doc.createElement('label');
        row.className = 'delete-option';
        row.setAttribute('data-policy', p[0]);
        const radio = doc.createElement('input');
        radio.type = 'radio';
        radio.name = 'delete-policy';
        radio.value = p[0];
        if (i === 0) radio.checked = true;
        const span = doc.createElement('span');
        span.textContent = p[1];
        row.appendChild(radio);
        row.appendChild(span);
        panel.appendChild(row);
      });
      getPolicy = function () {
        const checked = panel.querySelector('input[name="delete-policy"]:checked');
        return checked ? checked.value : 'reanchor';
      };
    }

    const btnRow = doc.createElement('div');
    btnRow.className = 'modal-btn-row';
    const confirm = doc.createElement('button');
    confirm.type = 'button';
    confirm.setAttribute('data-delete-confirm', '1');
    confirm.textContent = opts.anchoredCount > 0 ? 'Apply' : 'Delete';
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.setAttribute('data-delete-cancel', '1');
    cancel.textContent = 'Cancel';

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    confirm.addEventListener('click', function () { const p = getPolicy(); close(); opts.onConfirm(p); });
    cancel.addEventListener('click', function () { close(); opts.onCancel(); });

    btnRow.appendChild(confirm);
    btnRow.appendChild(cancel);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);
    const modalRoot = doc.getElementById('modal-root') || doc.body;
    modalRoot.appendChild(overlay);
    return overlay;
  }

  function _beginDelete(doc, li, sendWs) {
    const stepId = li.getAttribute('data-step-id');
    const list = doc.getElementById('step-list');
    const anchored = list
      ? list.querySelectorAll('.assertion-row[data-anchor-step-id="' + stepId + '"]').length
      : 0;
    _renderDeletePrompt(doc, {
      step_id: stepId,
      anchoredCount: anchored,
      onConfirm: function (policy) {
        sendWs({ type: 'delete-step', step_id: stepId, assertion_policy: policy });
      },
      onCancel: function () {},
    });
  }

  function applyStepMarkedSemantic(doc, p) {
    const li = doc.querySelector('[data-step-id="' + p.step_id + '"]');
    if (!li) return;
    li.setAttribute('data-action', p.semantic_action);
    const span = li.querySelector('.step-action');
    if (span) span.textContent = p.semantic_action;
  }

  function applyStepRenamed(doc, p) {
    const li = doc.querySelector('[data-step-id="' + p.step_id + '"]');
    if (!li) return;
    const span = li.querySelector('.step-target') || li.querySelector('.step-action');
    if (span) span.textContent = p.new_display_name;
  }

  function applyValueEdited(doc, p) {
    const li = doc.querySelector('[data-step-id="' + p.step_id + '"]');
    if (!li) return;
    const span = li.querySelector('.step-value');
    if (span) span.textContent = '"' + p.new_value + '"';
  }

  function applyAssertionTextEdited(doc, p) {
    const li = doc.querySelector('[data-assertion-id="' + p.assertion_id + '"]');
    if (!li) return;
    const span = li.querySelector('.assertion-text');
    if (span) span.textContent = p.new_nl_text;
  }

  function applyStepDeleted(doc, p) {
    const list = doc.getElementById('step-list');
    if (!list) return;
    const li = list.querySelector('[data-step-id="' + p.step_id + '"]');
    if (!li) return;
    const anchored = [].slice.call(list.querySelectorAll('.assertion-row[data-anchor-step-id="' + p.step_id + '"]'));
    if (p.assertion_policy === 'cascade') {
      anchored.forEach(function (a) { if (a.parentNode) a.parentNode.removeChild(a); });
    } else if (p.assertion_policy === 'reanchor' && anchored.length > 0) {
      const steps = [].slice.call(list.querySelectorAll('li.step-row'));
      const pos = steps.indexOf(li);
      const target = (pos > 0 ? steps[pos - 1] : null) || (pos + 1 < steps.length ? steps[pos + 1] : null);
      if (target) {
        const targetId = target.getAttribute('data-step-id');
        // Move with a cursor so the assertions keep their original relative
        // order under the new anchor (matches the apply-edits engine, which
        // preserves array order). Inserting each at target.nextSibling would
        // reverse them.
        let cursor = target;
        anchored.forEach(function (a) {
          a.setAttribute('data-anchor-step-id', targetId);
          if (cursor.nextSibling) list.insertBefore(a, cursor.nextSibling);
          else list.appendChild(a);
          cursor = a;
        });
      } else {
        anchored.forEach(function (a) { if (a.parentNode) a.parentNode.removeChild(a); });
      }
    }
    if (li.parentNode) li.parentNode.removeChild(li);
  }

  function _setMode(m) {
    _mode = m;
  }

  // Expose to the browser global.
  root.renderStepRow = renderStepRow;
  root.appendStep = appendStep;
  root.attachWsClient = attachWsClient;
  root.wireButtons = wireButtons;
  root.renderAssertionModal = renderAssertionModal;
  root.appendAssertionRow = appendAssertionRow;
  root.attachEditAffordances = attachEditAffordances;
  root.applyStepRenamed = applyStepRenamed;
  root.applyValueEdited = applyValueEdited;
  root.applyAssertionTextEdited = applyAssertionTextEdited;
  root.applyStepDeleted = applyStepDeleted;
  root.applyStepMarkedSemantic = applyStepMarkedSemantic;
  root.applyModeBanner = applyModeBanner;
  root._setMode = _setMode;

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
      applyStepRenamed: applyStepRenamed,
      applyValueEdited: applyValueEdited,
      applyAssertionTextEdited: applyAssertionTextEdited,
      applyStepDeleted: applyStepDeleted,
      applyStepMarkedSemantic: applyStepMarkedSemantic,
      applyModeBanner: applyModeBanner,
      _setMode: _setMode,
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
        onStepRenamed: function (p) { applyStepRenamed(document, p); },
        onStepDeleted: function (p) { applyStepDeleted(document, p); },
        onValueEdited: function (p) { applyValueEdited(document, p); },
        onAssertionTextEdited: function (p) { applyAssertionTextEdited(document, p); },
        onStepMarkedSemantic: function (p) { applyStepMarkedSemantic(document, p); },
      });

      // Fetch the session mode and show the banner if agnostic.
      fetch('/api/mode').then(function (res) { return res.json(); }).then(function (data) {
        if (data && data.mode) _setMode(data.mode);
        applyModeBanner(document);
      }).catch(function () {
        // Failed fetch — leave _mode as 'platform-aware', banner stays hidden.
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
      attachEditAffordances({ document: document, sendWs: function (msg) { ws.send(JSON.stringify(msg)); } });
    } catch (_err) {
      // Swallow connection setup errors — the GUI will still render manually-
      // appended rows.
    }
  }
}(typeof window !== 'undefined' ? window : globalThis));
