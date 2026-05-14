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
  await mcp.takeScreenshot(store.assertScreenshotPath(assertion_id));
  broadcast({
    type: 'assertion-screenshot-ready',
    assertion_id,
    image_url: '/screenshots/assert_' + assertion_id + '.png'
  });
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

module.exports = { handleSaveMessage, handleCancelMessage, handleRequestAssertionScreenshot, handleSaveAssertion, handleCancelAssertion };
