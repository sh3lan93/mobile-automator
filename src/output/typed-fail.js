'use strict';

// The envelope for a typed error: one that carries its own kind, message and
// hint, because the layer that throws it owns the rule and the wording
// (UnsafePathError, ResultStoreRefusal). The one mapping:
// toEnvelope (src/cli.js) uses it for every verb, and a verb that reports the
// error itself, to add its own `data` or hint text around the error's hint
// (init's data.agents, run --junit's saved result), uses it too, so the kind,
// message and hint can never drift from what toEnvelope would say.

const { fail } = require('./envelope');

function typedFail(err, { data, hintBefore = [], hintAfter = null } = {}) {
  const parts = [...hintBefore, err.hint, hintAfter].filter((h) => h != null);
  const hint = parts.length ? parts.join(' ') : err.hint;
  return { envelope: fail(err.kind, err.message, hint, data), exitKind: err.kind };
}

module.exports = { typedFail };
