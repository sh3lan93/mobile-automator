'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { buildProgram } = require('../../../tools/recorder/src/index');

describe('recorder/index.js bootstrap', () => {
  const entry = path.resolve(__dirname, '../../../tools/recorder/src/index.js');

  test('prints --help and exits 0', () => {
    const out = execFileSync('node', [entry, '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/--scenario/);
    expect(out).toMatch(/--mode/);
    expect(out).toMatch(/--no-gui/);
    expect(out).toMatch(/--preconditions-modal/);
    expect(out).toMatch(/--platform/);
  });

  test('exits non-zero with usage error when --scenario missing', () => {
    expect(() => execFileSync('node', [entry], { stdio: 'pipe' })).toThrow();
  });

  describe('--platform option', () => {
    function parse(argv) {
      const program = buildProgram();
      // commander's .exitOverride() turns process.exit into a thrown CommanderError
      program.exitOverride();
      program.parse(['node', 'index.js', ...argv]);
      return program.opts();
    }

    test('defaults to android when not provided', () => {
      const opts = parse(['--scenario', 's']);
      expect(opts.platform).toBe('android');
    });

    test('accepts --platform=ios', () => {
      const opts = parse(['--scenario', 's', '--platform', 'ios']);
      expect(opts.platform).toBe('ios');
    });

    test('accepts --platform=android explicitly', () => {
      const opts = parse(['--scenario', 's', '--platform', 'android']);
      expect(opts.platform).toBe('android');
    });

    test('rejects values other than android or ios', () => {
      expect(() => parse(['--scenario', 's', '--platform', 'bogus'])).toThrow(/platform/i);
    });
  });
});
