'use strict';

// Structural integration test for the recorder AI-skill ingestion contract.
//
// This test does NOT invoke a real AI; it asserts the surrounding contract is
// well-formed:
//   - The aware-mode recorder skill template parses and exposes all required
//     sections.
//   - Cross-referenced files mentioned in the template resolve to real files
//     in templates/ (the canonical source the install-skills script copies
//     from).
//   - The hand-crafted fixture bundle has the file shape the skill expects.
//   - The hand-written golden scenario JSON validates against the
//     scenario_schema.json.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RECORDER_TEMPLATE_PATH = path.join(
  REPO_ROOT,
  'templates',
  'mobile-automator-recorder',
  'aware',
  'SKILL.md'
);
const GENERATOR_TEMPLATE_PATH = path.join(
  REPO_ROOT,
  'templates',
  'mobile-automator-generator',
  'aware',
  'SKILL.md'
);
const SCENARIO_SCHEMA_PATH = path.join(
  REPO_ROOT,
  'templates',
  'mobile-automator-generator',
  'references',
  'scenario_schema.json'
);
const SAMPLE_BUNDLE_DIR = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'recorder',
  'sample-bundle'
);
const GOLDEN_SCENARIO_PATH = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'recorder',
  'sample-bundle.expected.scenario.json'
);

// --- Minimal JSON-schema validator -----------------------------------------
//
// The project does not depend on ajv, so we ship a small validator focused on
// the invariants this contract test cares about: required-fields, enums,
// regex patterns, type tags, and item-level recursion through $ref. It is
// intentionally narrow — it covers the v2.1 scenario schema's shape, not
// arbitrary JSON Schema constructs.

function resolveRef(rootSchema, ref) {
  // Only supports local pointers like "#/definitions/step".
  const parts = ref.replace(/^#\//, '').split('/');
  let node = rootSchema;
  for (const p of parts) node = node[p];
  return node;
}

function jsTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(typeSpec, value) {
  const actual = jsTypeOf(value);
  const allowed = Array.isArray(typeSpec) ? typeSpec : [typeSpec];
  if (allowed.includes(actual)) return true;
  // 'number' admits integers as well.
  if (allowed.includes('number') && actual === 'integer') return true;
  return false;
}

function validate(rootSchema, schema, value, pathStr, errors) {
  if (schema.$ref) {
    schema = resolveRef(rootSchema, schema.$ref);
  }

  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push(`${pathStr}: expected type ${JSON.stringify(schema.type)}, got ${jsTypeOf(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathStr}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (schema.pattern && typeof value === 'string') {
    const re = new RegExp(schema.pattern);
    if (!re.test(value)) errors.push(`${pathStr}: value ${JSON.stringify(value)} does not match pattern ${schema.pattern}`);
  }

  if (schema.maxLength != null && typeof value === 'string' && value.length > schema.maxLength) {
    errors.push(`${pathStr}: string longer than maxLength ${schema.maxLength}`);
  }

  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object')) || (!schema.type && (schema.required || schema.properties))) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(schema.required)) {
        for (const k of schema.required) {
          if (!(k in value)) errors.push(`${pathStr}: missing required field "${k}"`);
        }
      }
      if (schema.properties) {
        for (const [k, sub] of Object.entries(schema.properties)) {
          if (k in value) validate(rootSchema, sub, value[k], `${pathStr}.${k}`, errors);
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${pathStr}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push(`${pathStr}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const v of value) {
        const k = JSON.stringify(v);
        if (seen.has(k)) {
          errors.push(`${pathStr}: array items not unique`);
          break;
        }
        seen.add(k);
      }
    }
    if (schema.items) {
      value.forEach((item, i) => validate(rootSchema, schema.items, item, `${pathStr}[${i}]`, errors));
    }
  }
}

function validateScenarioAgainstSchema(scenario, schema) {
  const errors = [];
  validate(schema, schema, scenario, '$', errors);
  return errors;
}

// --- Tests ------------------------------------------------------------------

