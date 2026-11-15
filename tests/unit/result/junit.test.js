'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { toJUnit } = require('../../../src/result/junit');
const { readFinalizedResult, resultFile } = require('../../../src/result/store');
const { workspaceDir } = require('../../../src/workspace/layout');
const { parseXml, findAll } = require('../../helpers/parse-xml');

const fixture = (name) => require(path.join(__dirname, 'fixtures', `${name}.json`));
const PASSED = fixture('passed');
const FAILED = fixture('failed');
const HOSTILE = fixture('hostile-strings');
const NOTHING_RECORDED = fixture('failed-nothing-recorded');
const INCOMPLETE = fixture('incomplete');
const FIXTURES = { PASSED, FAILED, HOSTILE, NOTHING_RECORDED, INCOMPLETE };

const suitesOf = (xml) => findAll(parseXml(xml), 'testsuite');
const casesOf = (suite) => suite.children.filter((c) => c.name === 'testcase');
const caseNamed = (suite, name) => casesOf(suite).find((c) => c.attrs.name === name);
const child = (node, name) => node.children.find((c) => c.name === name);
const propertiesOf = (suite) =>
  Object.fromEntries(findAll(child(suite, 'properties'), 'property').map((p) => [p.attrs.name, p.attrs.value]));

describe('parse-xml helper rejects what it should', () => {
  test.each([
    ['unbalanced', '<a><b></a>'],
    ['unclosed', '<a>'],
    ['bare ampersand', '<a>x & y</a>'],
    ['raw < in attribute', '<a b="<"/>'],
    ['two roots', '<a/><b/>'],
    ['illegal control char', '<a>\u0001</a>'],
  ])('%s', (_label, xml) => {
    expect(() => parseXml(xml)).toThrow();
  });

  test('decodes entities in text and attributes', () => {
    const root = parseXml('<a b="&quot;&amp;&#10;">&lt;x&gt; &apos;</a>');
    expect(root.attrs.b).toBe('"&\n');
    expect(root.text).toBe("<x> '");
  });
});

// Every fixture is something the reader actually hands a renderer: a result
// valid against the shipped schema.
test.each(Object.entries(FIXTURES))('fixture %s is a finalized result readFinalizedResult accepts', (_name, result) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-junit-fixture-'));
  fs.mkdirSync(path.join(workspaceDir(root), 'results'), { recursive: true });
  fs.writeFileSync(resultFile(root, result.run_id), JSON.stringify(result));
  expect(readFinalizedResult(root, result.run_id)).toEqual({ result });
});

