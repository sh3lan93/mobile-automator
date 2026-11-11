'use strict';

// The judge seam of `mauto run` (replay R2, #275): who decides a Tier-2
// assertion — one the CLI's evaluator answers `needs_agent` for — inside an
// unattended run. A judge is
//
//   { name, version?, judge(assertion, ctx) → Promise<verdict | null> }
//
//   ctx      { elements, screenshotPath?, variables?, previous? }
//   verdict  { pass: boolean, message, expected?, actual? }
//
// `null` means "cannot decide": the assertion is recorded `needs_agent` and
// the run finalizes `incomplete` until an agent records the verdict with
// `mauto result add-assertion … --judge agent`. A verdict whose `pass` is not
// a boolean is an error, recorded as a failed assertion — never a pass.
//
// A judge's verdict is recorded as `judge: {by: 'agent', name, version?}`:
// the result schema's `by` is `mauto | agent | none`, where `mauto` means the
// CLI's deterministic evaluator decided it. A plugged-in judge is an external
// decider, the same class as an agent recording a verdict, so it is `agent`,
// and its own identity goes in `name`/`version`.

// The default: decides nothing, so every Tier-2 assertion stays pending.
const noJudge = Object.freeze({ name: 'none', judge: () => Promise.resolve(null) });

module.exports = { noJudge };
