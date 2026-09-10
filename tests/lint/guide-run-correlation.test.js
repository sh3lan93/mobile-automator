'use strict';

// The slice's switch is an environment variable the AGENT has to export. If the
// guide never says so, nothing exports it, no trace is ever written, and every
// duration_seconds stays the self-report this work exists to replace — with the
// whole mechanism present, green, and unreachable.
//
// Deliberately asserts on the EMITTED guide, not the source file, so
// placeholder interpolation cannot swallow the instruction.

const { emitGuide } = require('../../src/guide/emitter');

describe('execute guide teaches run correlation', () => {
  for (const mode of ['platform-aware', 'platform-agnostic']) {
    it(`${mode} tells the agent to export MAUTO_RUN_ID before the first verb`, () => {
      const out = emitGuide('execute', { mode });
      expect(out).toContain('MAUTO_RUN_ID');
      // The same id must reach --run-id, or finalize looks for a trace that
      // does not exist. That equality IS the correlation.
      expect(out).toMatch(/MAUTO_RUN_ID[\s\S]{0,400}--run-id/);
    });

    it(`${mode} no longer presents --duration as the recorded value`, () => {
      const out = emitGuide('execute', { mode });
      expect(out).toMatch(/measured|measurement/i);
    });
  }
});
