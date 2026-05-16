'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');
const {
  handleRenameStep, handleDeleteStep, handleEditValue, handleEditAssertionText,
} = require('../../../tools/recorder/src/session-handlers');
const { applyEdits } = require('../../../tools/recorder/src/reconcile/apply-edits');

describe('edit affordances end-to-end (sidecar bundle → reconcile)', () => {
  let projectRoot;
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-e2e-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator'));
  });
  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  test('handlers persist a canonical edits.jsonl the AI reconcile engine consumes', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'login_flow' });
    store.init({ mode: 'platform-aware', scenario_id: 'login_flow' });

    store.appendEvent({ step_id: 'type_email', kind: 'type', value: 'usr@acme', field_label: 'Email' });
    store.appendEvent({ step_id: 'tap_skip', kind: 'tap', target: 'Skip' });
    store.appendEvent({ step_id: 'tap_submit', kind: 'tap', target: 'Submit' });
    store.appendAssertion({ id: 'a1', anchor_step_id: 'tap_submit', nl_text: 'dshbd shown', screenshot: 'screenshots/assert_a1.png', captured_at: '2026-05-16T09:00:00.000Z' });

    const broadcast = () => {};
    handleEditValue({ store, broadcast, msg: { step_id: 'type_email', new_value: 'user@acme.io' } });
    handleRenameStep({ store, broadcast, msg: { step_id: 'tap_submit', new_display_name: 'Tap the Submit button' } });
    handleEditAssertionText({ store, broadcast, msg: { assertion_id: 'a1', new_nl_text: 'Dashboard is shown' } });
    handleDeleteStep({ store, broadcast, msg: { step_id: 'tap_skip', assertion_policy: 'none' } });

    const root = path.join(projectRoot, 'mobile-automator/.recorder/login_flow');
    const events = fs.readFileSync(path.join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const edits = fs.readFileSync(path.join(root, 'edits.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const assertions = JSON.parse(fs.readFileSync(path.join(root, 'assertions.json'), 'utf8'));

    expect(edits.map((e) => e.op)).toEqual(['edit-value', 'rename', 'edit-assertion-text', 'delete']);
    edits.forEach((e) => expect(typeof e.ts).toBe('string'));

    const eff = applyEdits({ events, assertions, edits });
    expect(eff.steps.map((s) => s.step_id)).toEqual(['type_email', 'tap_submit']);
    expect(eff.steps.find((s) => s.step_id === 'type_email').value).toBe('user@acme.io');
    expect(eff.steps.find((s) => s.step_id === 'tap_submit').display_name).toBe('Tap the Submit button');
    expect(eff.assertions[0].nl_text).toBe('Dashboard is shown');
    expect(eff.assertions[0].anchor_step_id).toBe('tap_submit');
  });

  test('delete + reanchor end-to-end moves the assertion to the previous surviving step', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware', scenario_id: 's' });
    store.appendEvent({ step_id: 'tap_a', kind: 'tap', target: 'A' });
    store.appendEvent({ step_id: 'tap_b', kind: 'tap', target: 'B' });
    store.appendEvent({ step_id: 'tap_c', kind: 'tap', target: 'C' });
    store.appendAssertion({ id: 'a1', anchor_step_id: 'tap_b', nl_text: 'x', screenshot: 'screenshots/assert_a1.png', captured_at: '2026-05-16T09:00:00.000Z' });

    handleDeleteStep({ store, broadcast: () => {}, msg: { step_id: 'tap_b', assertion_policy: 'reanchor' } });

    const root = path.join(projectRoot, 'mobile-automator/.recorder/s');
    const events = fs.readFileSync(path.join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const edits = fs.readFileSync(path.join(root, 'edits.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const assertions = JSON.parse(fs.readFileSync(path.join(root, 'assertions.json'), 'utf8'));
    const eff = applyEdits({ events, assertions, edits });

    expect(eff.steps.map((s) => s.step_id)).toEqual(['tap_a', 'tap_c']);
    expect(eff.assertions[0].anchor_step_id).toBe('tap_a');
  });
});
