'use strict';

// #191: every file in src/schemas must be a schema the CLI can actually use.
//
// This check used to be `.github/workflows/validate-schemas.yml`, which had
// three problems. It was path-filtered to src/schemas/*.json, so it was a
// signal on some PRs rather than part of the suite every change runs. It
// installed `ajv ajv-formats` with a bare `npm install`, outside the lockfile,
// and compiled with different options than the CLI does — so "the workflow is
// green" said nothing about what `mauto validate` would do. And its third step
// validated a `prototypes/` directory that no longer exists, so it passed
// vacuously. Worse, it compiled with `strict: false`, which lets a misspelled
// keyword like `"requird": [...]` through as an unknown annotation: the schema
// compiles, and the constraint it was meant to express silently never applies.
//
// Here every schema is checked with the lockfile-pinned ajv, three ways: it is
// valid Draft-07, it compiles under strict mode (which rejects unknown
// keywords), and it compiles with the CLI's own options.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { REPO_ROOT } = require('./docs-corpus');

const SCHEMA_DIR = path.join(REPO_ROOT, 'src', 'schemas');

// Discovered, not listed: a new schema is covered the moment it lands.
const SCHEMA_FILES = fs
  .readdirSync(SCHEMA_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

function load(file) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
}

describe('src/schemas (#191)', () => {
  test('discovers the schemas (scenario, result, config at least)', () => {
    expect(SCHEMA_FILES.length).toBeGreaterThanOrEqual(3);
  });

  describe.each(SCHEMA_FILES)('%s', (file) => {
    test('parses as JSON', () => {
      let error = null;
      try {
        load(file);
      } catch (e) {
        error = e.message;
      }
      expect({ file, error }).toEqual({ file, error: null });
    });

    test('is a valid Draft-07 schema', () => {
      const ajv = new Ajv();
      const valid = ajv.validateSchema(load(file));
      expect({ file, valid, errors: ajv.errors }).toEqual({ file, valid: true, errors: null });
    });

    test('compiles under Ajv strict mode (no unknown or misspelled keywords)', () => {
      // validateFormats: false because the CLI registers no formats either
      // (result_schema.json uses `format: date-time`); format checking is not
      // what this guard is about.
      const ajv = new Ajv({ strict: true, allowUnionTypes: true, validateFormats: false });
      expect(() => ajv.compile(load(file))).not.toThrow();
    });

    test("compiles with the CLI's own Ajv options", () => {
      // Mirrors src/scenario/validator.js and src/config/schema.js.
      // With strict: false, Ajv warns (not throws) on the unregistered
      // `date-time` format; that is the CLI's real behaviour, so the options
      // stay as-is and only the console noise is muted here.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const ajv = new Ajv({ allErrors: true, strict: false });
        expect(() => ajv.compile(load(file))).not.toThrow();
      } finally {
        warn.mockRestore();
      }
    });
  });
});
