'use strict';

// Engine-side contract guard for `crash get --out` (#347): the roots our rule
// allows (src/workspace/output-roots.js) are the roots the PINNED
// @mobilenext/mobile-mcp allows for the files it writes itself.
//
// Why it exists. output-roots.js restates the engine's getAllowedRoots and
// isTooBroadToAllow (node_modules/@mobilenext/mobile-mcp/lib/utils.js) so a
// crash report goes no further than a screenshot could. A restatement drifts
// silently: an engine bump that adds, drops or narrows a root would leave the
// two disagreeing and every unit test green. This asks the engine itself,
// through the validateOutputPath it exports, for the same table of paths, and
// fails when the answers differ.
//
// How. Both read the host at call time: os.tmpdir(), os.homedir(),
// process.platform, and the engine also process.cwd(). Each case stubs the
// first three and chdirs into the temp project, restoring all four after, so
// nothing depends on (or touches) the real temp dir, home or /tmp. Neither
// side writes: validateOutputPath and crashOutTarget only check. The one path
// outside a temp dir is a name directly under /tmp that is never created.
//
// Where the two differ on purpose (not tested as agreement):
//   - The project root. Ours is the project root mauto discovered; the
//     engine's is its cwd. In production they are the same directory: the
//     daemon spawns the engine with cwd = projectRoot (createCall in
//     src/device/mobile-mcp-client.js). Here the chdir makes them the same.
//   - A directory that does not exist. The engine allows a path whose
//     directory is missing when it would be created inside a root; ours
//     requires the directory to exist (its realpath is what is compared), and
//     the missing directory is reported as the write failure. Every case below
//     names an existing directory.
//   - A link at the report itself. The engine follows it to its target and
//     judges that; ours judges the directory and then refuses any link leaf at
//     the write (O_NOFOLLOW). No case below has a link leaf.
//   - The workspace. A path inside .mobile-automator/ never reaches our roots
//     (the workspace rules apply instead). The project here has none.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateOutputPath } = require('@mobilenext/mobile-mcp/lib/utils.js');
const { ActionableError } = require('@mobilenext/mobile-mcp/lib/robot.js');
const { OutputPathRefusal, crashOutTarget } = require('../../src/workspace/output-roots');

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// The real host, captured before any stub.
const REAL_CWD = process.cwd();
const PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform');

// base/project (the project, and the engine's cwd), base/project/sub, a temp
// dir, a home and an outside dir: all temp dirs of the real host.
const base = tmpDir('mauto-roots-contract-');
const project = path.join(base, 'project');
fs.mkdirSync(path.join(project, 'sub'), { recursive: true });
const tmp = tmpDir('mauto-roots-contract-tmp-');
const home = tmpDir('mauto-roots-contract-home-');
const outside = tmpDir('mauto-roots-contract-outside-');
const innerHome = path.join(project, 'users', 'me');
fs.mkdirSync(innerHome, { recursive: true });

function withHost({ platform, homedir }, fn) {
  const tmpSpy = jest.spyOn(os, 'tmpdir').mockReturnValue(tmp);
  const homeSpy = jest.spyOn(os, 'homedir').mockReturnValue(homedir);
  Object.defineProperty(process, 'platform', { ...PLATFORM, value: platform });
  process.chdir(project);
  try {
    return fn();
  } finally {
    process.chdir(REAL_CWD);
    Object.defineProperty(process, 'platform', PLATFORM);
    tmpSpy.mockRestore();
    homeSpy.mockRestore();
  }
}

function oursAllows(file) {
  try {
    crashOutTarget(project, file);
    return true;
  } catch (err) {
    if (err instanceof OutputPathRefusal) return false;
    throw err;
  }
}

function engineAllows(file) {
  try {
    validateOutputPath(file);
    return true;
  } catch (err) {
    if (err instanceof ActionableError) return false;
    throw err;
  }
}

// A name directly under /tmp, never created: /tmp itself exists on both
// macOS and linux, which is all either rule looks at.
const SLASH_TMP_FILE = path.join('/tmp', `mauto-roots-contract-${process.pid}-never-written.txt`);

// [label, file, home], `expected` where it is the same on every host. Under
// /tmp on darwin only: on a linux host the stubbed tmpdir keeps /tmp out.
const CASES = [
  ['a file in the project', path.join(project, 'crash.txt'), home, true],
  ['a file in a project subdirectory', path.join(project, 'sub', 'crash.txt'), home, true],
  ['a file in the temp dir', path.join(tmp, 'crash.txt'), home, true],
  ['a file in the project\'s parent', path.join(base, 'crash.txt'), home, undefined],
  ['a file in an unrelated dir', path.join(outside, 'crash.txt'), home, undefined],
  ['a file directly under /tmp', SLASH_TMP_FILE, home, undefined],
  ['the project is home: a file in it', path.join(project, 'crash.txt'), project, false],
  ['the project is home: the temp dir', path.join(tmp, 'crash.txt'), project, true],
  ['the project is above home: a file in it', path.join(project, 'crash.txt'), innerHome, false],
  ['the project is below home: a file in it', path.join(project, 'crash.txt'), base, true],
];

describe.each(['darwin', 'linux'])('crash --out roots agree with the pinned engine (platform %s)', (platform) => {
  it.each(CASES)('%s', (_label, file, homedir, expected) => {
    const { ours, engine } = withHost({ platform, homedir }, () => ({
      ours: oursAllows(file),
      engine: engineAllows(file),
    }));
    expect({ file, ours }).toEqual({ file, ours: engine });
    if (expected !== undefined) expect(ours).toBe(expected);
  });

  it('a file directly under /tmp is allowed on darwin only', () => {
    const allowed = withHost({ platform, homedir: home }, () => oursAllows(SLASH_TMP_FILE));
    // On a linux host the real temp dir may be /tmp itself, but os.tmpdir()
    // is stubbed away from it, so only the darwin rule can admit it.
    expect(allowed).toBe(platform === 'darwin');
  });
});

afterAll(() => {
  for (const d of [base, tmp, home, outside]) fs.rmSync(d, { recursive: true, force: true });
  expect(fs.existsSync(SLASH_TMP_FILE)).toBe(false);
});
