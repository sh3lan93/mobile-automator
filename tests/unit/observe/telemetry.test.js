'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const telemetry = require('../../../src/observe/telemetry');
const consent = require('../../../src/observe/consent');
const { EVENT_FIELDS, NEVER_SENDS } = require('../../../src/observe/event');
const { TOKEN_PLACEHOLDER } = require('../../../src/observe/transport');
const { userConfigEnv, grantLocalConsent } = require('../../helpers/user-config');

const ON = { telemetry: { enabled: true } };
const TOKEN = { MAUTO_TELEMETRY_TOKEN: 'phc_real' };
// For anything that reaches the consent record: an injected env without its
// own XDG_CONFIG_HOME would read the developer's real ~/.config.
const tokenEnv = (extra = {}) => userConfigEnv({ ...TOKEN, ...extra });

function workspace(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-tel-'));
  fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
  if (config !== undefined) {
    fs.writeFileSync(
      path.join(root, '.mobile-automator', 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }
  return root;
}

beforeEach(() => telemetry._resetMemo());

describe('telemetry control surface', () => {
  it('is off when nothing has been configured', () => {
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => null }))
      .toEqual({ enabled: false, reason: 'not_configured' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => ({}) }))
      .toEqual({ enabled: false, reason: 'not_configured' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => ({ telemetry: { enabled: false } }) }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('is on only for a literal true in the config, not a truthy string', () => {
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => ON, readConsent: () => true }))
      .toEqual({ enabled: true, reason: 'enabled' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => ({ telemetry: { enabled: 'true' } }), readConsent: () => true }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('keeps a committed opt-in alone off: it needs this user\'s local consent too (#348)', () => {
    // config.json is a file anyone can commit. Without the per-user record,
    // one developer's opt-in would turn telemetry on for every clone.
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => ON }))
      .toEqual({ enabled: false, reason: 'not_consented_locally' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => ON, readConsent: () => 'true' }))
      .toEqual({ enabled: false, reason: 'not_consented_locally' });
  });

  it('lists not_consented_locally right after not_configured', () => {
    const i = telemetry.REASONS.indexOf('not_configured');
    expect(telemetry.REASONS[i + 1]).toBe('not_consented_locally');
  });

  it('checks local consent after the config and before the token', () => {
    // No config opt-in: the config is the first thing missing, so it is named.
    expect(telemetry.resolveTelemetry({ env: TOKEN, loadConfig: () => null, readConsent: () => true }))
      .toEqual({ enabled: false, reason: 'not_configured' });
    // A placeholder build that is also unconsented reports the consent gap.
    expect(telemetry.resolveTelemetry({ env: { MAUTO_TELEMETRY_TOKEN: TOKEN_PLACEHOLDER }, loadConfig: () => ON }))
      .toEqual({ enabled: false, reason: 'not_consented_locally' });
  });

  it('lets MAUTO_TELEMETRY=0 win over an enabled, consented config', () => {
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, MAUTO_TELEMETRY: '0' }, loadConfig: () => ON, readConsent: () => true }))
      .toEqual({ enabled: false, reason: 'kill_switch' });
  });

  it('honours DO_NOT_TRACK', () => {
    for (const v of ['1', 'true', 'TRUE']) {
      expect(telemetry.resolveTelemetry({ env: { ...TOKEN, DO_NOT_TRACK: v }, loadConfig: () => ON, readConsent: () => true }))
        .toEqual({ enabled: false, reason: 'do_not_track' });
    }
    // DO_NOT_TRACK=0 is an explicit "tracking is fine", not a kill switch.
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, DO_NOT_TRACK: '0' }, loadConfig: () => ON, readConsent: () => true }))
      .toEqual({ enabled: true, reason: 'enabled' });
  });

  it('does NOT let MAUTO_TELEMETRY=1 enable collection', () => {
    // An off-switch may live in the environment. An ON-switch may not: it is a
    // way to enable collection on a machine — a CI image, a shared profile, an
    // inherited Dockerfile — whose owner never consented.
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, MAUTO_TELEMETRY: '1' }, loadConfig: () => null }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('stays off when the resolved token is the placeholder', () => {
    // A real token ships now (Task 12 graduation), so this state is no longer
    // reachable via an absent override — only an explicit placeholder proves
    // the mechanism still holds.
    expect(telemetry.resolveTelemetry({ env: { MAUTO_TELEMETRY_TOKEN: TOKEN_PLACEHOLDER }, loadConfig: () => ON, readConsent: () => true }))
      .toEqual({ enabled: false, reason: 'no_token' });
  });

  it('calls its readers lazily: no config read under a kill switch, no consent read while the config is off', () => {
    const loadConfig = jest.fn(() => ON);
    const readConsent = jest.fn(() => true);
    telemetry.resolveTelemetry({ env: { ...TOKEN, MAUTO_TELEMETRY: '0' }, loadConfig, readConsent });
    expect(loadConfig).not.toHaveBeenCalled();
    expect(readConsent).not.toHaveBeenCalled();

    const off = jest.fn(() => ({ telemetry: { enabled: false } }));
    telemetry.resolveTelemetry({ env: TOKEN, loadConfig: off, readConsent });
    expect(off).toHaveBeenCalledTimes(1);
    expect(readConsent).not.toHaveBeenCalled();

    telemetry.resolveTelemetry({ env: TOKEN, loadConfig, readConsent });
    expect(readConsent).toHaveBeenCalledTimes(1);
  });

  it('checks the kill switches before it touches the filesystem at all', () => {
    const root = workspace(ON);
    const env = tokenEnv({ MAUTO_TELEMETRY: '0' });
    grantLocalConsent(root, env);
    // config.json is read through safe-fs (#345), which opens it with openSync;
    // the consent record is read with readFileSync, keyed via realpathSync.
    const spies = ['openSync', 'readFileSync', 'realpathSync', 'statSync', 'lstatSync', 'existsSync']
      .map((m) => jest.spyOn(fs, m));
    const calls = () => spies.reduce((n, s) => n + s.mock.calls.length, 0);
    const before = calls();
    expect(telemetry.decideNow(root, env)).toEqual({ enabled: false, reason: 'kill_switch' });
    expect(telemetry.decideForProject(root, env)).toEqual({ enabled: false, reason: 'kill_switch' });
    expect(calls()).toBe(before);
    spies.forEach((s) => s.mockRestore());
  });

  it('reads config.json once per project root, not once per event', () => {
    const root = workspace(ON);
    const env = tokenEnv();
    grantLocalConsent(root, env);
    const spy = jest.spyOn(fs, 'openSync');
    for (let i = 0; i < 25; i++) telemetry.decideForProject(root, env);
    const reads = spy.mock.calls.filter(([p]) => String(p).endsWith('config.json'));
    expect(reads).toHaveLength(1);
    spy.mockRestore();
  });

  it('keeps a committed enabled:true off without this user\'s consent (#348)', () => {
    const root = workspace(ON);
    const env = tokenEnv();
    expect(telemetry.decideNow(root, env)).toEqual({ enabled: false, reason: 'not_consented_locally' });
    expect(telemetry.decideForProject(root, env)).toEqual({ enabled: false, reason: 'not_consented_locally' });
  });

  it('turns on once this user has consented for the project', () => {
    const root = workspace(ON);
    const env = tokenEnv();
    grantLocalConsent(root, env);
    expect(telemetry.decideNow(root, env)).toEqual({ enabled: true, reason: 'enabled' });
    expect(telemetry.decideForProject(root, env)).toEqual({ enabled: true, reason: 'enabled' });
  });

  it('ignores a consent record planted inside the repository', () => {
    const root = workspace(ON);
    const env = tokenEnv();
    const record = JSON.stringify({ projects: { [fs.realpathSync(root)]: true } });
    fs.mkdirSync(path.join(root, '.mobile-automator', '.session'), { recursive: true });
    fs.writeFileSync(path.join(root, '.mobile-automator', '.session', 'telemetry-consent.json'), record);
    fs.writeFileSync(path.join(root, '.mobile-automator', 'telemetry-consent.json'), record);
    expect(telemetry.decideNow(root, env)).toEqual({ enabled: false, reason: 'not_consented_locally' });
  });

  it('does not read the consent record while the config is off', () => {
    const env = tokenEnv();
    const consentReads = (root) => {
      const spy = jest.spyOn(fs, 'readFileSync');
      telemetry.decideNow(root, env);
      const n = spy.mock.calls.filter(([p]) => String(p) === consent.consentPath({ env })).length;
      spy.mockRestore();
      return n;
    };
    const on = workspace(ON);
    grantLocalConsent(on, env);
    // The control: with the config on, the spy does see the read.
    expect(consentReads(on)).toBe(1);
    expect(consentReads(workspace({ telemetry: { enabled: false } }))).toBe(0);
    expect(consentReads(workspace())).toBe(0);
  });

  it('decides afresh on every decideNow call, with no cache to reset', () => {
    const root = workspace(ON);
    const env = tokenEnv();
    grantLocalConsent(root, env);
    jest.useFakeTimers();
    try {
      expect(telemetry.decideNow(root, env).enabled).toBe(true);
      expect(telemetry.decideForProject(root, env).enabled).toBe(true);
      fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), JSON.stringify({ telemetry: { enabled: false } }));
      expect(telemetry.decideNow(root, env)).toEqual({ enabled: false, reason: 'not_configured' });
      // decideForProject's cache holds a decision for up to a second.
      expect(telemetry.decideForProject(root, env).enabled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidates the cached decision when the config is written through setEnabled', () => {
    const root = workspace();
    const env = tokenEnv();
    expect(telemetry.decideForProject(root, env))
      .toEqual({ enabled: false, reason: 'not_configured' });
    telemetry.setEnabled(root, true, env);
    expect(telemetry.decideForProject(root, env))
      .toEqual({ enabled: true, reason: 'enabled' });
    telemetry.setEnabled(root, false, env);
    expect(telemetry.decideForProject(root, env))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('records both the config key and the local consent on enable, and withdraws both on disable', () => {
    const root = workspace();
    const other = workspace();
    const env = tokenEnv();
    const configured = () =>
      JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'config.json'), 'utf8')).telemetry.enabled;
    grantLocalConsent(other, env);

    telemetry.setEnabled(root, true, env);
    expect(configured()).toBe(true);
    expect(consent.hasLocalConsent(root, { env })).toBe(true);

    telemetry.setEnabled(root, false, env);
    expect(configured()).toBe(false);
    expect(consent.hasLocalConsent(root, { env })).toBe(false);
    const record = JSON.parse(fs.readFileSync(consent.consentPath({ env }), 'utf8'));
    expect(Object.keys(record.projects)).toEqual([fs.realpathSync(other)]);
  });

  it('writes the config before the consent record, and always clears the cache', () => {
    const root = workspace(ON);
    const env = tokenEnv();
    grantLocalConsent(root, env);
    expect(telemetry.decideForProject(root, env).enabled).toBe(true);
    // A directory where the consent file belongs: its write fails.
    const file = consent.consentPath({ env });
    fs.rmSync(file);
    fs.mkdirSync(path.join(file, 'blocker'), { recursive: true });

    expect(() => telemetry.setEnabled(root, false, env)).toThrow();
    // The disable still landed, and the cached "enabled" did not survive it.
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mobile-automator', 'config.json'), 'utf8'));
    expect(cfg.telemetry.enabled).toBe(false);
    expect(telemetry.decideForProject(root, env)).toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('degrades to disabled when the config is unreadable or corrupt', () => {
    const root = workspace();
    fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), '{ not json');
    expect(telemetry.decideForProject(root, tokenEnv()))
      .toEqual({ enabled: false, reason: 'not_configured' });
    expect(telemetry.decideNow(root, tokenEnv()))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('derives its disclosure from the catalog rather than restating it', () => {
    expect(telemetry.sentFields().sort())
      .toEqual(Object.keys(EVENT_FIELDS).filter((k) => EVENT_FIELDS[k].sends).sort());
    expect(telemetry.neverSentFields().sort()).toEqual([...NEVER_SENDS].sort());
    // The two halves cannot overlap; that is the redaction contract.
    const overlap = telemetry.sentFields().filter((f) => telemetry.neverSentFields().includes(f));
    expect(overlap).toEqual([]);
  });

  it('states the consent rules in one place, and never asks a question', () => {
    expect(telemetry.CONSENT_NOTICE).toContain('off by default');
    expect(telemetry.CONSENT_NOTICE).toContain('mauto telemetry enable');
    expect(telemetry.CONSENT_NOTICE).toContain('mauto telemetry status');
    // A notice, not a prompt: nothing in it may read as a question to answer.
    expect(telemetry.CONSENT_NOTICE).not.toMatch(/\?/);
  });

  it('tells the user the device engine is silenced too, and by which variable (#213)', () => {
    expect(telemetry.CONSENT_NOTICE).toContain('MOBILEMCP_DISABLE_TELEMETRY');
  });

  it('says consent is recorded per user, outside the repository (#348)', () => {
    const flat = telemetry.CONSENT_NOTICE.replace(/\s+/g, ' ');
    expect(flat).toContain('on this machine only');
    expect(flat).toContain('outside the repository');
    expect(flat).toContain('a committed config cannot turn it on for anyone else');
    for (const line of telemetry.CONSENT_NOTICE.split('\n')) expect(line.length).toBeLessThanOrEqual(78);
  });
});

