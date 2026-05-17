'use strict';

const fs = require('fs');
const path = require('path');

const SKILL = path.resolve(__dirname, '../../templates/mobile-automator-recorder/agnostic/SKILL.md');
const AGNOSTIC_PLACEHOLDERS = ['project_name', 'business_domain', 'business_critical_paths', 'loading_indicators', 'protected_directories', 'additional_resources'];

describe('agnostic recorder SKILL.md', () => {
  test('exists', () => { expect(fs.existsSync(SKILL)).toBe(true); });

  test('uses only agnostic-mode placeholders', () => {
    const txt = fs.readFileSync(SKILL, 'utf8');
    const used = [...txt.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
    for (const p of used) expect(AGNOSTIC_PLACEHOLDERS).toContain(p);
  });

  test('references platform-resolutions.md and the four semantic actions', () => {
    const txt = fs.readFileSync(SKILL, 'utf8');
    expect(txt).toMatch(/platform-resolutions\.md/);
    for (const a of ['press_back', 'dismiss_keyboard', 'grant_permission', 'deny_permission']) {
      expect(txt).toContain(a);
    }
  });

  test('documents the mark-as-semantic reconcile op', () => {
    expect(fs.readFileSync(SKILL, 'utf8')).toContain('mark-as-semantic');
  });
});
