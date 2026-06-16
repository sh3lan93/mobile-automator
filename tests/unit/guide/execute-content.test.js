'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { emitGuide } = require('../../../src/guide/emitter');

function tmpProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-exec-'));
  if (config) {
    const dir = path.join(root, 'mobile-automator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }
  return root;
}

const MCP_TOOL = /\bmobile_[a-z_]+/;

describe('guide emitter — real execute content', () => {
  describe('aware mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('execute', { mode: 'platform-aware' });
    });

    it('preserves the Mobile QA Executor persona', () => {
      expect(out).toMatch(/Mobile QA Executor/);
    });

    it('preserves the three Observer behaviors', () => {
      expect(out).toMatch(/Regression Spotter/);
      expect(out).toMatch(/Flakiness Detector/);
      expect(out).toMatch(/State Detective/);
    });

    it('uses the mauto verb vocabulary', () => {
      expect(out).toMatch(/mauto elements/);
      expect(out).toMatch(/mauto tap/);
      expect(out).toMatch(/mauto type/);
      expect(out).toMatch(/mauto swipe/);
      expect(out).toMatch(/mauto press/);
      expect(out).toMatch(/mauto screenshot/);
      expect(out).toMatch(/mauto devices/);
      expect(out).toMatch(/mauto assert/);
    });

    it('uses mauto result bookkeeping verbs', () => {
      expect(out).toMatch(/mauto result add-step/);
      expect(out).toMatch(/mauto result finalize/);
    });

    it('obtains schemas via mauto schema (scenario + result)', () => {
      expect(out).toMatch(/mauto schema scenario/);
      expect(out).toMatch(/mauto schema result/);
    });

    it('preserves the 27-type assertion taxonomy hallmarks', () => {
      expect(out).toMatch(/element_exists/);
      expect(out).toMatch(/screenshot_match/);
      expect(out).toMatch(/element_state/);
      expect(out).toMatch(/value_matches_variable/);
      expect(out).toMatch(/permission_dialog_shown/);
    });

    it('describes the mechanical (CLI-decided) vs needs-agent (visual) split', () => {
      expect(out).toMatch(/Tier 1/);
      expect(out).toMatch(/Tier 2/);
      // mechanical assertions go through `mauto assert` and return pass/fail JSON
      expect(out).toMatch(/mauto assert/);
      // Tier-2 visual checks are judged by the agent from a screenshot
      expect(out).toMatch(/needs_agent|judge|visual analysis|the agent/i);
    });

    it('references capture_to / variable_name as literal backticked names, not placeholders', () => {
      expect(out).toMatch(/`capture_to`/);
      expect(out).toMatch(/`variable_name`/);
    });

    it('contains no leaked mobile_* tool name', () => {
      expect(out).not.toMatch(MCP_TOOL);
    });

    it('contains no surviving {{ placeholder token (interpolation + fallback)', () => {
      expect(out).not.toContain('{{');
    });

    it('contains no leftover Gemini framing or ask_user tool', () => {
      expect(out).not.toMatch(/Gemini/);
      expect(out).not.toMatch(/ask_user/);
      expect(out).not.toMatch(/\.gemini\//);
      expect(out).not.toMatch(/GEMINI\.md/);
    });

    it('interpolates config values when a project config exists', () => {
      const root = tmpProject({
        mode: 'platform-aware',
        knowledge: { project_name: 'PaymentsApp' },
        app: { android_package: 'com.acme.payments' },
      });
      const withCfg = emitGuide('execute', { mode: 'platform-aware', projectRoot: root });
      expect(withCfg).toMatch(/PaymentsApp/);
      expect(withCfg).toMatch(/com\.acme\.payments/);
      expect(withCfg).not.toContain('{{');
    });
  });

  describe('agnostic mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('execute', { mode: 'platform-agnostic' });
    });

    it('preserves the QA Executor persona', () => {
      expect(out).toMatch(/QA Executor/);
    });

    it('preserves the Observer behaviors (Regression Spotter / Flakiness / State Detective)', () => {
      expect(out).toMatch(/Regression Spotter/);
      expect(out).toMatch(/Flakiness Detector/);
      expect(out).toMatch(/State Detective/);
    });

    it('uses the mauto verb vocabulary', () => {
      expect(out).toMatch(/mauto elements/);
      expect(out).toMatch(/mauto screenshot/);
      expect(out).toMatch(/mauto assert/);
      expect(out).toMatch(/mauto result/);
    });

    it('obtains schemas via mauto schema (scenario + result)', () => {
      expect(out).toMatch(/mauto schema scenario/);
      expect(out).toMatch(/mauto schema result/);
    });

    it('names the four semantic actions', () => {
      for (const act of ['press_back', 'dismiss_keyboard', 'grant_permission', 'deny_permission']) {
        expect(out).toContain(act);
      }
    });

    it('preserves the assertion-taxonomy hallmarks', () => {
      expect(out).toMatch(/element_exists/);
      expect(out).toMatch(/screenshot_match/);
    });

    it('describes the mechanical vs needs-agent split', () => {
      expect(out).toMatch(/Tier 1/);
      expect(out).toMatch(/Tier 2/);
      expect(out).toMatch(/mauto assert/);
    });

    it('references capture_to / variable_name as literal backticked names', () => {
      expect(out).toMatch(/`capture_to`/);
      expect(out).toMatch(/`variable_name`/);
    });

    it('names no OS / OS-specific tooling', () => {
      const FORBIDDEN = [
        /\bAndroid\b/i, /\biOS\b/i, /\badb\b/i, /\bxcrun\b/i, /\bresource[ -]?id\b/i,
        /\bFlutter\b/i, /\bReact[ -]?Native\b/i, /\bKotlin\b/i, /\bCompose\b/i,
        /\bxcode\b/i, /\bsimulator\b/i, /\bemulator\b/i,
      ];
      const violations = FORBIDDEN.filter((p) => p.test(out)).map((p) => p.toString());
      expect(violations).toEqual([]);
    });

    it('contains no leaked mobile_* tool name', () => {
      expect(out).not.toMatch(MCP_TOOL);
    });

    it('contains no surviving {{ placeholder token', () => {
      expect(out).not.toContain('{{');
    });

    it('contains no leftover Gemini framing', () => {
      expect(out).not.toMatch(/Gemini/);
      expect(out).not.toMatch(/ask_user/);
      expect(out).not.toMatch(/\.gemini\//);
    });
  });
});
