'use strict';

// Guide emitter lint guards, asserted on EMITTED output rather than on the raw
// content files.
//
// `emitGuide` without a projectRoot resolves every placeholder to its unset
// rendering — which is exactly the unconfigured-workspace state a new user hits
// on first contact. That makes this the layer that owns the invariant. A guard
// that scans `src/guide/content/*.md` for `{{token}}` inside a code span tests a
// proxy instead: every malformation below lives only in the interpolated output,
// so a source scan reports green on all of them.

const { emitGuide } = require('../../src/guide/emitter');
const { FALLBACK } = require('../../src/guide/placeholders');

const TOPICS = ['generate', 'execute', 'setup'];
const MODES = ['platform-aware', 'platform-agnostic'];

// Split a line on backticks: index 0 is outside the first code span, 1 inside,
// 2 outside, … so every ODD index is the interior of a span.
function codeSpanInteriors(line) {
  const parts = line.split('`');
  return parts.filter((_, i) => i % 2 === 1);
}

function eachLine(text, fn) {
  const offenders = [];
  text.split('\n').forEach((line) => {
    if (fn(line)) offenders.push(line);
  });
  return offenders;
}

describe('guide emitter — emitted output is well-formed', () => {
  for (const topic of TOPICS) {
    for (const mode of MODES) {
      describe(`${topic} (${mode})`, () => {
        const emit = () => emitGuide(topic, { mode });

        it('contains no surviving {{ token', () => {
          expect(emit()).not.toContain('{{');
        });

        // The unset rendering must not carry parentheses of its own: the prose
        // supplies them where they belong, so a self-parenthesizing fallback
        // produced `the app package ((not configured …))`.
        it('contains no doubled parenthesis from an unset placeholder', () => {
          expect(eachLine(emit(), (line) => line.includes('(('))).toEqual([]);
        });

        // The original #143 failure: a fallback rendered inside a code span
        // reads as the command to run. (It also nested backticks back when the
        // fallback carried its own.)
        it('never renders the unset fallback inside a code span', () => {
          const offenders = eachLine(emit(), (line) =>
            codeSpanInteriors(line).some((span) => span.includes(FALLBACK))
          );
          expect(offenders).toEqual([]);
        });

        // `the `mauto` CLI(not configured …).` — an optional inline tail whose
        // unset rendering was jammed onto the preceding word.
        it('never jams an unset fallback against the preceding word', () => {
          const jammed = new RegExp(`[A-Za-z0-9)]${FALLBACK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
          expect(eachLine(emit(), (line) => jammed.test(line))).toEqual([]);
        });
      });
    }
  }
});
