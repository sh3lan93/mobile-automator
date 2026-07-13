'use strict';

const { emitGuide } = require('../../src/guide/emitter');

const TOPICS = ['execute', 'generate'];
const MODES = ['platform-aware', 'platform-agnostic'];

// Slice 2 teaches the agent WHEN to use memory, in the PULLED guide bodies
// (never ambient). Assert the instruction is present and mentions the verbs.
describe('guide emitter — memory instruction present', () => {
  for (const topic of TOPICS) {
    for (const mode of MODES) {
      it(`${topic} (${mode}) instructs reading + writing memory`, () => {
        const out = emitGuide(topic, { mode });
        expect(out).toContain('mauto memory show');
        expect(out).toContain('mauto memory add');
      });
    }
  }
});
