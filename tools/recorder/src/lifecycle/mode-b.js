'use strict';

/**
 * Mode B lifecycle stub.
 *
 * The real implementation (mcpBridge, hierarchy poller, classifier/type-buffer
 * pipeline, failure orchestrator wiring) lands in the next commit. This stub
 * keeps the orchestrator wiring importable.
 */
async function startModeB() {
  throw new Error('lifecycle/mode-b: not implemented yet');
}

module.exports = { startModeB };
