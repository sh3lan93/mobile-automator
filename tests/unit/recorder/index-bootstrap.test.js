'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

describe('recorder/index.js bootstrap', () => {
  const entry = path.resolve(__dirname, '../../../tools/recorder/src/index.js');

  test('prints --help and exits 0', () => {
    const out = execFileSync('node', [entry, '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/--scenario/);
    expect(out).toMatch(/--mode/);
    expect(out).toMatch(/--no-gui/);
    expect(out).toMatch(/--preconditions-modal/);
  });

  test('exits non-zero with usage error when --scenario missing', () => {
    expect(() => execFileSync('node', [entry], { stdio: 'pipe' })).toThrow();
  });
});
