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
  // `mauto install` / `mauto uninstall`. Every assertion below is `toContain`,
  // so this truncation is fail-safe: cutting before the table can only remove
  // signal (making the test fail on an unfixed pre-flight), never manufacture
  // a pass — a table match could not stand in for the fix. Cut at the first
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

      if (mode === 'platform-aware') {
        it(`${topic} (${mode}) keeps the build fallback when no artifact is named`, () => {
          const preflight = preflightSection(emitGuide(topic, { mode }));
          expect(preflight).toContain('build and install with');
          expect(preflight).toContain('ask whether to rebuild');
        });
      }

      if (mode === 'platform-agnostic') {
        it(`${topic} (${mode}) never builds`, () => {
          const preflight = preflightSection(emitGuide(topic, { mode }));
          expect(preflight).toContain('never builds');
        });
      }

      if (topic === 'execute') {
        // A broken scenario must stop the run before the device is touched, so
        // validate has to come first: install/uninstall wipe app data.
        it(`${topic} (${mode}) validates before any device verb`, () => {
          const preflight = preflightSection(emitGuide(topic, { mode }));
          const validateAt = preflight.indexOf('mauto validate');
          expect(validateAt).toBeGreaterThan(-1);
          for (const verb of ['mauto devices', 'mauto install', 'mauto uninstall']) {
            const at = preflight.indexOf(verb);
            expect(at).toBeGreaterThan(-1);
            expect(validateAt).toBeLessThan(at);
          }
        });
      }

      if (topic === 'execute') {
        // The refusal must leave a record: the stop path names the exact
        // finalize command, not just "finalize with --status error".
        it(`${topic} (${mode}) stop path spells out the finalize command`, () => {
          const preflight = preflightSection(emitGuide(topic, { mode }));
          expect(preflight).toContain('--status error');
          expect(preflight).toContain('--scenario-id');
          expect(preflight).toContain('--summary');
        });
      }

      it(`${topic} (${mode}) does not instruct an unconditional build`, () => {
        const out = emitGuide(topic, { mode });
        expect(out).not.toContain('Build and install the app using');
      });
    }
  }
});
