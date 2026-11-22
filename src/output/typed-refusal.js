'use strict';

// The one base every typed refusal extends: an error that carries its own
// kind, message and hint, because the layer that throws it owns the rule and
// the wording. ResultStoreRefusal (src/result/refusal.js), UnsafePathError
// (src/workspace/safe-fs.js) and OutputPathRefusal
// (src/workspace/output-roots.js) extend it. toEnvelope (src/cli.js) maps any
// of them with one check, so no site names a concrete class. A handler that
// reports its own write failure catches filesystem errors only
// (isFsError, src/output/fs-error.js), so a refusal passes through it to the
// boundary untouched. Requires nothing, so any layer can extend it.
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
