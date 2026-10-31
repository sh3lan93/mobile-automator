'use strict';

// JUnit XML rendering of finalized result files (#274). Its input is what
// readFinalizedResult (src/result/store.js) guarantees: a result valid against
// the result schema, so there are no fallbacks for schema-required fields here.
// Pure: no fs, no clock, no input mutation, so the same results always render
// to the same bytes. It is consumed by `mauto result export` today and by `mauto run --junit` later,
// which is why it lives under src/run/ rather than beside the CLI handler.
//
// Mapping, one result at a time:
//   result                 -> <testsuite name=scenario_id>
//   assertion_results[]    -> <testcase name=assertion_id>; failed -> <failure>,
//                             needs_agent -> <skipped>
//   failed / error step    -> <testcase name="step: <id>"> with <failure>
//   step needs_agent       -> <testcase name="step: <id>"> with <skipped>
//   run id, status, metadata, executor -> <properties>
//
// A step's `error` status is reported as a <failure> of type step_error rather
// than a JUnit <error>, so the report's counts stay {tests, failures, skipped}
// and `errors` is always 0.

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

// Seconds as a plain decimal, rounded to the millisecond so summed floats do
// not render as 50.50000000001.
function seconds(value) {
  const n = Number(value);
  return String(Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0);
}

function properties(result, executor) {
  const props = [
    ['run_id', result.run_id],
    ['status', result.status],
  ];
  for (const key of METADATA_KEYS) {
    if (present(result.metadata[key])) props.push([`metadata.${key}`, result.metadata[key]]);
  }
  const provenance = result.executor || executor;
  if (provenance && typeof provenance === 'object') {
    for (const [key, value] of Object.entries(provenance)) {
      if (present(value) && typeof value !== 'object') props.push([`executor.${key}`, value]);
    }
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
  } else if (assertion.status === 'needs_agent') {
    testcase.skipped = { message: `needs_agent: ${assertion.message || 'awaiting an agent verdict'}` };
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
  if (step.needs_agent === true) {
    return { name, skipped: { message: `needs_agent: step ${step.step_id} must be performed by an agent` } };
  }
  return null;
}

function suiteFor(result, executor) {
  const scenario = result.scenario_id;
  const cases = [
    ...result.assertion_results.map(assertionCase),
    ...result.steps_executed.map(stepCase).filter(Boolean),
  ];

  // A red result must never render as a green report. When the run says
  // failed/error but recorded nothing that fails (e.g. an agent finalized with
  // --status failed after an abort), the status itself becomes the failure.
  const isRed = result.status === 'failed' || result.status === 'error';
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
  const skipped = cases.filter((c) => c.skipped).length;

  const lines = [];
  lines.push(
    `  <testsuite${attrs([
      ['name', scenario],
      ['tests', cases.length],
      ['failures', failures],
      ['errors', 0],
      ['skipped', skipped],
      ['time', seconds(result.duration_seconds)],
      ['timestamp', present(result.metadata.timestamp) ? result.metadata.timestamp : null],
    ])}>`
  );
  const props = properties(result, executor);
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
    } else if (c.skipped) {
      lines.push(`${open}>`);
      lines.push(`      <skipped${attrs([['message', c.skipped.message]])}/>`);
      lines.push('    </testcase>');
    } else {
      lines.push(`${open}/>`);
    }
  }
  lines.push('  </testsuite>');

  return { lines, tests: cases.length, failures, skipped, time: Number(seconds(result.duration_seconds)) };
}

// toJUnit(results, { executor }) -> { xml, suites, tests, failures, skipped }
//
// `executor` is provenance for results that carry none of their own (a result
// file's root `executor` always wins).
function toJUnit(results, { executor } = {}) {
  const suites = results.map((r) => suiteFor(r, executor));
  const total = (key) => suites.reduce((sum, s) => sum + s[key], 0);
  const tests = total('tests');
  const failures = total('failures');
  const skipped = total('skipped');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites${attrs([
      ['name', 'mauto'],
      ['tests', tests],
      ['failures', failures],
      ['errors', 0],
      ['skipped', skipped],
      ['time', seconds(total('time'))],
    ])}>`,
    ...suites.flatMap((s) => s.lines),
    '</testsuites>',
    '',
  ].join('\n');

  return { xml, suites: suites.length, tests, failures, skipped };
}

module.exports = { toJUnit };
