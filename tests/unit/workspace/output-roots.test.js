'use strict';

// The `crash get --out` roots (#347), tested as a module: which directories a
// crash report may be written to outside the workspace, and how a path in or
// out of them is judged. The handler-level cases (refused before the device is
// asked, the write itself, the envelope) are in tests/unit/cli/crash-verb.test.js.
//
// Every host fact is injected (temp dir, platform, /tmp, home), so nothing
// here depends on, or writes to, the real ones. Nothing here writes at all
// outside the temp dirs it makes: crashOutTarget only checks.

const fs = require('fs');
const path = require('path');

const { OutputPathRefusal, crashOutRoots, crashOutTarget } = require('../../../src/workspace/output-roots');
const { tmpDir } = require('../../helpers/workspace-safety');

// A project one level below its own temp dir, plus a temp dir, a home and an
// outside dir: four different places, none of them the real host's.
function setup() {
  const base = tmpDir('mauto-out-roots-');
  const root = path.join(base, 'project');
  fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
  const tmp = tmpDir('mauto-out-roots-tmp-');
  const home = tmpDir('mauto-out-roots-home-');
  const outside = tmpDir('mauto-out-roots-outside-');
  const host = { tmpdir: () => tmp, platform: 'linux', darwinTmp: tmpDir('mauto-out-roots-slash-tmp-'), homedir: () => home };
  return { base, root, tmp, home, outside, host };
}

function refusal(fn) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(OutputPathRefusal);
    expect(err.kind).toBe('invalid_input');
    return err;
  }
  throw new Error('expected an OutputPathRefusal');
}

describe('crashOutRoots', () => {
  it('lists the project and the temp dir on linux', () => {
    const s = setup();
    expect(crashOutRoots(s.root, s.host)).toEqual({ roots: [s.root, s.tmp], projectTooBroad: false });
  });

  it('adds /tmp on darwin only', () => {
    const s = setup();
    expect(crashOutRoots(s.root, { ...s.host, platform: 'darwin' }).roots).toEqual([s.root, s.tmp, s.host.darwinTmp]);
    expect(crashOutRoots(s.root, s.host).roots).not.toContain(s.host.darwinTmp);
  });

  // mobile-mcp's isTooBroadToAllow: the home directory or anything above it
  // would make nearly every file the user owns writable. `crash get` has no
  // workspace gate, so run from ~ its project root is ~.
  describe('a project that is the home directory or above it is no root', () => {
    it('home equal to the project: dropped', () => {
      const s = setup();
      expect(crashOutRoots(s.root, { ...s.host, homedir: () => s.root })).toEqual({
        roots: [s.tmp],
        projectTooBroad: true,
      });
    });

    it('home below the project (the project is an ancestor): dropped', () => {
      const s = setup();
      const home = path.join(s.root, 'users', 'me');
      fs.mkdirSync(home, { recursive: true });
      expect(crashOutRoots(s.root, { ...s.host, homedir: () => home }).projectTooBroad).toBe(true);
    });

    it('the filesystem root is above every home: dropped', () => {
      const s = setup();
      expect(crashOutRoots('/', s.host).projectTooBroad).toBe(true);
    });

    it('home reached through a link is compared by realpath', () => {
      const s = setup();
      const alias = path.join(tmpDir('mauto-out-roots-alias-'), 'home');
      fs.symlinkSync(s.root, alias);
      expect(crashOutRoots(s.root, { ...s.host, homedir: () => alias }).projectTooBroad).toBe(true);
    });

    it('a project in a subdirectory of home stays a root', () => {
      const s = setup();
      expect(crashOutRoots(s.root, { ...s.host, homedir: () => s.base })).toEqual({
        roots: [s.root, s.tmp],
        projectTooBroad: false,
      });
    });

    it('a home that does not exist protects nothing: the project stays a root', () => {
      const s = setup();
      const absent = path.join(s.base, 'no-such-home');
      expect(crashOutRoots(s.root, { ...s.host, homedir: () => absent }).projectTooBroad).toBe(false);
    });
  });
});

