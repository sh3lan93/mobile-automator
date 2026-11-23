'use strict';

// #369: the one version comparison in the repo. The version gate and
// scripts/sync-branch.js both read it, so the cases here are the whole
// ordering contract (SemVer 2.0 precedence, build metadata refused).
const { parseVersion, compareVersions, compareCores, highestRelease } = require('../../scripts/version-order');

const sign = (n) => Math.sign(n);

describe('parseVersion', () => {
  test('splits the core and the prerelease identifiers', () => {
    expect(parseVersion('0.40.14')).toEqual({ core: [0, 40, 14], prerelease: [] });
    expect(parseVersion('0.41.0-rc.10')).toEqual({ core: [0, 41, 0], prerelease: ['rc', '10'] });
  });

  test.each(['v1.2.3', '1.2', 'abc', '', '1.2.3-', '1.2.3-rc..1', '1.2.3+build', '1.2.3-rc.1+b', ' 1.2.3', undefined, null, 123])(
    'returns null for %p',
    (v) => {
      expect(parseVersion(v)).toBeNull();
    },
  );
});

describe('compareVersions', () => {
  test.each([
    ['0.40.13', '0.40.14'],
    ['0.40.9', '0.40.10'],
    ['0.41.0-rc.1', '0.41.0'],
    ['0.41.0-rc.2', '0.41.0-rc.10'],
    ['0.40.19', '0.41.0-rc.0'],
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-beta'],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta'],
    ['1.0.0-beta.2', '1.0.0-beta.11'],
    ['1.0.0-rc.1', '1.0.0'],
    ['0.9.99', '1.0.0'],
  ])('%s < %s', (lo, hi) => {
    expect(sign(compareVersions(lo, hi))).toBe(-1);
    expect(sign(compareVersions(hi, lo))).toBe(1);
  });

  test('equal versions compare 0', () => {
    expect(compareVersions('0.40.14', '0.40.14')).toBe(0);
    expect(compareVersions('0.41.0-rc.3', '0.41.0-rc.3')).toBe(0);
  });

  test('throws on unparseable input, naming it', () => {
    expect(() => compareVersions('v1.2.3', '1.2.3')).toThrow(/v1\.2\.3/);
    expect(() => compareVersions('1.2.3', 'abc')).toThrow(/abc/);
  });
});

describe('compareCores', () => {
  test('compares numerically, most significant first', () => {
    expect(sign(compareCores([0, 40, 9], [0, 40, 10]))).toBe(-1);
    expect(sign(compareCores([1, 0, 0], [0, 99, 99]))).toBe(1);
    expect(compareCores([0, 41, 0], [0, 41, 0])).toBe(0);
  });
});

describe('highestRelease', () => {
  test('no release tags is null', () => {
    expect(highestRelease([])).toBeNull();
    expect(highestRelease(['junk', '1.2.3', 'v1.2', 'v1.2.3+b'])).toBeNull();
  });

  test('ignores tags that are not v + a parseable version', () => {
    expect(highestRelease(['v0.40.1', 'junk', 'release-9.9.9', '9.9.9', 'v9.9'])).toEqual({
      tag: 'v0.40.1',
      version: '0.40.1',
      parsed: { core: [0, 40, 1], prerelease: [] },
    });
  });

  test('orders numerically, not by string or list position', () => {
    expect(highestRelease(['v0.40.10', 'v0.40.9', 'v0.40.2']).tag).toBe('v0.40.10');
    expect(highestRelease(['v0.40.2', 'v0.40.9', 'v0.40.10']).tag).toBe('v0.40.10');
  });

  test('a release sorts above its own rc, an rc above the previous core', () => {
    expect(highestRelease(['v0.41.0', 'v0.41.0-rc.3']).tag).toBe('v0.41.0');
    expect(highestRelease(['v0.41.0-rc.3', 'v0.41.0']).tag).toBe('v0.41.0');
    expect(highestRelease(['v0.40.19', 'v0.41.0-rc.1'])).toEqual({
      tag: 'v0.41.0-rc.1',
      version: '0.41.0-rc.1',
      parsed: { core: [0, 41, 0], prerelease: ['rc', '1'] },
    });
  });

  test('rc counters compare numerically: rc.2 < rc.10', () => {
    expect(highestRelease(['v0.41.0-rc.10', 'v0.41.0-rc.2']).tag).toBe('v0.41.0-rc.10');
    expect(highestRelease(['v0.41.0-rc.2', 'v0.41.0-rc.10']).tag).toBe('v0.41.0-rc.10');
  });
});
