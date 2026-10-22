'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ENGINES,
  DEFAULT_ENGINE,
  resolveEngine,
  readEngine,
  handleEngine,
} = require('../../../src/device/engine');
const { CONFIG_SCHEMA_PATH, validateAt } = require('../../../src/config/schema');
const { coerceValue } = require('../../../src/config/coerce');

function tmpRoot(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-engine-'));
  if (config !== undefined) {
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'mobile-automator', 'config.json'),
      typeof config === 'string' ? config : JSON.stringify(config)
    );
  }
  return root;
}

describe('device/engine (#251)', () => {
  describe('ENGINES / DEFAULT_ENGINE', () => {
    test('are derived from config_schema.json, not restated', () => {
      const schema = JSON.parse(fs.readFileSync(CONFIG_SCHEMA_PATH, 'utf8'));
      expect(ENGINES).toEqual(schema.properties.engine.enum);
      expect(DEFAULT_ENGINE).toBe(schema.properties.engine.default);
    });

    test('offer mobilecli (the default) and legacy', () => {
      expect(ENGINES).toEqual(['mobilecli', 'legacy']);
      expect(DEFAULT_ENGINE).toBe('mobilecli');
    });

    test('ENGINES is frozen', () => {
      expect(Object.isFrozen(ENGINES)).toBe(true);
    });
  });

  describe('resolveEngine', () => {
    test('nothing set -> default', () => {
      expect(resolveEngine({ config: null, env: {} })).toEqual({ engine: 'mobilecli', source: 'default' });
      expect(resolveEngine({ config: {}, env: {} })).toEqual({ engine: 'mobilecli', source: 'default' });
    });

    test('a valid config.engine -> config', () => {
      expect(resolveEngine({ config: { engine: 'legacy' }, env: {} })).toEqual({ engine: 'legacy', source: 'config' });
      expect(resolveEngine({ config: { engine: 'mobilecli' }, env: {} })).toEqual({ engine: 'mobilecli', source: 'config' });
    });

    test('an invalid config.engine falls back to the default', () => {
      expect(resolveEngine({ config: { engine: 'foo' }, env: {} })).toEqual({ engine: 'mobilecli', source: 'default' });
      expect(resolveEngine({ config: { engine: 1 }, env: {} })).toEqual({ engine: 'mobilecli', source: 'default' });
    });

    test('MOBILEMCP_LEGACY_ROBOT=1 wins over config', () => {
      expect(resolveEngine({ config: { engine: 'mobilecli' }, env: { MOBILEMCP_LEGACY_ROBOT: '1' } }))
        .toEqual({ engine: 'legacy', source: 'env' });
      expect(resolveEngine({ config: null, env: { MOBILEMCP_LEGACY_ROBOT: '1' } }))
        .toEqual({ engine: 'legacy', source: 'env' });
    });

    // The engine accepts only the exact string "1", so any other defined value
    // (including "", "0", "true") is the default robot — and still wins.
    test('any other defined MOBILEMCP_LEGACY_ROBOT value is mobilecli and wins over config', () => {
      for (const v of ['0', '', 'true', 'yes']) {
        expect(resolveEngine({ config: { engine: 'legacy' }, env: { MOBILEMCP_LEGACY_ROBOT: v } }))
          .toEqual({ engine: 'mobilecli', source: 'env' });
      }
    });

    test('env defaults to process.env', () => {
      const saved = process.env.MOBILEMCP_LEGACY_ROBOT;
      process.env.MOBILEMCP_LEGACY_ROBOT = '1';
      try {
        expect(resolveEngine({ config: null })).toEqual({ engine: 'legacy', source: 'env' });
      } finally {
        if (saved === undefined) delete process.env.MOBILEMCP_LEGACY_ROBOT;
        else process.env.MOBILEMCP_LEGACY_ROBOT = saved;
      }
    });
  });

  describe('readEngine', () => {
    test('reads config.engine from the workspace config', () => {
      expect(readEngine(tmpRoot({ engine: 'legacy' }), { env: {} })).toEqual({ engine: 'legacy', source: 'config' });
    });

    test('a missing config -> default', () => {
      expect(readEngine(tmpRoot(), { env: {} })).toEqual({ engine: 'mobilecli', source: 'default' });
    });

    test('an unreadable (malformed) config -> default, never throws', () => {
      expect(readEngine(tmpRoot('{not json'), { env: {} })).toEqual({ engine: 'mobilecli', source: 'default' });
    });

    test('env still wins over the workspace config', () => {
      expect(readEngine(tmpRoot({ engine: 'legacy' }), { env: { MOBILEMCP_LEGACY_ROBOT: '0' } }))
        .toEqual({ engine: 'mobilecli', source: 'env' });
    });
  });

  describe('handleEngine', () => {
    test('a handle without an engine (pre-#251 daemon) counts as mobilecli', () => {
      expect(handleEngine({ device: 'A' })).toBe('mobilecli');
      expect(handleEngine(null)).toBe('mobilecli');
    });

    test('a recorded engine is returned as-is', () => {
      expect(handleEngine({ engine: 'legacy' })).toBe('legacy');
    });

    test('an unknown recorded engine counts as mobilecli', () => {
      expect(handleEngine({ engine: 'weird' })).toBe('mobilecli');
    });
  });

  describe('config set engine', () => {
    test('accepts every engine', () => {
      for (const e of ENGINES) {
        expect(validateAt('engine', coerceValue('engine', e)).valid).toBe(true);
      }
    });

    test('rejects an unknown engine', () => {
      const r = validateAt('engine', coerceValue('engine', 'foo'));
      expect(r.valid).toBe(false);
      expect(r.errors.join(' ')).toMatch(/allowed|must be equal to one of/i);
    });
  });
});
