'use strict';

// src/assertion/fields.js is the single scenario <-> evaluator <-> CLI mapping
// for assertions. Two paths reach the evaluator: an agent (or the E2E harness)
// passes scenario fields to `mauto assert` as flags, and `mauto run` hands the
// scenario assertion straight to the evaluator. They must build the same
// evaluator input, or the same scenario would verdict differently by path.

const { EXPECTED_FIELD, FIELDS, toEvaluatorInput, fromCliFlags, toCliFlags, expectedOf } = require('../../../src/assertion/fields');

// The flag -> option-key parse commander performs for `mauto assert`.
// Stated by hand, not derived from FIELDS, so a renamed flag fails here.
const FLAG_KEY = {
  '--target': 'target',
  '--expected': 'expected',
  '--operator': 'operator',
  '--count': 'count',
  '--pattern': 'pattern',
  '--variable': 'variable',
};

describe('FIELDS', () => {
  test('is the one table, in `mauto assert` argv order', () => {
    expect(FIELDS.map((f) => `--${f.flag}`)).toEqual(Object.keys(FLAG_KEY));
    expect(FIELDS.map((f) => f.input)).toEqual(['target', 'expected', 'operator', 'count', 'pattern', 'variable_name']);
  });
});
function parsedFlagsOf(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = FLAG_KEY[argv[i]];
    if (!key) throw new Error(`unexpected flag ${argv[i]}`);
    flags[key] = argv[i + 1];
  }
  return flags;
}

// Scenario assertions with the exact argv the E2E harness's assertFlags
// (sample-app/scripts/lib/executor.js) produced for them when this module
// was extracted from it.
const CASES = [
  {
    a: { id: 'a1', type: 'element_text', after_step: 's1', element_description: 'Title', expected_value: 'Sample Shop' },
    argv: ['--target', 'Title', '--expected', 'Sample Shop'],
  },
  {
    a: { id: 'a2', type: 'text_contains', after_step: 's1', element_description: 'Banner', expected_substring: 'Shop' },
    argv: ['--target', 'Banner', '--expected', 'Shop'],
  },
  {
    a: { id: 'a3', type: 'element_hint', after_step: 's1', element_description: 'Search', expected_text: 'Search products' },
    argv: ['--target', 'Search', '--expected', 'Search products'],
  },
  {
    a: { id: 'a4', type: 'content_description', after_step: 's1', element_description: 'Cart', label_value: 'Cart icon' },
    argv: ['--target', 'Cart', '--expected', 'Cart icon'],
  },
  {
    a: { id: 'a5', type: 'has_accessibility_label', after_step: 's1', element_description: 'More', label_value: 'More' },
    argv: ['--target', 'More', '--expected', 'More'],
  },
  {
    a: { id: 'a6', type: 'element_visible', after_step: 's1', element_description: 'Home', expected_visible: false },
    argv: ['--target', 'Home', '--expected', 'false'],
  },
  {
    a: { id: 'a7', type: 'element_count', after_step: 's1', element_description: 'Product', operator: '>=', expected_count: 3 },
    argv: ['--target', 'Product', '--operator', '>=', '--count', '3'],
  },
  {
    a: { id: 'a8', type: 'text_matches_pattern', after_step: 's1', pattern: '^\\$\\d+' },
    argv: ['--pattern', '^\\$\\d+'],
  },
  {
    a: { id: 'a9', type: 'text_contains_variable', after_step: 's1', element_description: 'Greeting', variable_name: 'user' },
    argv: ['--target', 'Greeting', '--variable', 'user'],
  },
  {
    a: { id: 'a10', type: 'element_exists', after_step: 's1', element_description: 'Home' },
    argv: ['--target', 'Home'],
  },
  {
    // A type with no expected field ignores a stray expected-shaped key.
    a: { id: 'a11', type: 'element_exists', after_step: 's1', element_description: 'Home', expected_value: 'x' },
    argv: ['--target', 'Home'],
  },
];

describe('EXPECTED_FIELD', () => {
  test('names the scenario field carrying the expected value per mechanical type', () => {
    expect(EXPECTED_FIELD).toEqual({
      element_text: 'expected_value',
      text_contains: 'expected_substring',
      element_hint: 'expected_text',
      content_description: 'label_value',
      has_accessibility_label: 'label_value',
      element_visible: 'expected_visible',
    });
  });

  test('every key is covered by a round-trip case', () => {
    const covered = new Set(CASES.map((c) => c.a.type));
    for (const type of Object.keys(EXPECTED_FIELD)) expect(covered).toContain(type);
  });
});

describe.each(CASES)('$a.type ($a.id)', ({ a, argv }) => {
  test('toCliFlags matches what the harness passed to `mauto assert`', () => {
    expect(toCliFlags(a)).toEqual(argv);
  });

  test('scenario -> evaluator equals scenario -> CLI flags -> evaluator', () => {
    expect(toEvaluatorInput(a)).toEqual(fromCliFlags(a.type, parsedFlagsOf(toCliFlags(a))));
  });
});

describe('expectedOf', () => {
  test.each(CASES)('is the --expected value of toCliFlags ($a.id)', ({ a, argv }) => {
    const i = argv.indexOf('--expected');
    expect(expectedOf(a)).toBe(i === -1 ? null : argv[i + 1]);
  });
});

describe('toEvaluatorInput', () => {
  test('maps scenario names and coerces count to a number', () => {
    expect(toEvaluatorInput(CASES[6].a)).toEqual({ type: 'element_count', target: 'Product', operator: '>=', count: 3 });
  });

  test('includes only provided keys', () => {
    expect(toEvaluatorInput({ type: 'element_exists' })).toEqual({ type: 'element_exists' });
  });
});

describe('fromCliFlags', () => {
  test('builds exactly the evaluator input `mauto assert` built inline', () => {
    expect(
      fromCliFlags('element_count', { target: 'x', expected: 'e', operator: '<', count: '2', pattern: 'p', variable: 'v' })
    ).toEqual({ type: 'element_count', target: 'x', expected: 'e', operator: '<', count: 2, pattern: 'p', variable_name: 'v' });
  });

  test('drops undefined flags and tolerates no flags', () => {
    expect(fromCliFlags('element_exists', { target: undefined })).toEqual({ type: 'element_exists' });
    expect(fromCliFlags('element_exists')).toEqual({ type: 'element_exists' });
  });
});
