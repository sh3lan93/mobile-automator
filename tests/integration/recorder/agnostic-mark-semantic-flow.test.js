'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runScriptedSession } = require('../../../tools/recorder/src/lifecycle');
const { handleMarkAsSemantic } = require('../../../tools/recorder/src/session-handlers');
const { applyEdits } = require('../../../tools/recorder/src/reconcile/apply-edits');
const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');

describe('agnostic recording → mark-as-semantic → reconcile', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-agn-e2e-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'));
    fs.writeFileSync(path.join(root, 'mobile-automator/config.json'),
      JSON.stringify({ mode: 'platform-agnostic', project_name: 'demo' }));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('semantic actions are emitted and a tap can be marked dismiss_keyboard', () => {
    const script = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../fixtures/recorder/scripted-session-agnostic.json'), 'utf8'));
    return runScriptedSession({ projectRoot: root, scenarioId: 's', script }).then(() => {
      const dir = path.join(root, 'mobile-automator/.recorder/s');
      const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain('grant_permission');
      expect(kinds).toContain('press_back');
      expect(kinds).not.toContain('press_button');

      const tapStep = events.find((e) => e.kind === 'tap');
      expect(tapStep).toBeTruthy();
      const store = new ArtifactsStore({ projectRoot: root, scenarioId: 's' });
      handleMarkAsSemantic({
        store, broadcast: () => {},
        msg: { step_id: tapStep.step_id, semantic_action: 'dismiss_keyboard' },
      });

      const edits = fs.readFileSync(path.join(dir, 'edits.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
      const eff = applyEdits({ events, assertions: [], edits });
      const marked = eff.steps.find((s) => s.step_id === tapStep.step_id);
      expect(marked.kind).toBe('dismiss_keyboard');
      expect(eff.steps.some((s) => s.kind === 'grant_permission')).toBe(true);
      expect(eff.steps.some((s) => s.kind === 'press_back')).toBe(true);
    });
  });
});
