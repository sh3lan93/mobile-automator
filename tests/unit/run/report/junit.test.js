'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { toJUnit } = require('../../../../src/run/report/junit');
const { readFinalizedResult, resultFile } = require('../../../../src/result/store');
const { workspaceDir } = require('../../../../src/workspace/layout');
const { parseXml, findAll } = require('../../../helpers/parse-xml');

const fixture = (name) => require(path.join(__dirname, 'fixtures', `${name}.json`));
const PASSED = fixture('passed');
const FAILED = fixture('failed');
const NEEDS_AGENT_STEP = fixture('needs-agent-step');
const HOSTILE = fixture('hostile-strings');
const NOTHING_RECORDED = fixture('failed-nothing-recorded');
const FIXTURES = { PASSED, FAILED, NEEDS_AGENT_STEP, HOSTILE, NOTHING_RECORDED };

// What R2 (#271) adds to the result schema: an `incomplete` run status and a
// `needs_agent` assertion status. The reader rejects both until R2 extends the
// schema, but `mauto run --junit` will hand the renderer in-memory results of
// this shape, so they are exercised here, against the pure renderer only.
const R2_INCOMPLETE = {
  ...NEEDS_AGENT_STEP,
  status: 'incomplete',
  passed_assertions: 1,
  assertion_results: [
    NEEDS_AGENT_STEP.assertion_results[0],
    { ...NEEDS_AGENT_STEP.assertion_results[1], status: 'needs_agent', message: 'visual_check needs an agent verdict' },
  ],
  summary: 'incomplete: 1 assertion needs an agent verdict.',
};

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
    const { xml } = toJUnit([PASSED, FAILED, R2_INCOMPLETE, HOSTILE, NOTHING_RECORDED]);
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

  test('a needs_agent step is <skipped>, counted as skipped not failed', () => {
    const report = toJUnit([NEEDS_AGENT_STEP]);
    const [suite] = suitesOf(report.xml);
    expect(child(caseNamed(suite, 'step: toggle_wifi'), 'skipped').attrs.message).toBe(
      'needs_agent: step toggle_wifi must be performed by an agent'
    );
    expect(report).toMatchObject({ suites: 1, tests: 3, failures: 0, skipped: 1 });
  });

  test('R2 needs_agent assertions and steps are <skipped>, counted as skipped not failed', () => {
    const report = toJUnit([R2_INCOMPLETE]);
    const [suite] = suitesOf(report.xml);
    const skipped = child(caseNamed(suite, 'assert_layout_looks_right'), 'skipped');
    expect(skipped.attrs.message).toBe('needs_agent: visual_check needs an agent verdict');
    expect(child(caseNamed(suite, 'step: toggle_wifi'), 'skipped')).toBeDefined();
    expect(suite.attrs).toMatchObject({ tests: '3', failures: '0', skipped: '2' });
    expect(report).toMatchObject({ suites: 1, tests: 3, failures: 0, skipped: 2 });
  });

  test('an R2 incomplete result is not given a synthetic failure', () => {
    const [suite] = suitesOf(toJUnit([R2_INCOMPLETE]).xml);
    expect(caseNamed(suite, 'run status')).toBeUndefined();
    expect(propertiesOf(suite).status).toBe('incomplete');
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

  test("executor provenance comes from the result's own executor", () => {
    const props = propertiesOf(suitesOf(toJUnit([NEEDS_AGENT_STEP]).xml)[0]);
    expect(props).toMatchObject({
      'executor.kind': 'mauto-run',
      'executor.engine': 'mobilecli',
      'executor.scenario_sha256': 'abc123',
    });
  });

  test('opts.executor supplies provenance for results that carry none', () => {
    const props = propertiesOf(suitesOf(toJUnit([PASSED], { executor: { kind: 'mauto-run', engine: 'legacy' } }).xml)[0]);
    expect(props).toMatchObject({ 'executor.kind': 'mauto-run', 'executor.engine': 'legacy' });
  });

  test("a result's own executor wins over opts.executor", () => {
    const props = propertiesOf(suitesOf(toJUnit([NEEDS_AGENT_STEP], { executor: { engine: 'legacy' } }).xml)[0]);
    expect(props['executor.engine']).toBe('mobilecli');
  });

  test('no executor properties when there is no provenance', () => {
    const props = propertiesOf(suitesOf(toJUnit([PASSED]).xml)[0]);
    expect(Object.keys(props).some((k) => k.startsWith('executor.'))).toBe(false);
  });

  test('a failed/error result with nothing failing recorded gets a synthetic "run status" failure', () => {
    const [suite] = suitesOf(toJUnit([NOTHING_RECORDED]).xml);
    const failure = child(caseNamed(suite, 'run status'), 'failure');
    expect(failure.attrs.type).toBe('run_status');
    expect(failure.attrs.message).toMatch(/status is error/);
    expect(suite.attrs).toMatchObject({ tests: '1', failures: '1' });
  });

  test('a failed result that already has a failing case gets no synthetic one', () => {
    const [suite] = suitesOf(toJUnit([FAILED]).xml);
    expect(caseNamed(suite, 'run status')).toBeUndefined();
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
    const report = toJUnit([PASSED, FAILED, NEEDS_AGENT_STEP]);
    expect(report).toMatchObject({ suites: 3, tests: 9, failures: 3, skipped: 1 });
    const root = parseXml(report.xml);
    expect(root.attrs).toMatchObject({ name: 'mauto', tests: '9', failures: '3', errors: '0', skipped: '1', time: '50.5' });
  });

  test('an empty result list is still a valid, empty report', () => {
    const report = toJUnit([]);
    expect(report).toMatchObject({ suites: 0, tests: 0, failures: 0, skipped: 0 });
    expect(findAll(parseXml(report.xml), 'testsuite')).toEqual([]);
  });

  test('is deterministic and does not mutate its input', () => {
    const before = JSON.stringify(FAILED);
    expect(toJUnit([FAILED]).xml).toBe(toJUnit([FAILED]).xml);
    expect(JSON.stringify(FAILED)).toBe(before);
  });
});
