'use strict';

const { emitGuide } = require('../../src/guide/emitter');

const TOPICS = ['execute', 'generate'];
const MODES = ['platform-aware', 'platform-agnostic'];

// #137: the pre-flight used to say "Build and install the app using
// {{build_command}}" with no alternative, steering the agent past `mauto
// install` — a verb that already ships and is already listed in `mauto
// bootstrap`. Assert the install branch is present in the pre-flight itself,
// not merely somewhere in the document: both execute guides also mention
// `mauto install` in their action-mapping table, so a whole-document match
// would pass even if the pre-flight were never fixed.
function preflightSection(out) {
  const start = out.indexOf('### 1. Pre-flight');
  if (start === -1) throw new Error('guide has no "### 1. Pre-flight" section');
  const rest = out.slice(start);
  const end = rest.indexOf('\n### ', 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  // execute.agnostic.md additionally sandwiches a **Precondition
  // `device_actions`** markdown table between the pre-flight numbered list
  // and the next `### ` heading. That table's rows already contain
  // `mauto install` / `mauto uninstall`, so without truncating before it, an
  // unfixed pre-flight in that one file would pass this guard by accident —
  // the table, not the fix, would supply the signal. Cut at the first
  // markdown table row (a line starting with `|`); none of the pre-flight
  // steps themselves start a line with `|` in any of the four files.
  const tableStart = section.search(/\n\|/);
  return tableStart === -1 ? section : section.slice(0, tableStart);
}

describe('guide emitter — pre-flight reuses a prebuilt artifact', () => {
  for (const topic of TOPICS) {
    for (const mode of MODES) {
      it(`${topic} (${mode}) offers the install branch in pre-flight`, () => {
        const preflight = preflightSection(emitGuide(topic, { mode }));
        expect(preflight).toContain('**App under test.**');
        expect(preflight).toContain('mauto install');
        expect(preflight).toContain('mauto uninstall');
      });

      it(`${topic} (${mode}) does not instruct an unconditional build`, () => {
        const out = emitGuide(topic, { mode });
        expect(out).not.toContain('Build and install the app using');
      });
    }
  }
});
