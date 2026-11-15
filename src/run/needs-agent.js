'use strict';

// Actions `mauto run` cannot perform and must not pretend to: the ones the
// action catalog marks `unsupported` (the engine has no primitive for them),
// and a precondition that depends on something a run does not have. A handler
// throws NeedsAgentError; runStep records the step as `skipped` with
// `needs_agent: true`, the runner stops there, and the run finalizes
// `incomplete` (exit 7) with the message below as the instruction. Never a
// silent pass, and never a fatal "unknown action": the scenario is fine, it
// just needs a hand.

class NeedsAgentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NeedsAgentError';
    this.needsAgent = true;
  }
}

const BY_HAND = {
  clear_app_data: 'clear the app data by hand',
  enable_wifi: 'turn Wi-Fi on by hand',
  disable_wifi: 'turn Wi-Fi off by hand',
};

// action -> handler. The coverage guard (tests/lint/run-action-coverage.test.js)
// derives the expected keys from the action catalog's `unsupported` set.
const NEEDS_AGENT_HANDLERS = Object.freeze(
  Object.fromEntries(
    Object.entries(BY_HAND).map(([action, todo]) => [
      action,
      () => Promise.reject(
        new NeedsAgentError(`${action} cannot be run by mauto (the engine has no primitive for it): ${todo}, then finish the run`)
      ),
    ])
  )
);

module.exports = { NeedsAgentError, NEEDS_AGENT_HANDLERS };
