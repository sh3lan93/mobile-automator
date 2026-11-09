'use strict';

// JUnit XML rendering of finalized result files (#274). Its input is what
// readFinalizedResult (src/result/store.js) guarantees: an object finalize wrote
// for the run id — NOT one valid against the result schema (a run recorded
// without --scenario-id has scenario_id null; a pre-0.38.0 file has an
// upper-case status). So the renderer tolerates: the suite is named by the run
// id when there is no scenario_id, any status other than `passed` reads red, a
// missing metadata/container is empty, and non-object entries are dropped.
// Pure: no fs, no clock, no input mutation, so the same results always render
// to the same bytes. It is consumed by `mauto result export`.
//
// Mapping, one result at a time:
//   result                 -> <testsuite name=scenario_id, else run_id>
//   assertion_results[]    -> <testcase name=assertion_id>; failed -> <failure>
//   failed / error step    -> <testcase name="step: <id>"> with <failure>
//   run id, status, metadata -> <properties>
//
// It renders only what current writers produce: assertions are passed or
// failed, and only failed or errored steps get a testcase, so there is no
// JUnit skip element and no skip count. A step's `error` status is reported as
// a <failure> of type step_error rather than a JUnit <error>, so the report's
// counts stay {tests, failures} and `errors` is always 0.

// Characters XML 1.0 forbids anywhere in a document: C0 controls other than
// tab/LF/CR, lone surrogates, U+FFFE and U+FFFF. A crash excerpt or an OCR'd
// label can carry any of them, and one is enough to make the whole report
// unparseable, so they are dropped rather than escaped (escaping does not make
// them legal).
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const METADATA_KEYS = ['app_version', 'device_model', 'api_level', 'environment', 'timestamp'];

function clean(value) {
  return String(value).replace(ILLEGAL_XML_CHARS, '');
}

function escapeText(value) {
  return clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Attribute values additionally escape quotes, and encode whitespace a parser
// would otherwise normalise to a space, so a multi-line message survives.
function escapeAttr(value) {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

function attrs(pairs) {
  return pairs
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
}

const present = (v) => v !== undefined && v !== null && v !== '';

// A container as an array of its object entries; anything else is empty.
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (value) => (Array.isArray(value) ? value.filter(isObject) : []);

// Seconds as a plain decimal, rounded to the millisecond so summed floats do
// not render as 50.50000000001.
function seconds(value) {
  const n = Number(value);
  return String(Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0);
}

function properties(result, metadata) {
  const props = [
    ['run_id', result.run_id],
    ['status', result.status],
  ];
  for (const key of METADATA_KEYS) {
    if (present(metadata[key])) props.push([`metadata.${key}`, metadata[key]]);
  }
  return props.filter(([, v]) => present(v));
}

function assertionCase(assertion) {
  const testcase = { name: assertion.assertion_id };
  if (assertion.status === 'failed') {
    const body = [];
    if (present(assertion.expected)) body.push(`expected: ${assertion.expected}`);
    if (present(assertion.actual)) body.push(`actual: ${assertion.actual}`);
    testcase.failure = {
      type: assertion.type ? `${assertion.type}_failed` : 'assertion_failed',
      message: assertion.message || `${assertion.assertion_id} failed`,
      body: body.join('\n'),
    };
  }
  return testcase;
}

function stepCase(step) {
  const name = `step: ${step.step_id}`;
  if (step.status === 'failed' || step.status === 'error') {
    const body = [];
    if (present(step.error_message)) body.push(step.error_message);
    if (present(step.screenshot)) body.push(`screenshot: ${step.screenshot}`);
    return {
      name,
      failure: {
        type: step.status === 'error' ? 'step_error' : 'step_failed',
        message: step.error_message || `step ${step.step_id} ${step.status}`,
        body: body.join('\n'),
      },
    };
  }
  return null;
}

function suiteFor(result) {
  const scenario = result.scenario_id ?? result.run_id;
  const metadata = isObject(result.metadata) ? result.metadata : {};
  const cases = [
    ...asArray(result.assertion_results).map(assertionCase),
    ...asArray(result.steps_executed).map(stepCase).filter(Boolean),
  ];

  // A red result must never render as a green report. When the run says
  // anything but passed yet recorded nothing that fails (e.g. an agent
  // finalized with --status failed after an abort, or a pre-0.38.0 "FAILED"),
  // the status itself becomes the failure.
  const isRed = result.status !== 'passed';
  if (isRed && !cases.some((c) => c.failure)) {
    cases.push({
      name: 'run status',
      failure: {
        type: 'run_status',
        message: `result status is ${result.status} but no failed step or assertion was recorded`,
        body: result.summary,
      },
    });
  }

  const failures = cases.filter((c) => c.failure).length;

  const lines = [];
  lines.push(
    `  <testsuite${attrs([
      ['name', scenario],
      ['tests', cases.length],
      ['failures', failures],
      ['errors', 0],
      ['time', seconds(result.duration_seconds)],
      ['timestamp', present(metadata.timestamp) ? metadata.timestamp : null],
    ])}>`
  );
  const props = properties(result, metadata);
  if (props.length) {
    lines.push('    <properties>');
    for (const [name, value] of props) lines.push(`      <property${attrs([['name', name], ['value', value]])}/>`);
    lines.push('    </properties>');
  }
  for (const c of cases) {
    const open = `    <testcase${attrs([['name', c.name], ['classname', scenario]])}`;
    if (c.failure) {
      const { type, message, body } = c.failure;
      lines.push(`${open}>`);
      lines.push(`      <failure${attrs([['message', message], ['type', type]])}>${escapeText(body)}</failure>`);
      lines.push('    </testcase>');
    } else {
      lines.push(`${open}/>`);
    }
  }
  lines.push('  </testsuite>');

  return { lines, tests: cases.length, failures, time: Number(seconds(result.duration_seconds)) };
}

// toJUnit(results) -> { xml, suites, tests, failures }
function toJUnit(results) {
  const suites = results.map(suiteFor);
  const total = (key) => suites.reduce((sum, s) => sum + s[key], 0);
  const tests = total('tests');
  const failures = total('failures');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites${attrs([
      ['name', 'mauto'],
      ['tests', tests],
      ['failures', failures],
      ['errors', 0],
      ['time', seconds(total('time'))],
    ])}>`,
    ...suites.flatMap((s) => s.lines),
    '</testsuites>',
    '',
  ].join('\n');

  return { xml, suites: suites.length, tests, failures };
}

module.exports = { toJUnit };
