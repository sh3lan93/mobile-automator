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