describe('toJUnit', () => {
  test('emits a well-formed document with an XML declaration', () => {
    const { xml } = toJUnit([PASSED, FAILED, HOSTILE, NOTHING_RECORDED]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    const root = parseXml(xml);
    expect(root.name).toBe('testsuites');
  });

  test('one testsuite per result, in input order, named by scenario', () => {
    const suites = suitesOf(toJUnit([FAILED, PASSED]).xml);
    expect(suites.map((s) => s.attrs.name)).toEqual(['checkout_flow', 'login_flow']);
    expect(suites[1].attrs.timestamp).toBe('2026-10-27T10:00:00.000Z');
    expect(suites[1].attrs.time).toBe('12.5');
  });

  test('a passed result: one empty testcase per assertion, no step cases', () => {
    const [suite] = suitesOf(toJUnit([PASSED]).xml);
    expect(casesOf(suite).map((c) => c.attrs.name)).toEqual(['assert_home_visible', 'assert_greeting']);
    for (const c of casesOf(suite)) {
      expect(c.attrs.classname).toBe('login_flow');
      expect(c.children).toEqual([]);
    }
    expect(suite.attrs).toMatchObject({ tests: '2', failures: '0', errors: '0', skipped: '0' });
  });

  test('a failed assertion carries a <failure> with message, expected and actual', () => {
    const [suite] = suitesOf(toJUnit([FAILED]).xml);
    const failure = child(caseNamed(suite, 'assert_total'), 'failure');
    expect(failure.attrs.message).toBe('Total mismatch');
    expect(failure.attrs.type).toBe('assertion_failed');
    expect(failure.text).toContain('expected: $20.00');
    expect(failure.text).toContain('actual: $25.00');
    expect(caseNamed(suite, 'assert_cart_count').children).toEqual([]);
  });

  test('failed and errored steps become their own failing testcases; passed and skipped do not', () => {
    const [suite] = suitesOf(toJUnit([FAILED]).xml);
    const failedStep = child(caseNamed(suite, 'step: tap_pay'), 'failure');
    expect(failedStep.attrs).toMatchObject({ type: 'step_failed', message: 'Pay button not found' });
    expect(failedStep.text).toContain('shots/tap_pay.png');
    expect(child(caseNamed(suite, 'step: read_receipt'), 'failure').attrs.type).toBe('step_error');
    expect(caseNamed(suite, 'step: open_cart')).toBeUndefined();
    expect(caseNamed(suite, 'step: rate_app')).toBeUndefined();
    expect(suite.attrs).toMatchObject({ tests: '4', failures: '3', skipped: '0' });
  });

  test('properties carry run id, status and metadata', () => {
    const [suite] = suitesOf(toJUnit([PASSED]).xml);
    expect(propertiesOf(suite)).toEqual({
      run_id: 'run_20261027_100000',
      status: 'passed',
      'metadata.app_version': '1.4.0',
      'metadata.device_model': 'Pixel 8',
      'metadata.api_level': '36',
      'metadata.environment': 'staging',
      'metadata.timestamp': '2026-10-27T10:00:00.000Z',
    });
  });

  test('a failed/error result with nothing failing recorded gets a synthetic "run status" failure', () => {
    const [suite] = suitesOf(toJUnit([NOTHING_RECORDED]).xml);
    const failure = child(caseNamed(suite, 'run status'), 'failure');
    expect(failure.attrs.type).toBe('run_status');
    expect(failure.attrs.message).toMatch(/status is error/);
    expect(suite.attrs).toMatchObject({ tests: '1', failures: '1' });
  });

  // #275, plan decision 6: pending is skipped, not failed. CI gates on the
  // exit code (7); the report shows what is pending.
  describe('needs_agent (#275)', () => {
    test('pending assertions and pending steps render as <skipped>', () => {
      const [suite] = suitesOf(toJUnit([INCOMPLETE]).xml);
      const avatar = child(caseNamed(suite, 'assert_avatar_looks_right'), 'skipped');
      expect(avatar.attrs.message).toBe('assert_avatar_looks_right needs agent judgment (visual_state)');
      expect(child(caseNamed(suite, 'assert_dark_mode'), 'skipped')).toBeDefined();
      expect(child(caseNamed(suite, 'step: toggle_theme'), 'skipped').attrs.message).toBe('step toggle_theme needs agent judgment');
      expect(caseNamed(suite, 'assert_profile_visible').children).toEqual([]);
      expect(caseNamed(suite, 'step: open_profile')).toBeUndefined();
      expect(suite.attrs).toMatchObject({ tests: '4', failures: '0', skipped: '3' });
    });

    test('an incomplete run gets no synthetic run-status failure', () => {
      const report = toJUnit([INCOMPLETE]);
      expect(caseNamed(suitesOf(report.xml)[0], 'run status')).toBeUndefined();
      expect(report).toMatchObject({ tests: 4, failures: 0, skipped: 3 });
      expect(parseXml(report.xml).attrs).toMatchObject({ tests: '4', failures: '0', skipped: '3' });
    });

    test('an incomplete run with nothing pending recorded gets a synthetic skipped run status, never a green report', () => {
      const bare = { ...INCOMPLETE, steps_executed: [], assertion_results: [] };
      const [suite] = suitesOf(toJUnit([bare]).xml);
      const skipped = child(caseNamed(suite, 'run status'), 'skipped');
      expect(skipped.attrs.message).toMatch(/status is incomplete/);
      expect(suite.attrs).toMatchObject({ tests: '1', failures: '0', skipped: '1' });
    });

    test('a pending step that also failed is a failure, not skipped', () => {
      const r = { ...INCOMPLETE, status: 'failed', steps_executed: [{ step_id: 'x', status: 'failed', needs_agent: true }], assertion_results: [] };
      const [suite] = suitesOf(toJUnit([r]).xml);
      expect(child(caseNamed(suite, 'step: x'), 'failure')).toBeDefined();
      expect(child(caseNamed(suite, 'step: x'), 'skipped')).toBeUndefined();
    });
  });

  test('a failed result that already has a failing case gets no synthetic one', () => {
    const [suite] = suitesOf(toJUnit([FAILED]).xml);
    expect(caseNamed(suite, 'run status')).toBeUndefined();
  });

  // The reader no longer guarantees schema shape (a finalized result is any
  // object finalize wrote for the run id), so the renderer tolerates what older
  // or hand-edited files carry (#274 review).
  describe('tolerates results outside the current schema', () => {
    test('a null scenario_id names the suite and its testcases by run id', () => {
      const result = { ...FAILED, scenario_id: null };
      const [suite] = suitesOf(toJUnit([result]).xml);
      expect(suite.attrs.name).toBe(FAILED.run_id);
      expect(casesOf(suite).length).toBeGreaterThan(0);
      for (const c of casesOf(suite)) expect(c.attrs.classname).toBe(FAILED.run_id);
    });

    test.each(['FAILED', 'garbage', undefined])('a status of %s with nothing failing recorded reads red', (status) => {
      const result = { ...PASSED, status, assertion_results: [], steps_executed: [] };
      const report = toJUnit([result]);
      const [suite] = suitesOf(report.xml);
      expect(child(caseNamed(suite, 'run status'), 'failure').attrs.type).toBe('run_status');
      expect(report.failures).toBe(1);
    });

    test('missing containers and metadata render without throwing', () => {
      const { run_id, status } = PASSED;
      const report = toJUnit([{ run_id, status }]);
      const [suite] = suitesOf(report.xml);
      expect(suite.attrs).toMatchObject({ name: run_id, tests: '0', failures: '0', time: '0' });
      expect(suite.attrs.timestamp).toBeUndefined();
      expect(propertiesOf(suite)).toEqual({ run_id, status });
    });

    test('null metadata and non-object entries render without throwing', () => {
      const result = {
        ...FAILED,
        metadata: null,
        assertion_results: [null, 'x', 7, ...FAILED.assertion_results],
        steps_executed: [null, [], ...FAILED.steps_executed],
      };
      const report = toJUnit([result]);
      expect(report).toMatchObject({ tests: 4, failures: 3 });
      expect(Object.keys(propertiesOf(suitesOf(report.xml)[0])).some((k) => k.startsWith('metadata.'))).toBe(false);
    });

    test('non-array containers render as empty', () => {
      const result = { ...FAILED, assertion_results: {}, steps_executed: 'nope' };
      const report = toJUnit([result]);
      expect(report).toMatchObject({ tests: 1, failures: 1 });
      expect(caseNamed(suitesOf(report.xml)[0], 'run status')).toBeDefined();
    });
  });

  test('escapes markup characters and strips characters illegal in XML 1.0', () => {
    const { xml } = toJUnit([HOSTILE]);
    const [suite] = suitesOf(xml);
    expect(suite.attrs.name).toBe('search_<&>"\'');
    expect(propertiesOf(suite)['metadata.device_model']).toBe('iPhone "16"');
    const failure = child(caseNamed(suite, 'assert_<b>'), 'failure');
    expect(failure.attrs.message).toBe('Expected \'a\' < \'b\' && "c" > d');
    expect(failure.text).toContain('expected: <x> & "y"');
    expect(failure.text).toContain('actual: bell and tab\there');
  });

  test('root totals add up across suites', () => {
    const report = toJUnit([PASSED, FAILED, NOTHING_RECORDED]);
    expect(report).toEqual({ xml: report.xml, suites: 3, tests: 7, failures: 4, skipped: 0 });
    const root = parseXml(report.xml);
    expect(root.attrs).toMatchObject({ name: 'mauto', tests: '7', failures: '4', skipped: '0', errors: '0', time: '42.5' });
  });

  test('an empty result list is still a valid, empty report', () => {
    const report = toJUnit([]);
    expect(report).toEqual({ xml: report.xml, suites: 0, tests: 0, failures: 0, skipped: 0 });
    expect(findAll(parseXml(report.xml), 'testsuite')).toEqual([]);
  });

  test('is deterministic and does not mutate its input', () => {
    const before = JSON.stringify(FAILED);
    expect(toJUnit([FAILED]).xml).toBe(toJUnit([FAILED]).xml);
    expect(JSON.stringify(FAILED)).toBe(before);
  });
});
