'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const telemetry = require('../../../src/observe/telemetry');
const { EVENT_FIELDS, NEVER_SENDS } = require('../../../src/observe/event');
const { TOKEN_PLACEHOLDER } = require('../../../src/observe/transport');

const ON = { telemetry: { enabled: true } };
const TOKEN = { MAUTO_TELEMETRY_TOKEN: 'phc_real' };

function workspace(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-tel-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  if (config !== undefined) {
    fs.writeFileSync(
      path.join(root, 'mobile-automator', 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }
  return root;
}

beforeEach(() => telemetry._resetMemo());

describe('telemetry control surface', () => {
  it('is off when nothing has been configured', () => {
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: null }))
      .toEqual({ enabled: false, reason: 'not_configured' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: {} }))
      .toEqual({ enabled: false, reason: 'not_configured' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: { telemetry: { enabled: false } } }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('is on only for a literal true in the config, not a truthy string', () => {
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: ON }))
      .toEqual({ enabled: true, reason: 'enabled' });
    expect(telemetry.resolveTelemetry({ env: TOKEN, config: { telemetry: { enabled: 'true' } } }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('lets MAUTO_TELEMETRY=0 win over an enabled config', () => {
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, MAUTO_TELEMETRY: '0' }, config: ON }))
      .toEqual({ enabled: false, reason: 'kill_switch' });
  });

  it('honours DO_NOT_TRACK', () => {
    for (const v of ['1', 'true', 'TRUE']) {
      expect(telemetry.resolveTelemetry({ env: { ...TOKEN, DO_NOT_TRACK: v }, config: ON }))
        .toEqual({ enabled: false, reason: 'do_not_track' });
    }
    // DO_NOT_TRACK=0 is an explicit "tracking is fine", not a kill switch.
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, DO_NOT_TRACK: '0' }, config: ON }))
      .toEqual({ enabled: true, reason: 'enabled' });
  });

  it('does NOT let MAUTO_TELEMETRY=1 enable collection', () => {
    // An off-switch may live in the environment. An ON-switch may not: it is a
    // way to enable collection on a machine — a CI image, a shared profile, an
    // inherited Dockerfile — whose owner never consented.
    expect(telemetry.resolveTelemetry({ env: { ...TOKEN, MAUTO_TELEMETRY: '1' }, config: null }))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('stays off when the resolved token is the placeholder', () => {
    // A real token ships now (Task 12 graduation), so this state is no longer
    // reachable via an absent override — only an explicit placeholder proves
    // the mechanism still holds.
    expect(telemetry.resolveTelemetry({ env: { MAUTO_TELEMETRY_TOKEN: TOKEN_PLACEHOLDER }, config: ON }))
      .toEqual({ enabled: false, reason: 'no_token' });
  });

  it('checks the kill switches before it reads any config', () => {
    const root = workspace(ON);
    const spy = jest.spyOn(fs, 'readFileSync');
    const before = spy.mock.calls.length;
    expect(telemetry.decideForProject(root, { ...TOKEN, MAUTO_TELEMETRY: '0' }))
      .toEqual({ enabled: false, reason: 'kill_switch' });
    expect(spy.mock.calls.length).toBe(before);
    spy.mockRestore();
  });

  it('reads config.json once per project root, not once per event', () => {
    const root = workspace(ON);
    const spy = jest.spyOn(fs, 'readFileSync');
    for (let i = 0; i < 25; i++) telemetry.decideForProject(root, TOKEN);
    const reads = spy.mock.calls.filter(([p]) => String(p).endsWith('config.json'));
    expect(reads).toHaveLength(1);
    spy.mockRestore();
  });

  it('invalidates the memoised decision when the config is written through setEnabled', () => {
    const root = workspace();
    expect(telemetry.decideForProject(root, TOKEN))
      .toEqual({ enabled: false, reason: 'not_configured' });
    telemetry.setEnabled(root, true);
    expect(telemetry.decideForProject(root, TOKEN))
      .toEqual({ enabled: true, reason: 'enabled' });
    telemetry.setEnabled(root, false);
    expect(telemetry.decideForProject(root, TOKEN))
      .toEqual({ enabled: false, reason: 'not_configured' });
  });

  it('degrades to disabled when the config is unreadable or corrupt', () => {
    const root = workspace();
    fs.writeFileSync(path.join(root, 'mobile-automator', 'config.json'), '{ not json');
    expect(telemetry.decideForProject(root, TOKEN))
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
});
