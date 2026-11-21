'use strict';

const path = require('path');

const consent = require('../../../src/observe/consent');

describe('consentPath', () => {
  const homedir = () => '/home/dev';

  it('uses XDG_CONFIG_HOME when it is absolute', () => {
    expect(consent.consentPath({ env: { XDG_CONFIG_HOME: '/xdg/config' }, homedir }))
      .toBe(path.join('/xdg/config', 'mauto', 'telemetry-consent.json'));
  });

  it('ignores a relative XDG_CONFIG_HOME, as the XDG spec requires', () => {
    expect(consent.consentPath({ env: { XDG_CONFIG_HOME: 'relative/config' }, homedir }))
      .toBe(path.join('/home/dev', '.config', 'mauto', 'telemetry-consent.json'));
  });

  it('falls back to ~/.config under the injected home directory', () => {
    expect(consent.consentPath({ env: {}, homedir }))
      .toBe(path.join('/home/dev', '.config', 'mauto', 'telemetry-consent.json'));
    expect(consent.consentPath({ env: { XDG_CONFIG_HOME: '' }, homedir }))
      .toBe(path.join('/home/dev', '.config', 'mauto', 'telemetry-consent.json'));
  });
});

describe('the per-user consent record (#348)', () => {
  const fs = require('fs');
  const os = require('os');
  const { userConfigEnv } = require('../../helpers/user-config');

  const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-consent-'));
  const readRecord = (env) => JSON.parse(fs.readFileSync(consent.consentPath({ env }), 'utf8'));
  const plant = (env, text) => {
    const file = consent.consentPath({ env });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  it('round-trips a grant, keyed by the realpath, as pretty JSON with a trailing newline', () => {
    const env = userConfigEnv();
    const root = project();
    expect(consent.hasLocalConsent(root, { env })).toBe(false);
    consent.setLocalConsent(root, true, { env });
    expect(consent.hasLocalConsent(root, { env })).toBe(true);
    const expected = { projects: { [fs.realpathSync(root)]: true } };
    expect(fs.readFileSync(consent.consentPath({ env }), 'utf8')).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it('gives a project reached through a symlink the same key as its realpath', () => {
    const env = userConfigEnv();
    const root = project();
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-consent-link-')), 'checkout');
    fs.symlinkSync(root, link);
    consent.setLocalConsent(link, true, { env });
    expect(Object.keys(readRecord(env).projects)).toEqual([fs.realpathSync(root)]);
    expect(consent.hasLocalConsent(root, { env })).toBe(true);
    expect(consent.hasLocalConsent(link, { env })).toBe(true);
  });

  it('withdraws only that project, keeping every other project\'s record', () => {
    const env = userConfigEnv();
    const a = project();
    const b = project();
    consent.setLocalConsent(a, true, { env });
    consent.setLocalConsent(b, true, { env });
    consent.setLocalConsent(a, false, { env });
    expect(consent.hasLocalConsent(a, { env })).toBe(false);
    expect(consent.hasLocalConsent(b, { env })).toBe(true);
    expect(readRecord(env).projects).toEqual({ [fs.realpathSync(b)]: true });
  });

  it('never creates a file just to record "no"', () => {
    const env = userConfigEnv();
    consent.setLocalConsent(project(), false, { env });
    expect(fs.existsSync(path.join(env.XDG_CONFIG_HOME, 'mauto'))).toBe(false);
  });

  it.each([
    ['a corrupt file', '{ not json'],
    ['a top-level array', '[]'],
    ['projects that is an array', '{"projects": []}'],
    ['projects that is null', '{"projects": null}'],
    ['no projects at all', '{}'],
  ])('fails closed on %s', (_label, text) => {
    const env = userConfigEnv();
    const root = project();
    plant(env, text);
    expect(consent.hasLocalConsent(root, { env })).toBe(false);
  });

  it.each([['the string "true"', 'true'], ['the number 1', 1], ['an object', {}]])(
    'reads %s as no consent: only a literal true counts',
    (_label, value) => {
      const env = userConfigEnv();
      const root = project();
      plant(env, JSON.stringify({ projects: { [fs.realpathSync(root)]: value } }));
      expect(consent.hasLocalConsent(root, { env })).toBe(false);
    }
  );

  it.each([
    ['a corrupt file', '{ not json'],
    ['a top-level array', '[]'],
    // The quiet one: an array accepts the key, and JSON.stringify then drops it.
    ['projects that is an array', '{"projects": []}'],
    ['projects that is null', '{"projects": null}'],
    ['no projects at all', '{}'],
  ])('replaces %s when consent is granted', (_label, text) => {
    const env = userConfigEnv();
    const root = project();
    plant(env, text);
    consent.setLocalConsent(root, true, { env });
    expect(readRecord(env)).toEqual({ projects: { [fs.realpathSync(root)]: true } });
    expect(consent.hasLocalConsent(root, { env })).toBe(true);
  });

  it('never throws from hasLocalConsent, even when the home directory cannot be found', () => {
    const homedir = () => {
      throw new Error('no home');
    };
    expect(consent.hasLocalConsent(project(), { env: {}, homedir })).toBe(false);
  });

  it('leaves the mauto dir 0700 and the file 0600, without touching the parent dir', () => {
    const env = userConfigEnv();
    fs.chmodSync(env.XDG_CONFIG_HOME, 0o755);
    // An existing, looser mauto dir is tightened, not just a new one created.
    fs.mkdirSync(path.join(env.XDG_CONFIG_HOME, 'mauto'), { mode: 0o755 });
    fs.chmodSync(path.join(env.XDG_CONFIG_HOME, 'mauto'), 0o755);
    consent.setLocalConsent(project(), true, { env });
    const mode = (p) => fs.statSync(p).mode & 0o777;
    expect(mode(path.join(env.XDG_CONFIG_HOME, 'mauto'))).toBe(0o700);
    expect(mode(consent.consentPath({ env }))).toBe(0o600);
    expect(mode(env.XDG_CONFIG_HOME)).toBe(0o755);
  });

  it('lets a write failure propagate, so the verb fails visibly', () => {
    // XDG_CONFIG_HOME names a regular file: the mauto dir cannot be created.
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-consent-blk-')), 'not-a-dir');
    fs.writeFileSync(blocker, '');
    expect(() => consent.setLocalConsent(project(), true, { env: { XDG_CONFIG_HOME: blocker } }))
      .toThrow(expect.objectContaining({ code: 'ENOTDIR' }));
  });

  it('never consults a consent-shaped file planted inside the repository', () => {
    const env = userConfigEnv();
    const root = project();
    const record = JSON.stringify({ projects: { [fs.realpathSync(root)]: true } });
    for (const rel of [['.session', 'telemetry-consent.json'], ['telemetry-consent.json']]) {
      const file = path.join(root, '.mobile-automator', ...rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, record);
    }
    expect(consent.hasLocalConsent(root, { env })).toBe(false);
  });
});
