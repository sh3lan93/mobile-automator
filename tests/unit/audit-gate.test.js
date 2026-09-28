const {
  ghsaOf, collectAdvisories, validateAllowlist, evaluate, runAudit, main,
} = require('../../scripts/audit-gate');

const SHARP_A = 'GHSA-f88m-g3jw-g9cj';
const SHARP_B = 'GHSA-rgj7-g3m4-5g8c';

function advisory(ghsa, severity, name = 'sharp') {
  return { source: 1, name, dependency: name, title: `${name} vuln`,
    url: `https://github.com/advisories/${ghsa}`, severity };
}

// Mirrors npm audit v2 JSON: root advisories are objects in `via`;
// packages that merely depend on a vulnerable one carry string `via`s.
function report(...advisories) {
  const vulnerabilities = {};
  for (const a of advisories) {
    const v = vulnerabilities[a.name] ||= { name: a.name, severity: a.severity, via: [] };
    v.via.push(a);
  }
  vulnerabilities['@mobilenext/mobile-mcp'] = { name: '@mobilenext/mobile-mcp', severity: 'high', via: ['mobilewright'] };
  return { auditReportVersion: 2, vulnerabilities };
}

const entry = (ghsa, over = {}) => ({
  ghsa, package: 'sharp', reason: 'processes device-produced screenshots only',
  issue: 999, expires: '2026-12-27', ...over,
});

describe('ghsaOf', () => {
  test('extracts the id from an advisory url', () => {
    expect(ghsaOf(`https://github.com/advisories/${SHARP_A}`)).toBe(SHARP_A);
  });
  test('returns null when there is no GHSA id', () => {
    expect(ghsaOf('https://example.com/x')).toBeNull();
    expect(ghsaOf(undefined)).toBeNull();
  });
});

describe('collectAdvisories', () => {
  test('collects object vias and ignores inherited string vias', () => {
    const ids = collectAdvisories(report(advisory(SHARP_A, 'high'))).map((a) => a.id);
    expect(ids).toEqual([SHARP_A]);
  });
  test('de-duplicates an advisory reported under several packages', () => {
    const r = report(advisory(SHARP_A, 'high'));
    r.vulnerabilities.other = { name: 'other', severity: 'high', via: [advisory(SHARP_A, 'high')] };
    expect(collectAdvisories(r)).toHaveLength(1);
  });
  test('throws on an npm error payload, using the top-level message npm actually sends', () => {
    // Real npm (10 and 11) puts the failure reason in the top-level `message`
    // field and leaves error.summary/detail blank when the registry itself is
    // unreachable.
    const report = {
      message: 'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
      error: { summary: '', detail: '' },
    };
    expect(() => collectAdvisories(report)).toThrow(/ECONNREFUSED/);
  });
  test('throws on the legacy {error:{code,summary}} shape', () => {
    expect(() => collectAdvisories({ error: { code: 'ENOTFOUND', summary: '', detail: '' } })).toThrow(/ENOTFOUND/);
  });
  test('throws when vulnerabilities is missing', () => {
    expect(() => collectAdvisories({})).toThrow(/vulnerabilities/);
  });
});

describe('validateAllowlist', () => {
  test('accepts well-formed entries', () => {
    expect(validateAllowlist([entry(SHARP_A)])).toHaveLength(1);
  });
  test.each([
    ['missing reason', entry(SHARP_A, { reason: '' })],
    ['bad ghsa', entry('CVE-2026-1', {})],
    ['non-integer issue', entry(SHARP_A, { issue: '999' })],
    ['non-ISO expiry', entry(SHARP_A, { expires: '12/27/2026' })],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateAllowlist([bad])).toThrow();
  });
  test('rejects a non-array', () => {
    expect(() => validateAllowlist({})).toThrow(/array/);
  });
  test('rejects duplicate ghsa ids', () => {
    expect(() => validateAllowlist([entry(SHARP_A), entry(SHARP_A)])).toThrow(/duplicate/i);
  });
});

