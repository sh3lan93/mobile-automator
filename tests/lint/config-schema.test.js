'use strict';

// Structural guard: the config schema, the guide placeholder table, the
// scaffold skeleton, the shipped fixtures, and the setup guide prose must
// agree on what type each config key holds. #136 happened because that
// knowledge was duplicated across modules and drifted. It fails HERE now.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { LIST_KEY_PATHS, subschemaAt, declaredTypesAt, validateAt } = require('../../src/config/schema');
const { normalizeConfig } = require('../../src/config/coerce');
const { PLACEHOLDER_KEYS } = require('../../src/guide/placeholders');
const { scaffold } = require('../../src/setup/scaffold');

const REPO = path.join(__dirname, '..', '..');
const schema = require('../../src/schemas/config_schema.json');

const guideFiles = ['setup.aware.md', 'setup.agnostic.md'].map((f) => ({
  name: f,
  text: fs.readFileSync(path.join(REPO, 'src', 'guide', 'content', f), 'utf8'),
}));

describe('config schema — structural agreement', () => {
  test('every join:true placeholder key resolves to an array-typed schema path', () => {
    for (const [name, spec] of Object.entries(PLACEHOLDER_KEYS)) {
      if (!spec.join) continue;
      // At least one of the candidate config paths must be declared as a list;
      // otherwise the placeholder joins something the schema says is a scalar.
      const arrayPaths = spec.keys.filter((k) => declaredTypesAt(k).includes('array'));
      expect({ placeholder: name, arrayPaths }).toEqual({
        placeholder: name,
        arrayPaths: expect.arrayContaining([expect.any(String)]),
      });
      // And no candidate path may be declared as a non-array scalar.
      for (const k of spec.keys) {
        const types = declaredTypesAt(k);
        if (types.length === 0) continue; // undeclared candidate paths are fine
        expect(types).toContain('array');
      }
    }
  });

  test('LIST_KEY_PATHS matches every array-typed path in the raw schema, independently derived', () => {
    // Deliberately re-walks the raw config_schema.json here instead of
    // importing collectListPaths/LIST_KEY_PATHS to build the expected set —
    // asserting LIST_KEY_PATHS against a set built BY collectListPaths itself
    // can never fail from a recursion bug or a dropped nesting level in that
    // function, which is exactly the drift this guard exists to catch.

    function resolveRefIndependently(node) {
      if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
      const parts = node.$ref.replace(/^#\//, '').split('/');
      let cur = schema;
      for (const part of parts) {
        if (cur == null) return node;
        cur = cur[part];
      }
      return cur || node;
    }

    function collectArrayPathsIndependently(node, prefix, out) {
      const resolved = resolveRefIndependently(node);
      if (!resolved || !resolved.properties) return out;
      for (const [name, child] of Object.entries(resolved.properties)) {
        const childPath = prefix ? `${prefix}.${name}` : name;
        const resolvedChild = resolveRefIndependently(child);
        if (!resolvedChild) continue;
        if (resolvedChild.type === 'array') out.push(childPath);
        else if (resolvedChild.type === 'object' || resolvedChild.properties) {
          collectArrayPathsIndependently(resolvedChild, childPath, out);
        }
      }
      return out;
    }

    const expected = collectArrayPathsIndependently(schema, '', []).sort();
    expect([...LIST_KEY_PATHS].sort()).toEqual(expected);

    // Every path this test derives must actually be array-typed per
    // subschemaAt too, so a false-positive in the independent walk itself
    // (e.g. matching a property named "array") can't slip through unnoticed.
    for (const listPath of expected) {
      expect(subschemaAt(listPath).type).toBe('array');
    }

    expect(LIST_KEY_PATHS).toEqual(expect.arrayContaining(['environments']));
  });

  test('the fresh scaffold skeleton conforms to the schema', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-lint-'));
    scaffold(root, { mode: 'platform-aware' });
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, 'mobile-automator', 'config.json'), 'utf8')
    );
    for (const key of Object.keys(cfg)) {
      const { valid, errors } = validateAt(key, cfg[key]);
      expect({ key, valid, errors }).toEqual({ key, valid: true, errors: [] });
    }
  });

  test('the shipped config fixtures conform once healed', () => {
    for (const name of ['config.platform-aware.json', 'config.platform-agnostic.json']) {
      const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', name), 'utf8'));
      const healed = normalizeConfig(raw);
      for (const key of Object.keys(healed)) {
        const { valid, errors } = validateAt(key, healed[key]);
        expect({ name, key, valid, errors }).toEqual({ name, key, valid: true, errors: [] });
      }
    }
  });

  describe.each(guideFiles)('$name', ({ text }) => {
    test('every literal `mauto config set <key>` names a schema-declared key', () => {
      // Matches `mauto config set some_key` but skips the generic
      // `mauto config set <key> <value>` template form.
      const found = [...text.matchAll(/mauto config set ([a-z_][a-z0-9_.]*)/g)].map((m) => m[1]);
      expect(found.length).toBeGreaterThan(0);
      const undeclared = [...new Set(found)].filter((k) => subschemaAt(k) === null);
      expect(undeclared).toEqual([]);
    });

    test('the guide never tells the agent a list key holds a string', () => {
      // Guard against prose regressing to "persist a comma-separated string".
      expect(text).not.toMatch(/comma-separated string/i);
    });
  });
});
