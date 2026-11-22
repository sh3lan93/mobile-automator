'use strict';

// The one base every typed refusal extends: an error that carries its own
// kind, message and hint, because the layer that throws it owns the rule and
// the wording. ResultStoreRefusal (src/result/refusal.js), UnsafePathError
// (src/workspace/safe-fs.js) and OutputPathRefusal
// (src/workspace/output-roots.js) extend it. toEnvelope (src/cli.js) maps any
// of them with one check, and a handler that turns "any other error" into its
// own write failure lets a refusal through with isTypedRefusal, so no site
// names a concrete class. Requires nothing, so any layer can extend it.
class TypedRefusal extends Error {
  constructor(kind, message, hint) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.hint = hint;
  }
}

function isTypedRefusal(err) {
  return err instanceof TypedRefusal;
}

module.exports = { TypedRefusal, isTypedRefusal };
