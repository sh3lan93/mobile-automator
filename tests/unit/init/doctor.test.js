'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { HOSTS } = require('../../../src/init/host-plan');
const { doctorReport } = require('../../../src/init/doctor');
const { ok } = require('../../../src/output/envelope');

const entry = (agent, { installed = true, stale = false } = {}) => ({
  agent,
  installed,
  stale,
  files: [{ path: `/p/${agent}/f`, status: stale ? 'outdated' : installed ? 'current' : 'missing' }],
  mcp: null,
});
const report = (overrides) => HOSTS.map((a) => entry(a, overrides[a] || { installed: false }));

describe('doctorReport (#144)', () => {
  test('nothing installed → not initialised, hint names init', () => {
    const { data, hint } = doctorReport({ projectRoot: '/p', inspect: () => report({}) });
    expect(data).toEqual({ initialised: false, hosts: [], stale: [] });
    expect(hint).toBe(
      `no host integration found — run \`mauto init --agent <host>\` (${HOSTS.join(' | ')} | all)`
    );
  });

  test('all installed hosts current → no hint', () => {
    const { data, hint } = doctorReport({
      projectRoot: '/p',
      inspect: () => report({ claude: {}, cursor: {} }),
    });
    expect(data.initialised).toBe(true);
    expect(data.hosts.map((h) => h.agent)).toEqual(['claude', 'cursor']);
    expect(data.stale).toEqual([]);
    expect(hint).toBeNull();
    // Only {agent, stale, files, mcp} per host.
    expect(Object.keys(data.hosts[0]).sort()).toEqual(['agent', 'files', 'mcp', 'stale']);
  });

  test('one stale host → hint names its init command', () => {
    const { data, hint } = doctorReport({
      projectRoot: '/p',
      inspect: () => report({ claude: { stale: true }, gemini: {} }),
    });
    expect(data.stale).toEqual(['claude']);
    expect(hint).toBe('run `mauto init --agent claude`');
  });

  test('two stale hosts → one command per host, joined with "; "', () => {
    const { data, hint } = doctorReport({
      projectRoot: '/p',
      inspect: () => report({ copilot: { stale: true }, claude: { stale: true } }),
    });
    expect(data.stale).toEqual(['claude', 'copilot']);
    expect(hint).toBe('run `mauto init --agent claude`; run `mauto init --agent copilot`');
  });

  test('every host stale → --agent all', () => {
    const all = Object.fromEntries(HOSTS.map((a) => [a, { stale: true }]));
    const { data, hint } = doctorReport({ projectRoot: '/p', inspect: () => report(all) });
    expect(data.stale).toEqual(HOSTS);
    expect(hint).toBe('run `mauto init --agent all`');
  });

  test('inspects the given projectRoot', () => {
    const inspect = jest.fn(() => report({}));
    doctorReport({ projectRoot: '/some/root', inspect });
    expect(inspect).toHaveBeenCalledWith('/some/root');
  });

  test('inspect failure propagates (classified by the envelope boundary)', () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    expect(() =>
      doctorReport({
        projectRoot: '/p',
        inspect: () => {
          throw err;
        },
      })
    ).toThrow(err);
  });

  test('a real empty dir reports nothing installed', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-doctor-'));
    const { data } = doctorReport({ projectRoot, inspect: require('../../../src/init/host-plan').inspectHosts });
    expect(data).toEqual({ initialised: false, hosts: [], stale: [] });
  });

  test('the CLI wraps {data, hint} into the ok envelope', () => {
    const { data, hint } = doctorReport({
      projectRoot: '/p',
      inspect: () => report({ claude: { stale: true } }),
    });
    const env = ok(data, hint);
    expect(env.ok).toBe(true);
    expect(Object.keys(env.data).sort()).toEqual(['hosts', 'initialised', 'stale']);
    expect(env.hint).toContain('mauto init --agent claude');
  });
});

describe('doctor --human rendering (via the shared envelope renderer)', () => {
  const { render } = require('../../../src/output/envelope');

  test('renders the data keys and the hint', () => {
    const { data, hint } = doctorReport({
      projectRoot: '/p',
      inspect: () => report({ claude: { stale: true } }),
    });
    const out = render(ok(data, hint), { human: true });
    expect(out).toContain('ok: initialised, hosts, stale');
    expect(out).toContain('hint: run `mauto init --agent claude`');
  });
});
