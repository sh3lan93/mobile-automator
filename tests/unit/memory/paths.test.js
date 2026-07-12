'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { memoryDir, memoryFile, sessionDir, lockPath, FILES } = require('../../../src/memory/paths');
const { scaffold } = require('../../../src/setup/scaffold');

describe('memory/paths', () => {
  const root = '/tmp/proj';

  test('memoryDir is under the workspace', () => {
    expect(memoryDir(root)).toBe(path.join(root, 'mobile-automator', 'memory'));
  });

  test('memoryFile resolves each known file', () => {
    expect(memoryFile(root, 'run-history')).toBe(
      path.join(root, 'mobile-automator', 'memory', 'run-history.md')
    );
    expect(FILES['app-knowledge']).toBe('app-knowledge.md');
    expect(FILES['preferences']).toBe('preferences.md');
  });

  test('lockPath lives in the gitignored .session dir', () => {
    expect(lockPath(root)).toBe(
      path.join(root, 'mobile-automator', '.session', 'memory.lock')
    );
    expect(sessionDir(root)).toBe(path.join(root, 'mobile-automator', '.session'));
  });

  test('scaffold creates mobile-automator/memory/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-scaffold-'));
    scaffold(root, { mode: 'platform-aware' });
    expect(fs.existsSync(path.join(root, 'mobile-automator', 'memory'))).toBe(true);
  });
});
