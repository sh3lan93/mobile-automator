'use strict';

const path = require('path');
const paths = require('../../../src/device/session-paths');

describe('session-paths', () => {
  const root = '/tmp/proj';

  test('all paths live under <root>/mobile-automator/.session/', () => {
    const base = path.join(root, 'mobile-automator', '.session');
    expect(paths.sessionDir(root)).toBe(base);
    expect(paths.socketPath(root).startsWith(base + path.sep)).toBe(true);
    expect(paths.pidFilePath(root).startsWith(base + path.sep)).toBe(true);
    expect(paths.handlePath(root).startsWith(base + path.sep)).toBe(true);
  });

  test('socket / pid / handle names are distinct', () => {
    const names = new Set([
      paths.socketPath(root),
      paths.pidFilePath(root),
      paths.handlePath(root),
    ]);
    expect(names.size).toBe(3);
  });

  test('paths are project-root relative', () => {
    expect(paths.sessionDir('/a')).not.toBe(paths.sessionDir('/b'));
  });
});
