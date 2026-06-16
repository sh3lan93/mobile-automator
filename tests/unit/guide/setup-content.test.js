'use strict';

const { emitGuide } = require('../../../src/guide/emitter');

const MCP_TOOL = /\bmobile_[a-z_]+/;

describe('guide emitter — real setup content', () => {
  describe('aware mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('setup', { mode: 'platform-aware' });
    });

    it('frames the guide as project analysis that completes the already-scaffolded workspace', () => {
      expect(out).toMatch(/analy[sz]e|analysis|inspect/i);
      expect(out).toMatch(/mauto setup/);
    });

    it('persists findings via `mauto config set <key> <value>`', () => {
      expect(out).toMatch(/mauto config set/);
    });

    it('covers the key analysis findings (project name, package, knowledge fields)', () => {
      expect(out).toMatch(/project_name/);
      expect(out).toMatch(/android_package|ios_bundle_id|app_package/);
      expect(out).toMatch(/loading_indicators/);
      expect(out).toMatch(/protected_directories/);
      expect(out).toMatch(/business_domain/);
    });

    it('covers aware-only findings (architecture / platform / build)', () => {
      expect(out).toMatch(/architecture/);
      expect(out).toMatch(/platform_details/);
      expect(out).toMatch(/build_system/);
      expect(out).toMatch(/build_command/);
    });

    it('describes how to detect platform from project files', () => {
      expect(out).toMatch(/pubspec\.yaml|build\.gradle|package\.json|xcodeproj/);
    });

    it('contains no leaked mobile_* tool name', () => {
      expect(out).not.toMatch(MCP_TOOL);
    });

    it('contains no surviving {{ placeholder token', () => {
      expect(out).not.toContain('{{');
    });

    it('contains no leftover Gemini framing or ask_user tool', () => {
      expect(out).not.toMatch(/Gemini/);
      expect(out).not.toMatch(/ask_user/);
      expect(out).not.toMatch(/\.gemini\//);
      expect(out).not.toMatch(/GEMINI\.md/);
    });
  });

  describe('agnostic mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('setup', { mode: 'platform-agnostic' });
    });

    it('persists findings via `mauto config set <key> <value>`', () => {
      expect(out).toMatch(/mauto config set/);
    });

    it('covers the agnostic findings (project name, domain, critical paths, loading, protected dirs)', () => {
      expect(out).toMatch(/project_name/);
      expect(out).toMatch(/business_domain/);
      expect(out).toMatch(/business_critical_paths/);
      expect(out).toMatch(/loading_indicators/);
      expect(out).toMatch(/protected_directories/);
    });

    it('frames loading indicators as plain-English / semantic descriptions', () => {
      expect(out).toMatch(/semantic|plain English|plain-English/i);
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
