'use strict';

// `mauto assert screenshot_match` (#281): capture a stable screenshot and
// compare it against `--reference`, through the same decision `mauto run`
// uses (./reference-assertion.js), fed the same evaluator input (the flags
// through src/assertion/fields.js fromCliFlags). The capture and its diff land
// under <workspace>/screenshots/assert/<id>/ (./screenshots.js
// assertArtifacts). Every flag is checked before the device is touched. A
// mismatch is test_failed (exit 6); a missing baseline is ok with needs_agent
// (exit 0), and --update-references records it instead.

const { ok, fail } = require('../output/envelope');
const { FS_ERROR_CODES, deviceFail } = require('../output/device-fail');
const { fromCliFlags } = require('../assertion/fields');
const { findFirst } = require('../assertion/evaluator');
const configManager = require('../config/manager');
const { realClock } = require('./clock');
const { runSettings } = require('./settings');
const { decideReferenceScreenshot, toleranceOf, parseMaskSpec } = require('./reference-assertion');
const { assertArtifacts } = require('./screenshots');

// Quote a path for a copy-pasteable command line.
const shellQuote = (s) => JSON.stringify(String(s));

async function handleAssertReference(
  { deviceBridge, projectRoot = null, clock = realClock, loadConfig = configManager.load, now = () => new Date() },
  type,
  flags
) {
  const invalid = (message, hint = null) => ({ envelope: fail('invalid_input', message, hint), exitKind: 'invalid_input' });
  const input = fromCliFlags(type, flags);
  if (typeof input.reference_screenshot !== 'string' || input.reference_screenshot.trim() === '') {
    return invalid(
      `${type} needs --reference <path>: the baseline image to compare against`,
      'Pass --reference <path> (relative to the workspace directory); add --update-references to record it from this screen.'
    );
  }
  let masks;
  try {
    toleranceOf(input.tolerance);
    masks = (flags.mask || []).map(parseMaskSpec);
  } catch (err) {
    return invalid(err.message, 'Use --tolerance <0..1> and --mask <x,y,width,height | element description>.');
  }
  if (!projectRoot) {
    return {
      envelope: fail(
        'environment',
        `${type} needs a workspace: its screenshots are written under the workspace directory`,
        'Run `mauto setup` in the project root first, or run this from inside an existing workspace.'
      ),
      exitKind: 'environment',
    };
  }
  let paths;
  try {
    paths = assertArtifacts({ projectRoot, input, now: now() });
  } catch (err) {
    return invalid(err.message, 'Keep --reference inside the project.');
  }

  let decision;
  try {
    decision = await decideReferenceScreenshot({
      bridge: deviceBridge,
      clock,
      settings: runSettings(loadConfig(projectRoot)),
      projectRoot,
      input,
      masks,
      paths,
      updateReferences: flags.updateReferences === true,
      findFirst,
    });
  } catch (err) {
    // A filesystem fault is the environment's (withEnvelope classifies it);
    // anything else came from capturing the screen.
    if (err && FS_ERROR_CODES.has(err.code)) throw err;
    return deviceFail(err);
  }

  const { verdict: v, diff } = decision;
  const needsAgent = v.status === 'needs_agent';
  const data = {
    type,
    mechanical: v.mechanical,
    pass: needsAgent ? null : v.status === 'passed',
    needs_agent: needsAgent,
    message: v.message,
    reference_screenshot: v.reference_screenshot,
    actual_screenshot: v.actual_screenshot,
    similarity_score: v.similarity_score,
    diff_screenshot: diff,
  };
  // A missing baseline is never judged by eye (the execute guide): the agent
  // records one only once the user confirms the screen, else leaves the
  // assertion pending (`--pass pending` records needs_agent, judge none).
  const verdict = needsAgent ? 'pending' : String(data.pass);
  const recordCommand =
    `mauto result add-assertion --run-id <run_id> --step-id <step_id> ` +
    `--type ${type} --pass ${verdict} --message "<why>" ` +
    `--reference-screenshot ${shellQuote(v.reference_screenshot)} --actual-screenshot ${shellQuote(v.actual_screenshot)}` +
    (v.similarity_score === null ? '' : ` --similarity-score ${v.similarity_score}`);

  if (needsAgent) {
    const hint =
      `No reference screenshot at ${v.reference_screenshot}. If the user confirms this screen is correct, ` +
      `re-run with --update-references to record it; otherwise leave it pending: ${recordCommand}`;
    return { envelope: ok(data, hint), exitKind: 'ok' };
  }
  const hint = `Record it: ${recordCommand}`;
  if (!data.pass) {
    return { envelope: fail('test_failed', `assertion failed: ${v.message}`, hint, data), exitKind: 'test_failed' };
  }
  return { envelope: ok(data, hint), exitKind: 'ok' };
}

module.exports = { handleAssertReference };
