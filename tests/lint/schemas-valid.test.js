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
// keywords), and it compiles with the CLI's own Ajv — the createCliAjv()
// factory imported from src/schemas/cli-ajv.js, not a mirrored copy of its
// options. Mirroring is how the old workflow lied: nothing tied its options to
// the CLI's, so nothing failed when they disagreed. The suite also pins that
// cli-ajv.js stays the only construction site in shipped code, so the options
// cannot drift back into hand-copied literals.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Ajv = require('ajv');

const { REPO_ROOT } = require('./docs-corpus');
const { createCliAjv } = require('../../src/schemas/cli-ajv');

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

  // What keeps the "the CLI's own Ajv" test below honest: a second Ajv
  // construction site in shipped code is a new silent divergence from what
  // the CLI actually validates with — options hand-set per site, nothing
  // failing when they disagree, which is exactly how this guard's own
  // mirrored copy would have drifted. Enumerated with `git ls-files` the way
  // docs-corpus does, for the same reasons: git already knows what belongs to
  // the repo, and `--others` catches a file written but not yet staged.
  test('the CLI constructs its Ajv in one place only (src/schemas/cli-ajv.js)', () => {
    let stdout;
    try {
      stdout = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'bin'],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
      );
    } catch (err) {
      throw new Error(`could not enumerate src/ and bin/ with git ls-files: ${err.message}`);
    }
    const files = stdout.split('\0').filter((f) => f.endsWith('.js')).sort();
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
      return f !== 'src/schemas/cli-ajv.js' && /new Ajv\s*\(/.test(text);
    });
    expect(offenders).toEqual([]);
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

    test("compiles with the CLI's own Ajv", () => {
      // The real factory from src/schemas/cli-ajv.js — imported, not mirrored.
      // With strict: false, Ajv warns (not throws) on the unregistered
      // `date-time` format; that is the CLI's real behaviour, so the options
      // stay as-is and only the console noise is muted here.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const ajv = createCliAjv();
        expect(() => ajv.compile(load(file))).not.toThrow();
      } finally {
        warn.mockRestore();
      }
    });
  });
});