describe('crashOutTarget', () => {
  it('allows a path in the project, in the temp dir, and in a project subdirectory', () => {
    const s = setup();
    fs.mkdirSync(path.join(s.root, 'sub'));
    for (const out of [path.join(s.root, 'c.txt'), path.join(s.tmp, 'c.txt'), path.join(s.root, 'sub', 'c.txt')]) {
      const t = crashOutTarget(s.root, out, s.host);
      expect(t).toMatchObject({ path: out, confined: false });
    }
  });

  it('refuses a path outside every root, the hint naming the roots', () => {
    const s = setup();
    const err = refusal(() => crashOutTarget(s.root, path.join(s.outside, 'c.txt'), s.host));
    expect(err.message).toContain(path.join(s.outside, 'c.txt'));
    expect(err.hint).toContain(s.root);
    expect(err.hint).toContain(s.tmp);
    expect(err.hint).not.toContain('The project directory is not allowed');
  });

  it('refuses the project\'s parent (`..`)', () => {
    const s = setup();
    refusal(() => crashOutTarget(s.root, path.join(s.base, 'c.txt'), s.host));
  });

  it('compares realpaths: a project directory linking outside every root is refused, by its own name', () => {
    const s = setup();
    fs.symlinkSync(s.outside, path.join(s.root, 'docs'));
    const err = refusal(() => crashOutTarget(s.root, path.join(s.root, 'docs', 'c.txt'), s.host));
    expect(err.message).toContain(path.join(s.root, 'docs', 'c.txt'));
    expect(err.message).not.toContain(s.outside);
  });

  it('a root that does not resolve is skipped, not matched', () => {
    const s = setup();
    const host = { ...s.host, tmpdir: () => path.join(s.base, 'no-such-tmp') };
    refusal(() => crashOutTarget(s.root, path.join(s.outside, 'c.txt'), host));
    expect(crashOutTarget(s.root, path.join(s.root, 'c.txt'), host).confined).toBe(false);
  });

  it('a project that is home: its paths are refused, the temp dir still allowed, and the hint says why', () => {
    const s = setup();
    const host = { ...s.host, homedir: () => s.root };
    const err = refusal(() => crashOutTarget(s.root, path.join(s.root, 'c.txt'), host));
    expect(err.hint).toContain('The project directory is not allowed');
    expect(err.hint).not.toContain(s.root);
    expect(err.hint).toContain(s.tmp);
    expect(crashOutTarget(s.root, path.join(s.tmp, 'c.txt'), host).confined).toBe(false);
  });

  describe('/tmp on macOS', () => {
    it('on darwin a path under /tmp is allowed; on linux it is refused and not offered', () => {
      const s = setup();
      const out = path.join(s.host.darwinTmp, 'c.txt');
      expect(crashOutTarget(s.root, out, { ...s.host, platform: 'darwin' }).path).toBe(out);
      const err = refusal(() => crashOutTarget(s.root, out, s.host));
      expect(err.hint).not.toContain(s.host.darwinTmp);
    });

    it('on darwin the refusal hint names every root, /tmp included', () => {
      const s = setup();
      const err = refusal(() => crashOutTarget(s.root, path.join(s.outside, 'c.txt'), { ...s.host, platform: 'darwin' }));
      for (const root of [s.root, s.tmp, s.host.darwinTmp]) expect(err.hint).toContain(root);
    });
  });

  describe('in the workspace the roots do not apply', () => {
    it('a workspace path is confined, even when the project is home', () => {
      const s = setup();
      const out = path.join(s.root, '.mobile-automator', 'c.txt');
      expect(crashOutTarget(s.root, out, { ...s.host, homedir: () => s.root })).toMatchObject({
        path: out,
        confined: true,
      });
    });

    it('a workspace path reached through an alias of the project root is re-rooted', () => {
      const s = setup();
      const alias = path.join(tmpDir('mauto-out-roots-root-alias-'), 'p');
      fs.symlinkSync(s.root, alias);
      const t = crashOutTarget(s.root, path.join(alias, '.mobile-automator', 'c.txt'), s.host);
      expect(t).toMatchObject({ path: path.join(s.root, '.mobile-automator', 'c.txt'), confined: true });
    });
  });

  it('a directory that does not exist outside the workspace throws its own fs error, not a refusal', () => {
    const s = setup();
    expect(() => crashOutTarget(s.root, path.join(s.tmp, 'no', 'such', 'c.txt'), s.host)).toThrow(
      expect.objectContaining({ code: 'ENOENT' })
    );
  });
});
