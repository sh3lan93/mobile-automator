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

describe('run trace paths', () => {
  const path = require('path');
  const { RUN_TRACE_PREFIX, isValidRunId, runTracePath } = require('../../../src/observe/paths');

  it('names the trace after the run, inside the logs dir', () => {
    const p = runTracePath('/proj', 'run_20260905_141500', {});
    expect(p).toBe(path.join('/proj', 'mobile-automator', '.logs', 'run-run_20260905_141500.ndjson'));
    expect(path.basename(p).startsWith(RUN_TRACE_PREFIX)).toBe(true);
  });

  it('honours MAUTO_LOG_DIR like every other log path', () => {
    const p = runTracePath('/proj', 'smoke', { MAUTO_LOG_DIR: '/tmp/elsewhere' });
    expect(p).toBe(path.join('/tmp/elsewhere', 'run-smoke.ndjson'));
  });

  it('accepts the ids agents actually use', () => {
    for (const id of ['run_20260905_141500', 'login-smoke-0031', 'a', 'v1.2.3_run', 'A0']) {
      expect(isValidRunId(id)).toBe(true);
    }
  });

  // The value reaches us from an environment variable and becomes a filename.
  // Rejecting is deliberate: sanitizing would collapse two distinct runs onto
  // one trace and produce a duration spanning both.
  it('refuses anything that is not a safe filename', () => {
    const hostile = [
      '../../../../etc/cron.d/x',
      '..',
      '.',
      '.hidden',
      'a/b',
      'a\\b',
      'C:\\runs\\x',
      '/absolute',
      'has space',
      'nul\u0000byte',
      '',
      '   ',
      'x'.repeat(200),
    ];
    for (const id of hostile) {
      expect(isValidRunId(id)).toBe(false);
      expect(runTracePath('/proj', id, {})).toBeNull();
    }
    for (const id of [undefined, null, 42, {}, []]) {
      expect(isValidRunId(id)).toBe(false);
      expect(runTracePath('/proj', id, {})).toBeNull();
    }
  });
});
