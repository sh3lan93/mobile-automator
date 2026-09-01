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
