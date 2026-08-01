'use strict';

const fs = require('fs');

const {
  CONFIG_SCHEMA_PATH,
  subschemaAt,
  declaredTypesAt,
  LIST_KEY_PATHS,
  validateAt,
} = require('../../../src/config/schema');

describe('config/schema', () => {
  it('ships a readable draft-07 schema', () => {
    const raw = JSON.parse(fs.readFileSync(CONFIG_SCHEMA_PATH, 'utf8'));
    expect(raw.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(raw.type).toBe('object');
    // Unknown keys must stay writable — the schema types keys, it does not gate them.
    expect(raw.additionalProperties).toBe(true);
  });

  describe('declaredTypesAt', () => {
    it('types the three list keys as arrays', () => {
      expect(declaredTypesAt('environments')).toEqual(['array']);
      expect(declaredTypesAt('protected_directories')).toEqual(['array']);
      expect(declaredTypesAt('business_critical_paths')).toEqual(['array']);
    });

    it('types scalar knowledge keys as strings', () => {
      expect(declaredTypesAt('build_command')).toEqual(['string']);
      expect(declaredTypesAt('loading_indicators')).toEqual(['string']);
      expect(declaredTypesAt('android_package')).toEqual(['string']);
    });

    it('allows null for the seeded-empty keys the scaffold writes', () => {
      expect(declaredTypesAt('project_name').sort()).toEqual(['null', 'string']);
      expect(declaredTypesAt('default_environment').sort()).toEqual(['null', 'string']);
    });

    it('resolves nested legacy paths', () => {
      expect(declaredTypesAt('knowledge.business_critical_paths')).toEqual(['array']);
      expect(declaredTypesAt('knowledge.project_name').sort()).toEqual(['null', 'string']);
      expect(declaredTypesAt('app.android_package')).toEqual(['string']);
    });

    it('returns [] for an undeclared key', () => {
      expect(declaredTypesAt('totally_made_up')).toEqual([]);
      expect(declaredTypesAt('knowledge.totally_made_up')).toEqual([]);
    });
  });

  describe('LIST_KEY_PATHS', () => {
    it('lists every array-typed path, flat and nested', () => {
      expect(LIST_KEY_PATHS).toEqual(
        expect.arrayContaining([
          'environments',
          'protected_directories',
          'business_critical_paths',
          'knowledge.protected_directories',
          'knowledge.business_critical_paths',
        ])
      );
    });

    it('contains no scalar paths', () => {
      expect(LIST_KEY_PATHS).not.toContain('project_name');
      expect(LIST_KEY_PATHS).not.toContain('mode');
    });
  });

  describe('subschemaAt', () => {
    it('returns the fragment for a declared path', () => {
      expect(subschemaAt('environments')).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      });
    });

    it('returns null for an undeclared path', () => {
      expect(subschemaAt('nope')).toBeNull();
    });
  });

  describe('validateAt', () => {
    it('accepts a conforming value', () => {
      expect(validateAt('environments', ['a', 'b'])).toEqual({ valid: true, errors: [] });
      expect(validateAt('project_name', null)).toEqual({ valid: true, errors: [] });
      expect(validateAt('mode', 'platform-agnostic')).toEqual({ valid: true, errors: [] });
    });

    it('rejects a non-conforming value with a readable message', () => {
      const r = validateAt('environments', 'a,b');
      expect(r.valid).toBe(false);
      expect(r.errors.join(' ')).toMatch(/array/);
    });

    it('rejects a value outside an enum', () => {
      const r = validateAt('mode', 'windows');
      expect(r.valid).toBe(false);
      expect(r.errors.join(' ')).toMatch(/platform-aware/);
    });

    it('does not prefix a root-level error with the redundant "(root)" — the CLI message already names the key', () => {
      const r = validateAt('mode', 'windows');
      expect(r.errors.join(' ')).not.toMatch(/\(root\)/);
    });

    it('always passes an undeclared path', () => {
      expect(validateAt('anything_at_all', { deeply: ['nested'] })).toEqual({ valid: true, errors: [] });
    });

    // "app" and "knowledge" are object-typed keys whose OWN top-level $ref (if
    // any) subschemaAt resolves, but whose nested properties (app.ios_bundle_id,
    // knowledge.business_critical_paths, ...) still carry an unresolved local
    // `#/definitions/...` $ref. Compiling that fragment on its own, without the
    // root schema's `definitions`, previously threw "can't resolve reference"
    // instead of returning a validation result.
    it('validates an object-typed key whose nested properties still hold local $refs', () => {
      expect(validateAt('app', { android_package: 'com.example.app', ios_bundle_id: null })).toEqual({
        valid: true,
        errors: [],
      });
      expect(validateAt('knowledge', { business_critical_paths: ['login', 'checkout'] })).toEqual({
        valid: true,
        errors: [],
      });
    });
  });
});
