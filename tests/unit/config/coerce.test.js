'use strict';

const { coerceValue, normalizeConfig, splitList } = require('../../../src/config/coerce');

describe('config/coerce', () => {
  describe('splitList', () => {
    it('splits on commas and trims', () => {
      expect(splitList('a, b ,c')).toEqual(['a', 'b', 'c']);
    });

    it('drops empty segments', () => {
      expect(splitList('a,,b, ,')).toEqual(['a', 'b']);
    });

    it('returns [] for an empty or whitespace-only string', () => {
      expect(splitList('')).toEqual([]);
      expect(splitList('  ')).toEqual([]);
      expect(splitList(' , ')).toEqual([]);
    });
  });

  describe('coerceValue — array keys (the #136 bug)', () => {
    it('splits a comma-separated value into a list', () => {
      expect(coerceValue('environments', 'stagingDebug,productionRelease')).toEqual([
        'stagingDebug',
        'productionRelease',
      ]);
    });

    it('tolerates spaces after the commas', () => {
      expect(coerceValue('protected_directories', 'src/, lib/')).toEqual(['src/', 'lib/']);
    });

    it('accepts a JSON array verbatim', () => {
      expect(coerceValue('environments', '["a","b"]')).toEqual(['a', 'b']);
    });

    it('wraps a single value in a list', () => {
      expect(coerceValue('environments', 'production')).toEqual(['production']);
    });

    it('yields an empty list for an empty value', () => {
      expect(coerceValue('environments', '')).toEqual([]);
    });

    it('coerces nested legacy list paths too', () => {
      expect(coerceValue('knowledge.business_critical_paths', 'login, checkout')).toEqual([
        'login',
        'checkout',
      ]);
    });
  });

  describe('coerceValue — string keys (the type-coercion bug)', () => {
    it('keeps a numeric-looking project name a string', () => {
      expect(coerceValue('project_name', '12345')).toBe('12345');
    });

    it('keeps a JSON-object-looking build command a string', () => {
      expect(coerceValue('build_command', '{"a":1}')).toBe('{"a":1}');
    });

    it('keeps a boolean-looking value a string', () => {
      expect(coerceValue('business_domain', 'true')).toBe('true');
    });

    it('maps the literal "null" to JSON null unconditionally — validateAt gates which keys may hold it', () => {
      expect(coerceValue('project_name', 'null')).toBeNull();
      expect(coerceValue('default_environment', 'null')).toBeNull();
      expect(coerceValue('build_command', 'null')).toBeNull();
      expect(coerceValue('android_package', 'null')).toBeNull();
    });
  });

  describe('coerceValue — undeclared keys stay lenient', () => {
    it('JSON-parses when possible', () => {
      expect(coerceValue('made_up_key', '{"a":1}')).toEqual({ a: 1 });
      expect(coerceValue('made_up_key', '42')).toBe(42);
    });

    it('falls back to the literal string', () => {
      expect(coerceValue('made_up_key', 'hello there')).toBe('hello there');
    });
  });

  describe('normalizeConfig — healing configs already on disk', () => {
    it('heals a flat string list key', () => {
      const healed = normalizeConfig({ environments: 'stagingDebug,productionRelease' });
      expect(healed.environments).toEqual(['stagingDebug', 'productionRelease']);
    });

    it('heals a nested string list key', () => {
      const healed = normalizeConfig({ knowledge: { business_critical_paths: 'login, checkout' } });
      expect(healed.knowledge.business_critical_paths).toEqual(['login', 'checkout']);
    });

    it('leaves correct arrays untouched', () => {
      const healed = normalizeConfig({ environments: ['a', 'b'] });
      expect(healed.environments).toEqual(['a', 'b']);
    });

    it('leaves unrelated keys and shapes untouched', () => {
      const cfg = { mode: 'platform-aware', project_name: null, app: { android_package: 'com.x' } };
      expect(normalizeConfig(cfg)).toEqual(cfg);
    });

    it('does not mutate its input', () => {
      const cfg = { environments: 'a,b' };
      normalizeConfig(cfg);
      expect(cfg.environments).toBe('a,b');
    });

    it('tolerates null/undefined', () => {
      expect(normalizeConfig(null)).toBeNull();
      expect(normalizeConfig(undefined)).toBeUndefined();
    });

    it('leaves a non-string, non-array value at a list path alone (validation reports it)', () => {
      const healed = normalizeConfig({ environments: 42 });
      expect(healed.environments).toBe(42);
    });
  });
});
