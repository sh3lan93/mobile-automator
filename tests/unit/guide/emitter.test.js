'use strict';

const { emitGuide, emitSchema, emitBootstrap } = require('../../../src/guide/emitter');

const TOPICS = ['generate', 'execute', 'record', 'setup'];
const MODES = ['platform-aware', 'platform-agnostic'];

describe('guide/emitter', () => {
  describe('emitGuide', () => {
    for (const topic of TOPICS) {
      for (const mode of MODES) {
        it(`returns non-empty markdown for ${topic} (${mode})`, () => {
          const out = emitGuide(topic, { mode });
          expect(typeof out).toBe('string');
          expect(out.trim().length).toBeGreaterThan(0);
          expect(out).toContain('mauto');
          expect(out).toContain(topic);
        });
      }
    }

    it('defaults mode to platform-aware', () => {
      expect(emitGuide('setup')).toContain('mauto');
    });

    it('contains no placeholder tokens', () => {
      for (const topic of TOPICS) {
        for (const mode of MODES) {
          expect(emitGuide(topic, { mode })).not.toContain('{{');
        }
      }
    });

    it('notes that full content lands later', () => {
      expect(emitGuide('generate', { mode: 'platform-aware' }).toLowerCase()).toContain('later slice');
    });

    it('agnostic stubs mention the four semantic actions', () => {
      for (const topic of TOPICS) {
        const out = emitGuide(topic, { mode: 'platform-agnostic' });
        for (const act of ['press_back', 'dismiss_keyboard', 'grant_permission', 'deny_permission']) {
          expect(out).toContain(act);
        }
      }
    });

    it('throws on an unknown topic', () => {
      expect(() => emitGuide('nope', { mode: 'platform-aware' })).toThrow();
    });
  });

  describe('emitSchema', () => {
    it('emitSchema(scenario) parses as JSON', () => {
      const s = emitSchema('scenario');
      expect(() => JSON.parse(s)).not.toThrow();
    });

    it('emitSchema(result) parses as JSON', () => {
      const s = emitSchema('result');
      expect(() => JSON.parse(s)).not.toThrow();
    });

    it('throws on an unknown schema name', () => {
      expect(() => emitSchema('bogus')).toThrow();
    });
  });

  describe('emitBootstrap', () => {
    it('contains the verb list', () => {
      const out = emitBootstrap();
      for (const verb of [
        'elements', 'tap', 'type', 'swipe', 'press', 'screenshot',
        'assert', 'validate', 'result', 'setup', 'config', 'guide', 'schema', 'record',
      ]) {
        expect(out).toContain(verb);
      }
    });

    it('states the invariants', () => {
      const out = emitBootstrap().toLowerCase();
      expect(out).toContain('mauto guide');
      expect(out).toContain('envelope');
    });

    it('contains no placeholder tokens or leaked mcp tool names', () => {
      const out = emitBootstrap();
      expect(out).not.toContain('{{');
      expect(out).not.toMatch(/\bmobile_[a-z_]+/);
    });
  });
});
