'use strict';

// The gate-then-graduate switch for slice 4's and slice 5's user-visible
// surfaces, per the observability design's slice ladder.
//
// One predicate in one module rather than an inline env read at each site: a
// half-gated feature (the verb hidden, the behaviour change not) is the exact
// partial state the gate exists to prevent, and the graduation PR needs one
// thing to delete rather than a grep.
//
// Deliberately strict — the value is '1', not "anything truthy". A gate whose
// accepted vocabulary nobody can state is a gate nobody can reason about, and
// this one appears in a CHANGELOG entry users will copy.
//
// `env` DEFAULTS to process.env rather than being required. Every call site in
// this slice passes it explicitly, so a required parameter would be correct
// today purely by accident of its callers — and a later consumer calling
// `observeEnabled()` bare, which the signature invites, would read `undefined`
// and get `false` forever, silently disabling the whole gated surface. The
// default is what makes "off unless MAUTO_OBSERVE=1" true of the module rather
// than of its current callers. Note a default only fills `undefined`, so an
// explicit `null` still reports off instead of falling back to the ambient env.
//
// NOT applied to `mauto result add-crash` or to the result schema's `crashes`
// field: both are complete, device-free and inert when unused, and gating the
// verb would fail tests/lint/result-coverage.test.js, which builds the program
// in a plain environment.
function observeEnabled(env = process.env) {
  return Boolean(env) && env.MAUTO_OBSERVE === '1';
}

module.exports = { observeEnabled };
