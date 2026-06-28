'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { emitGuide } = require('../../../src/guide/emitter');

function tmpProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-gen-'));
  if (config) {
    const dir = path.join(root, 'mobile-automator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }
  return root;
}

const MCP_TOOL = /\bmobile_[a-z_]+/;

describe('guide emitter — real generate content', () => {
  describe('aware mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('generate', { mode: 'platform-aware' });
    });

    it('preserves the Mobile QA Recorder persona', () => {
      expect(out).toMatch(/Mobile QA Recorder/);
    });

    it('preserves the Observer Traits (Regression Spotter / State Detective / Platform-Aware)', () => {
      expect(out).toMatch(/Observer Traits/);
      expect(out).toMatch(/Regression Spotter/);
      expect(out).toMatch(/State Detective/);
      expect(out).toMatch(/Platform-Aware/);
    });

    it('uses the mauto verb vocabulary', () => {
      expect(out).toMatch(/mauto elements/);
      expect(out).toMatch(/mauto tap/);
      expect(out).toMatch(/mauto type/);
      expect(out).toMatch(/mauto swipe/);
      expect(out).toMatch(/mauto press/);
      expect(out).toMatch(/mauto screenshot/);
      expect(out).toMatch(/mauto devices/);
    });

    it('directs scenario assembly via `mauto schema scenario`', () => {
      expect(out).toMatch(/mauto schema scenario/);
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
      const withCfg = emitGuide('generate', { mode: 'platform-aware', projectRoot: root });
      expect(withCfg).toMatch(/PaymentsApp/);
      expect(withCfg).toMatch(/com\.acme\.payments/);
      expect(withCfg).not.toContain('{{');
    });
  });

  describe('agnostic mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('generate', { mode: 'platform-agnostic' });
    });

    it('preserves the QA Recorder persona', () => {
      expect(out).toMatch(/QA Recorder/);
    });

    it('preserves Observer Traits (Regression Spotter / State Detective)', () => {
      expect(out).toMatch(/Observer Traits/);
      expect(out).toMatch(/Regression Spotter/);
      expect(out).toMatch(/State Detective/);
    });

    it('uses the mauto verb vocabulary', () => {
      expect(out).toMatch(/mauto elements/);
      expect(out).toMatch(/mauto tap/);
      expect(out).toMatch(/mauto schema scenario/);
    });

    it('names the four semantic actions', () => {
      for (const act of ['press_back', 'dismiss_keyboard', 'grant_permission', 'deny_permission']) {
        expect(out).toContain(act);
      }
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
