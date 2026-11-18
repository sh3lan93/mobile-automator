'use strict';

// The one shape every result-layer refusal takes: a message, an
// `invalid_input` kind and a hint, so `toEnvelope` (src/cli.js) maps them all
// with a single check. The rule and its wording stay with the subclass's
// owner: InvalidRunIdError / AlreadyDecidedError (src/result/store.js),
// StatusRefusedError (src/result/status-guard.js). Its own module so
// status-guard can throw one without requiring store.js, which requires it.
class ResultStoreRefusal extends Error {
  constructor(message, hint) {
    super(message);
    this.name = new.target.name;
    this.kind = 'invalid_input';
    this.hint = hint;
  }
}

module.exports = { ResultStoreRefusal };
