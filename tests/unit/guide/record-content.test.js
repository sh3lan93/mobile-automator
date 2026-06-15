'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { emitGuide } = require('../../../src/guide/emitter');

function tmpProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-rec-'));
  if (config) {
    const dir = path.join(root, 'mobile-automator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }
  return root;
}

const MCP_TOOL = /\bmobile_[a-z_]+/;

describe('guide emitter — real record content', () => {
  describe('aware mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('record', { mode: 'platform-aware' });
    });

    it('preserves the Synthesizer persona / synthesis-not-capture framing', () => {
      expect(out).toMatch(/Synthesizer/);
      expect(out).toMatch(/synthesis, not capture/i);
    });

    it('describes the recorder artifact bundle structure', () => {
      expect(out).toMatch(/artifact bundle/i);
      expect(out).toMatch(/events\.jsonl/);
      expect(out).toMatch(/edits\.jsonl/);
      expect(out).toMatch(/assertions\.json/);
      expect(out).toMatch(/metadata\.json/);
      expect(out).toMatch(/hierarchy/);
    });

    it('reads the bundle via `mauto record-bundle`', () => {
      expect(out).toMatch(/mauto record-bundle/);
    });

    it('defers to the generator guide for scenario shape', () => {
      expect(out).toMatch(/mauto guide generate/);
    });

    it('validates the synthesized scenario with `mauto validate` against `mauto schema scenario`', () => {
      expect(out).toMatch(/mauto validate/);
      expect(out).toMatch(/mauto schema scenario/);
    });

    it('keeps the synthesis IP: edit reconciliation + assertion classification at save', () => {
      expect(out).toMatch(/Reconcile edits|edit reconciliation|chronological/i);
      expect(out).toMatch(/Classify .*assertions|assertion classification/i);
      expect(out).toMatch(/auto-assertion/i);
    });

    it('contains no leaked mobile_* tool name', () => {
      expect(out).not.toMatch(MCP_TOOL);
    });

    it('contains no surviving {{ placeholder token', () => {
      expect(out).not.toContain('{{');
    });

    it('contains no leftover Gemini framing or .gemini paths', () => {
      expect(out).not.toMatch(/Gemini/);
      expect(out).not.toMatch(/\.gemini\//);
      expect(out).not.toMatch(/GEMINI\.md/);
      expect(out).not.toMatch(/mobile-mcp/i);
    });

    it('interpolates config values when a project config exists', () => {
      const root = tmpProject({
        mode: 'platform-aware',
        knowledge: { project_name: 'PaymentsApp' },
        app: { android_package: 'com.acme.payments' },
      });
      const withCfg = emitGuide('record', { mode: 'platform-aware', projectRoot: root });
      expect(withCfg).toMatch(/PaymentsApp/);
      expect(withCfg).not.toContain('{{');
    });
  });

  describe('agnostic mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('record', { mode: 'platform-agnostic' });
    });

    it('preserves the Synthesizer persona', () => {
      expect(out).toMatch(/Synthesizer/);
    });

    it('describes the artifact bundle and reads it via `mauto record-bundle`', () => {
      expect(out).toMatch(/artifact bundle/i);
      expect(out).toMatch(/mauto record-bundle/);
      expect(out).toMatch(/events\.jsonl/);
    });

    it('defers to the generator guide and validates with mauto validate / mauto schema scenario', () => {
      expect(out).toMatch(/mauto guide generate/);
      expect(out).toMatch(/mauto validate/);
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
      expect(out).not.toMatch(/\.gemini\//);
      expect(out).not.toMatch(/mobile-mcp/i);
    });
  });
});
