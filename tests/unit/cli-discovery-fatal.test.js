'use strict';

// run() discovers the workspace before its own try (#346). Discovery now
// throws what it cannot classify instead of adopting the workspace, so that
// throw must still become the one fatal JSON envelope, never an unhandled
// rejection.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { captureProcessIO } = require('../helpers/cli-harness');

let base;
beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-discovery-fatal-')));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

test('a discovery error yields one fatal envelope and exit 1', async () => {
  await jest.isolateModulesAsync(async () => {
    jest.doMock('../../src/workspace/discover', () => ({
      ...jest.requireActual('../../src/workspace/discover'),
      findWorkspaceRoot: () => {
        throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
      },
    }));
    const cli = require('../../src/cli');
    jest.spyOn(process, 'cwd').mockReturnValue(base);

    // A rejection here would fail the test: run() must resolve.
    const result = await captureProcessIO(() => cli.run(['node', 'mauto', 'config', 'get', 'mode']));

    const json = result.writes.filter((w) => w.trim().startsWith('{'));
    expect(json).toHaveLength(1);
    const env = JSON.parse(json[0]);
    expect(env.ok).toBe(false);
    expect(env.error.message).toContain('EMFILE');
    expect(result.exitCodes).toEqual([1]);
  });
});
