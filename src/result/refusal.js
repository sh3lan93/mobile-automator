'use strict';

const { TypedRefusal } = require('../output/typed-refusal');

// The one shape every result-layer refusal takes: a message, an
// `invalid_input` kind and a hint. A TypedRefusal, so `toEnvelope`
// (src/cli.js) maps it with the one check every typed refusal shares. The
// rule and its wording stay with the subclass's owner: InvalidRunIdError /
// AlreadyDecidedError (src/result/store.js), StatusRefusedError (src/result/status-guard.js). Its own module so
// status-guard can throw one without requiring store.js, which requires it.
class ResultStoreRefusal extends TypedRefusal {
  constructor(message, hint) {
    super('invalid_input', message, hint);
  }
}

module.exports = { ResultStoreRefusal };