describe('decideForProject: a decision cached for at most a second (#348)', () => {
  // A daemon outlives the verb that started it, so a decision cached for the
  // life of the process would keep sending after `mauto telemetry disable`.
  function consented() {
    const root = workspace(ON);
    const env = tokenEnv();
    grantLocalConsent(root, env);
    return { root, env };
  }
  const configOpens = (spy) => spy.mock.calls.filter(([p]) => String(p).endsWith('config.json')).length;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('re-reads at most once per DECISION_MAX_AGE_MS', () => {
    expect(telemetry.DECISION_MAX_AGE_MS).toBe(1000);
    const { root, env } = consented();
    const spy = jest.spyOn(fs, 'openSync');
    try {
      expect(telemetry.decideForProject(root, env).enabled).toBe(true);
      expect(configOpens(spy)).toBe(1);
      jest.advanceTimersByTime(999);
      expect(telemetry.decideForProject(root, env).enabled).toBe(true);
      expect(telemetry.decideForProject(root, env).enabled).toBe(true);
      expect(configOpens(spy)).toBe(1);
      jest.advanceTimersByTime(1);
      expect(telemetry.decideForProject(root, env).enabled).toBe(true);
      expect(configOpens(spy)).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('flips to off once consent is withdrawn and the max age has passed', () => {
    const { root, env } = consented();
    expect(telemetry.decideForProject(root, env).enabled).toBe(true);
    consent.setLocalConsent(root, false, { env });
    jest.advanceTimersByTime(500);
    expect(telemetry.decideForProject(root, env).enabled).toBe(true);
    jest.advanceTimersByTime(500);
    expect(telemetry.decideForProject(root, env))
      .toEqual({ enabled: false, reason: 'not_consented_locally' });
  });

  it('flips to off when the config is turned off under it', () => {
    const { root, env } = consented();
    expect(telemetry.decideForProject(root, env).enabled).toBe(true);
    fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), JSON.stringify({ telemetry: { enabled: false } }));
    jest.advanceTimersByTime(1500);
    expect(telemetry.decideForProject(root, env)).toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('re-reads when the clock goes backwards rather than trusting a decision of unknown age', () => {
    const { root, env } = consented();
    expect(telemetry.decideForProject(root, env).enabled).toBe(true);
    consent.setLocalConsent(root, false, { env });
    jest.setSystemTime(new Date('2026-11-21T11:59:59.900Z'));
    expect(telemetry.decideForProject(root, env).enabled).toBe(false);
  });

  it('ages each project root on its own', () => {
    const a = consented();
    const b = workspace(ON);
    grantLocalConsent(b, a.env);
    telemetry.decideForProject(a.root, a.env);
    jest.advanceTimersByTime(600);
    telemetry.decideForProject(b, a.env);
    jest.advanceTimersByTime(400);
    const spy = jest.spyOn(fs, 'openSync');
    try {
      telemetry.decideForProject(a.root, a.env);
      telemetry.decideForProject(b, a.env);
      // Only a's entry is a second old; b's is still fresh.
      expect(configOpens(spy)).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('resolveEngineTelemetry (#213)', () => {
  it('defaults the engine off when the user set nothing', () => {
    expect(telemetry.resolveEngineTelemetry({}))
      .toEqual({ disableValue: '1', enabled: false, reason: 'default_off' });
  });

  it('passes a user-set "1" through verbatim', () => {
    expect(telemetry.resolveEngineTelemetry({ MOBILEMCP_DISABLE_TELEMETRY: '1' }))
      .toEqual({ disableValue: '1', enabled: false, reason: 'user_env' });
  });

  it('treats any non-empty user value as off, mirroring the engine\'s truthiness gate', () => {
    expect(telemetry.resolveEngineTelemetry({ MOBILEMCP_DISABLE_TELEMETRY: '0' }))
      .toEqual({ disableValue: '0', enabled: false, reason: 'user_env' });
  });

  it('passes an empty string through, which is the engine opt-in', () => {
    expect(telemetry.resolveEngineTelemetry({ MOBILEMCP_DISABLE_TELEMETRY: '' }))
      .toEqual({ disableValue: '', enabled: true, reason: 'user_env' });
  });

  it('MAUTO_TELEMETRY=0 overrides an engine opt-in', () => {
    expect(telemetry.resolveEngineTelemetry({ MAUTO_TELEMETRY: '0', MOBILEMCP_DISABLE_TELEMETRY: '' }))
      .toEqual({ disableValue: '1', enabled: false, reason: 'kill_switch' });
  });

  it.each(['1', 'true'])('DO_NOT_TRACK=%s overrides an engine opt-in', (dnt) => {
    expect(telemetry.resolveEngineTelemetry({ DO_NOT_TRACK: dnt, MOBILEMCP_DISABLE_TELEMETRY: '' }))
      .toEqual({ disableValue: '1', enabled: false, reason: 'do_not_track' });
  });
});
