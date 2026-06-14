'use strict';

const { emitGuide } = require('../../src/guide/emitter');

const TOPICS = ['generate', 'execute', 'record', 'setup'];
const MODES = ['platform-aware', 'platform-agnostic'];

describe('guide emitter — no placeholder leak', () => {
  for (const topic of TOPICS) {
    for (const mode of MODES) {
      it(`${topic} (${mode}) contains no {{ tokens`, () => {
        expect(emitGuide(topic, { mode })).not.toContain('{{');
      });
    }
  }
});
