'use strict';

/**
 * C3 lifecycle stub.
 *
 * The real implementation (10s fallback timer, listener wiring, fallback
 * prompt) lands in the next commit. This stub keeps the orchestrator wiring
 * importable without circular-resolution drama.
 */
async function startC3() {
  throw new Error('lifecycle/c3: not implemented yet');
}

module.exports = { startC3 };
