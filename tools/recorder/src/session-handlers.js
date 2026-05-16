'use strict';

/**
 * Session-lifecycle message handlers for the recorder sidecar.
 *
 * These functions own the side effects when the GUI sends a {type: 'save'} or
 * {type: 'cancel'} message over the WebSocket. They take an injected `onDone`
 * callback rather than calling `process.exit` directly so the lifecycle wiring
 * (Task 6.2) can decide how to terminate the process and so unit tests can
 * assert the signalled exit code without tearing down the test runner.
 */

function handleSaveMessage({ store, onDone }) {
  // Save path: the artifact tree is preserved for the offline generator. We do
  // NOT clean up here. Signal a clean exit (code 0).
  if (typeof onDone === 'function') onDone(0);
}

function handleCancelMessage({ store, onDone }) {
  // Cancel path: nuke the artifact tree (cleanupOnCancel is idempotent and
  // safe when the directory does not exist), then signal exit code 130
  // (conventional code for SIGINT-style cancellation).
  if (store && typeof store.cleanupOnCancel === 'function') {
    store.cleanupOnCancel();
  }
  if (typeof onDone === 'function') onDone(130);
}

async function handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId }) {
  const assertion_id = allocateId();
  try {
    await mcp.takeScreenshot(store.assertScreenshotPath(assertion_id));
    broadcast({
      type: 'assertion-screenshot-ready',
      assertion_id,
      image_url: '/screenshots/assert_' + assertion_id + '.png'
    });
  } catch (err) {
    broadcast({
      type: 'assertion-screenshot-error',
      assertion_id,
      error: err.message
    });
  }
}

function handleSaveAssertion({ store, broadcast, msg }) {
  const entry = {
    id: msg.assertion_id,
    nl_text: msg.nl_text,
    screenshot: 'screenshots/assert_' + msg.assertion_id + '.png',
    anchor_step_id: msg.anchor_step_id,
    captured_at: new Date().toISOString()
  };
  store.appendAssertion(entry);
  broadcast({
    type: 'assertion-added',
    assertion: {
      id: msg.assertion_id,
      nl_text: msg.nl_text,
      anchor_step_id: msg.anchor_step_id
    }
  });
}

function handleCancelAssertion({ store, msg }) {
  store.deleteAssertScreenshot(msg.assertion_id);
}

function _nonEmpty(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

const _DELETE_POLICIES = ['none', 'reanchor', 'cascade'];

function handleRenameStep({ store, broadcast, msg }) {
  if (!_nonEmpty(msg && msg.step_id) || !_nonEmpty(msg && msg.new_display_name)) return;
  store.appendEdit({ op: 'rename', target_step_id: msg.step_id, new_display_name: msg.new_display_name, ts: new Date().toISOString() });
  broadcast({ type: 'step-renamed', step_id: msg.step_id, new_display_name: msg.new_display_name });
}

function handleEditValue({ store, broadcast, msg }) {
  if (!_nonEmpty(msg && msg.step_id) || !_nonEmpty(msg && msg.new_value)) return;
  store.appendEdit({ op: 'edit-value', target_step_id: msg.step_id, new_value: msg.new_value, ts: new Date().toISOString() });
  broadcast({ type: 'value-edited', step_id: msg.step_id, new_value: msg.new_value });
}

function handleEditAssertionText({ store, broadcast, msg }) {
  if (!_nonEmpty(msg && msg.assertion_id) || !_nonEmpty(msg && msg.new_nl_text)) return;
  store.appendEdit({ op: 'edit-assertion-text', target_assertion_id: msg.assertion_id, new_nl_text: msg.new_nl_text, ts: new Date().toISOString() });
  broadcast({ type: 'assertion-text-edited', assertion_id: msg.assertion_id, new_nl_text: msg.new_nl_text });
}

function handleDeleteStep({ store, broadcast, msg }) {
  if (!_nonEmpty(msg && msg.step_id) || !_DELETE_POLICIES.includes(msg && msg.assertion_policy)) return;
  store.appendEdit({ op: 'delete', target_step_id: msg.step_id, assertion_policy: msg.assertion_policy, ts: new Date().toISOString() });
  broadcast({ type: 'step-deleted', step_id: msg.step_id, assertion_policy: msg.assertion_policy });
}

function handleMarkAsSemantic({ store, broadcast, msg }) {
  if (!_nonEmpty(msg && msg.step_id) || !_nonEmpty(msg && msg.semantic_action)) return;
  store.appendEdit({ op: 'mark-as-semantic', target_step_id: msg.step_id, semantic_action: msg.semantic_action, ts: new Date().toISOString() });
  broadcast({ type: 'step-marked-semantic', step_id: msg.step_id, semantic_action: msg.semantic_action });
}

module.exports = { handleSaveMessage, handleCancelMessage, handleRequestAssertionScreenshot, handleSaveAssertion, handleCancelAssertion, handleRenameStep, handleEditValue, handleEditAssertionText, handleDeleteStep, handleMarkAsSemantic };