describe('recorder AI-skill ingestion contract (structural)', () => {
  describe('skill template — aware mode', () => {
    let template;

    beforeAll(() => {
      template = fs.readFileSync(RECORDER_TEMPLATE_PATH, 'utf8');
    });

    test('template file exists and is non-empty', () => {
      expect(template.length).toBeGreaterThan(0);
    });

    test('template has YAML frontmatter with name and description', () => {
      expect(template.startsWith('---\n')).toBe(true);
      expect(template).toMatch(/^name: mobile-automator-recorder$/m);
      expect(template).toMatch(/^description:\s*"/m);
    });

    test('template advertises required sections', () => {
      const requiredSections = [
        '## Overview',
        '## Inputs',
        '## Process',
        '## Cross-references',
        '## Tag and Description Rules',
        '## Operational Boundaries',
      ];
      for (const heading of requiredSections) {
        expect(template).toEqual(expect.stringContaining(heading));
      }
    });

    test('template references resolve to real files in templates/', () => {
      // The recorder template references the generator skill and the scenario
      // schema by their .gemini/skills/... runtime paths. Those runtime paths
      // are populated by install-skills.js from these template-tree paths,
      // which must exist for the install step to succeed.
      expect(fs.existsSync(GENERATOR_TEMPLATE_PATH)).toBe(true);
      expect(fs.existsSync(SCENARIO_SCHEMA_PATH)).toBe(true);

      // And the recorder template should actually mention them.
      expect(template).toEqual(
        expect.stringContaining('.gemini/skills/mobile-automator-generator/SKILL.md')
      );
      expect(template).toEqual(
        expect.stringContaining(
          '.gemini/skills/mobile-automator-generator/references/scenario_schema.json'
        )
      );
    });
  });

  describe('fixture artifact bundle', () => {
    test('bundle directory and required files exist', () => {
      expect(fs.statSync(SAMPLE_BUNDLE_DIR).isDirectory()).toBe(true);
      const required = [
        'metadata.json',
        'events.jsonl',
        'edits.jsonl',
        'assertions.json',
      ];
      for (const f of required) {
        expect(fs.existsSync(path.join(SAMPLE_BUNDLE_DIR, f))).toBe(true);
      }
      expect(fs.statSync(path.join(SAMPLE_BUNDLE_DIR, 'hierarchy')).isDirectory()).toBe(true);
      expect(fs.statSync(path.join(SAMPLE_BUNDLE_DIR, 'screenshots')).isDirectory()).toBe(true);
    });

    test('metadata.json parses with the fields the skill reads', () => {
      const meta = JSON.parse(
        fs.readFileSync(path.join(SAMPLE_BUNDLE_DIR, 'metadata.json'), 'utf8')
      );
      expect(typeof meta.scenario_id).toBe('string');
      expect(typeof meta.app_version).toBe('string');
      expect(typeof meta.environment).toBe('string');
      expect(meta.mode).toBe('platform-aware');
    });

    test('events.jsonl is one JSON object per line, all tap events for #22', () => {
      const raw = fs.readFileSync(path.join(SAMPLE_BUNDLE_DIR, 'events.jsonl'), 'utf8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      const events = lines.map((l) => JSON.parse(l));
      for (const ev of events) {
        expect(ev.kind).toBe('tap');
        expect(typeof ev.step_id).toBe('string');
        expect(ev.step_id.startsWith('tap_')).toBe(true);
        expect(typeof ev.target).toBe('string');
        expect(typeof ev.t).toBe('number');
      }
    });

    test('hierarchy/ contains at least one snapshot with padded-digit filename', () => {
      const dir = path.join(SAMPLE_BUNDLE_DIR, 'hierarchy');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThanOrEqual(1);
      for (const f of files) {
        // Per artifacts.js, hierarchy filenames are padded digits + .json.
        expect(f).toMatch(/^\d{7,}\.json$/);
        const snap = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        expect(Array.isArray(snap.elements)).toBe(true);
      }
    });

    test('assertions.json parses as an empty array (per #22 scope)', () => {
      const arr = JSON.parse(
        fs.readFileSync(path.join(SAMPLE_BUNDLE_DIR, 'assertions.json'), 'utf8')
      );
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBe(0);
    });

    test('edits.jsonl is empty (no edits in #22)', () => {
      const raw = fs.readFileSync(path.join(SAMPLE_BUNDLE_DIR, 'edits.jsonl'), 'utf8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(0);
    });
  });

  describe('golden scenario JSON', () => {
    let scenario;
    let schema;

    beforeAll(() => {
      scenario = JSON.parse(fs.readFileSync(GOLDEN_SCENARIO_PATH, 'utf8'));
      schema = JSON.parse(fs.readFileSync(SCENARIO_SCHEMA_PATH, 'utf8'));
    });

    test('uses $schema_version 2.1', () => {
      expect(scenario.$schema_version).toBe('2.1');
    });

    test('all steps are tap actions (#22 scope)', () => {
      expect(Array.isArray(scenario.steps)).toBe(true);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of scenario.steps) {
        expect(step.action).toBe('tap');
        expect(step.id).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    test('description is one line and ≤120 characters', () => {
      expect(typeof scenario.description).toBe('string');
      expect(scenario.description.length).toBeLessThanOrEqual(120);
      expect(scenario.description).not.toContain('\n');
    });

    test('tags are kebab-case and within bounds', () => {
      expect(Array.isArray(scenario.tags)).toBe(true);
      expect(scenario.tags.length).toBeGreaterThanOrEqual(1);
      expect(scenario.tags.length).toBeLessThanOrEqual(5);
      for (const tag of scenario.tags) {
        expect(tag).toMatch(/^[a-z0-9][a-z0-9-]*$/);
        expect(tag.length).toBeLessThanOrEqual(20);
      }
    });

    test('assertions array is empty (no Add Assertion in #22)', () => {
      expect(Array.isArray(scenario.assertions)).toBe(true);
      expect(scenario.assertions.length).toBe(0);
    });

    test('validates against scenario_schema.json', () => {
      const errors = validateScenarioAgainstSchema(scenario, schema);
      if (errors.length > 0) {
        // Print first errors for visibility on failure.
        // eslint-disable-next-line no-console
        console.error('Schema errors:', errors);
      }
      expect(errors).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// NL assertion fixture bundle — structural ingestion contract
// ---------------------------------------------------------------------------
//
// Verifies that `sample-bundle-with-assertions/` is well-formed for an AI
// skill to ingest: the assertions.json entries carry NL text (not pre-typed
// assertion types) and the assert_*.png screenshots are present on disk.
// The actual NL→type classification is the AI's job at runtime, so we do NOT
// mock the AI here.

const SAMPLE_BUNDLE_WITH_ASSERTIONS_DIR = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'recorder',
  'sample-bundle-with-assertions'
);

describe('with NL assertions', () => {
  test('reads assertions.json entries as NL text to classify', () => {
    const assertionsPath = path.join(SAMPLE_BUNDLE_WITH_ASSERTIONS_DIR, 'assertions.json');
    expect(fs.existsSync(assertionsPath)).toBe(true);

    const entries = JSON.parse(fs.readFileSync(assertionsPath, 'utf8'));
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    for (const entry of entries) {
      // Each entry must carry a free-form NL text string — not a typed enum.
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);

      expect(typeof entry.nl_text).toBe('string');
      expect(entry.nl_text.length).toBeGreaterThan(0);

      expect(typeof entry.screenshot).toBe('string');
      expect(entry.screenshot.length).toBeGreaterThan(0);

      expect(typeof entry.anchor_step_id).toBe('string');
      expect(entry.anchor_step_id.length).toBeGreaterThan(0);

      expect(typeof entry.captured_at).toBe('string');
      // Must be a valid ISO 8601 datetime.
      expect(() => new Date(entry.captured_at).toISOString()).not.toThrow();

      // Must NOT have a pre-classified 'type' field — classification is the
      // AI's job at synthesis time.
      expect(entry.type).toBeUndefined();
    }
  });

  test('assert_*.png files are present alongside step screenshots', () => {
    const screenshotsDir = path.join(SAMPLE_BUNDLE_WITH_ASSERTIONS_DIR, 'screenshots');
    expect(fs.existsSync(screenshotsDir)).toBe(true);
    expect(fs.statSync(screenshotsDir).isDirectory()).toBe(true);

    const files = fs.readdirSync(screenshotsDir);

    // Must contain at least one step screenshot and at least one assert screenshot.
    const stepScreenshots = files.filter((f) => /^step_\d+\.png$/.test(f));
    const assertScreenshots = files.filter((f) => /^assert_.+\.png$/.test(f));

    expect(stepScreenshots.length).toBeGreaterThanOrEqual(1);
    expect(assertScreenshots.length).toBeGreaterThanOrEqual(1);

    // Each screenshot referenced in assertions.json must exist on disk.
    const assertionsPath = path.join(SAMPLE_BUNDLE_WITH_ASSERTIONS_DIR, 'assertions.json');
    const entries = JSON.parse(fs.readFileSync(assertionsPath, 'utf8'));
    for (const entry of entries) {
      const screenshotFile = path.basename(entry.screenshot);
      expect(files).toContain(screenshotFile);
      expect(
        fs.statSync(path.join(screenshotsDir, screenshotFile)).isFile()
      ).toBe(true);
    }
  });
});