describe('evaluate', () => {
  const today = '2026-09-28';

  test('passes when there are no blocking advisories', () => {
    const r = evaluate(report(advisory('GHSA-aaaa-bbbb-cccc', 'moderate', 'qs')), [], today);
    expect(r.ok).toBe(true);
  });
  test('fails on an unaccepted high advisory', () => {
    const r = evaluate(report(advisory('GHSA-aaaa-bbbb-cccc', 'high', 'ws')), [], today);
    expect(r.ok).toBe(false);
    expect(r.unaccepted.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });
  test('fails on an unaccepted critical advisory', () => {
    expect(evaluate(report(advisory('GHSA-aaaa-bbbb-cccc', 'critical', 'ws')), [], today).ok).toBe(false);
  });
  test('passes when every blocking advisory is accepted and unexpired', () => {
    const r = evaluate(report(advisory(SHARP_A, 'high'), advisory(SHARP_B, 'high')),
      [entry(SHARP_A), entry(SHARP_B)], today);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(2);
  });
  test('an entry expiring today is still valid', () => {
    expect(evaluate(report(advisory(SHARP_A, 'high')), [entry(SHARP_A, { expires: today })], today).ok).toBe(true);
  });
  test('fails on an expired acceptance', () => {
    const r = evaluate(report(advisory(SHARP_A, 'high')), [entry(SHARP_A, { expires: '2026-09-27' })], today);
    expect(r.ok).toBe(false);
    expect(r.expired.map((a) => a.id)).toEqual([SHARP_A]);
  });
  test('fails on a stale entry whose advisory is no longer reported', () => {
    const r = evaluate(report(), [entry(SHARP_A)], today);
    expect(r.ok).toBe(false);
    expect(r.stale.map((e) => e.ghsa)).toEqual([SHARP_A]);
  });
  test('an entry whose advisory dropped below high is stale', () => {
    const r = evaluate(report(advisory(SHARP_A, 'moderate')), [entry(SHARP_A)], today);
    expect(r.stale.map((e) => e.ghsa)).toEqual([SHARP_A]);
  });
});

describe('runAudit', () => {
  const spawnReturning = (stdout, extra = {}) => jest.fn(() => ({ status: 1, stdout, stderr: '', ...extra }));

  test('parses stdout even though npm audit exits 1 when vulnerabilities exist', () => {
    const spawn = spawnReturning(JSON.stringify(report()));
    expect(runAudit(spawn).auditReportVersion).toBe(2);
    expect(spawn).toHaveBeenCalledWith('npm', ['audit', '--omit=dev', '--json'], expect.any(Object));
  });
  test('throws when npm could not be spawned', () => {
    expect(() => runAudit(spawnReturning('', { error: new Error('ENOENT') }))).toThrow(/ENOENT/);
  });
  test('throws on empty stdout', () => {
    expect(() => runAudit(spawnReturning(''))).toThrow(/no output/i);
  });
  test('throws on non-JSON stdout', () => {
    expect(() => runAudit(spawnReturning('npm ERR! network'))).toThrow(/JSON/);
  });
});

describe('main', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const writeList = (list) => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-gate-')), 'allow.json');
    fs.writeFileSync(p, JSON.stringify(list));
    return p;
  };
  const spawnOf = (r) => () => ({ status: 1, stdout: JSON.stringify(r), stderr: '' });
  const log = () => {};
  const logSpy = () => {
    const lines = [];
    return { fn: (msg) => lines.push(msg), lines };
  };

  test('exits 0 when clean', () => {
    expect(main({ spawn: spawnOf(report()), allowlistPath: writeList([]), today: '2026-09-28', log })).toBe(0);
  });
  test('exits 1 on a policy failure', () => {
    const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'high', 'ws'));
    expect(main({ spawn: spawnOf(r), allowlistPath: writeList([]), today: '2026-09-28', log })).toBe(1);
  });
  test('exits 2 (fail closed) when the registry is unreachable, and logs the reason with a re-run hint', () => {
    const spawn = spawnOf({
      message: 'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
      error: { summary: '', detail: '' },
    });
    const spy = logSpy();
    expect(main({ spawn, allowlistPath: writeList([]), today: '2026-09-28', log: spy.fn })).toBe(2);
    expect(spy.lines.some((l) => l.includes('ECONNREFUSED') && l.includes('re-run'))).toBe(true);
  });
  test('exits 2 on a malformed allowlist', () => {
    const p = writeList([{ ghsa: SHARP_A }]);
    expect(main({ spawn: spawnOf(report()), allowlistPath: p, today: '2026-09-28', log })).toBe(2);
  });
});

describe('the checked-in allowlist', () => {
  test('is valid', () => {
    expect(() => validateAllowlist(require('../../scripts/audit-allowlist.json'))).not.toThrow();
  });
});
