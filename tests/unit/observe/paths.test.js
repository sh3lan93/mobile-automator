'use strict';

const path = require('path');
const paths = require('../../../src/observe/paths');

describe('observe paths', () => {
  it('defaults to mobile-automator/.logs inside the workspace', () => {
    expect(paths.logsDir('/proj', {})).toBe(path.join('/proj', 'mobile-automator', '.logs'));
  });

  it('honours MAUTO_LOG_DIR and resolves it to an absolute path', () => {
    const got = paths.logsDir('/proj', { MAUTO_LOG_DIR: '/tmp/elsewhere' });
    expect(got).toBe(path.resolve('/tmp/elsewhere'));
  });

  it('names the workspace base dir, which gates whether file logging happens at all', () => {
    expect(paths.workspaceDir('/proj')).toBe(path.join('/proj', 'mobile-automator'));
  });

  it('names the main log mauto.ndjson', () => {
    expect(paths.mainLogPath('/proj', {})).toBe(
      path.join('/proj', 'mobile-automator', '.logs', 'mauto.ndjson')
    );
  });

  it('is side-effect free — resolving a path creates nothing', () => {
    const fs = require('fs');
    const target = paths.logsDir('/definitely/not/real', {});
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('daemon event log', () => {
  const path = require('path');
  const paths = require('../../../src/observe/paths');

  it('is a separate file from the CLI log, in the same .logs dir', () => {
    expect(paths.daemonEventLogPath('/proj', {})).toBe(
      path.join('/proj', 'mobile-automator', '.logs', 'daemon.ndjson')
    );
    expect(paths.daemonEventLogPath('/proj', {})).not.toBe(paths.mainLogPath('/proj', {}));
  });

  it('honours MAUTO_LOG_DIR like every other log path', () => {
    expect(paths.daemonEventLogPath('/proj', { MAUTO_LOG_DIR: '/tmp/elsewhere' })).toBe(
      path.join(path.resolve('/tmp/elsewhere'), 'daemon.ndjson')
    );
  });

  it('is not the raw stdio log, which stays in .session (PR #176)', () => {
    const sessionPaths = require('../../../src/device/session-paths');
    expect(paths.daemonEventLogPath('/proj', {})).not.toBe(sessionPaths.logFilePath('/proj'));
  });
});
