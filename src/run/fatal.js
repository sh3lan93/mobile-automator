'use strict';

// A step failure that retrying cannot fix: a scenario `mauto run` cannot
// execute (an unsupported action, a `type` step with no value), or an engine
// that answers a successful launch with an empty screen. runStep stops the
// retry_policy loop on any error carrying `fatal: true`.
class FatalStepError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FatalStepError';
    this.fatal = true;
  }
}

module.exports = { FatalStepError };
