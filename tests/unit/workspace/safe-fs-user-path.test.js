'use strict';

// safe-fs for paths the user chose (#347): inWorkspace, the userDir /
// userDest / userFile entry points, safeWorkspaceDest and isInside. Inside
// the workspace they get the workspace rules; elsewhere they are the user's
// call. Fixture: tests/helpers/safe-fs-fixture.js.

const os = require('os');
const fs = require('fs');
const path = require('path');

const {
  inWorkspace,
  inProject,
  userPath,
  safeWorkspaceDest,
  isInside,
  userDir,
  userDest,
  userFile,
} = require('../../../src/workspace/safe-fs');
const {
  makeSafeFsFixture,
  removeSafeFsFixture,
  CANARY,
  snapshot,
  expectUnsafe,
  foreignAt,
  makeFifo,
  aliasedRoot,
} = require('../../helpers/safe-fs-fixture');

const { O_WRONLY, O_CREAT } = fs.constants;

let base;
let root;
let ws;
let outside;
let canaryFile;

beforeEach(() => {
  ({ base, root, ws, outside, canaryFile } = makeSafeFsFixture());
});

afterEach(() => {
  removeSafeFsFixture(base);
});

describe('inWorkspace', () => {
  it('returns a path inside the workspace as is', () => {
    const p = path.join(ws, 'screenshots', 'a.png');
    expect(inWorkspace(root, p)).toBe(p);
    expect(inWorkspace(root, ws)).toBe(ws);
  });

  it('is null for a project file outside the workspace', () => {
    expect(inWorkspace(root, path.join(root, 'shots', 'a.png'))).toBeNull();
    expect(inWorkspace(root, path.join(root, '.mobile-automator-old', 'a.png'))).toBeNull();
    expect(inWorkspace(root, root)).toBeNull();
  });

  it('is null for a path outside the project (an explicit /tmp/x.png)', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-elsewhere-'));
    try {
      expect(inWorkspace(root, path.join(elsewhere, 'x.png'))).toBeNull();
      expect(inWorkspace(root, path.join(outside, 'x.png'))).toBeNull();
      expect(inWorkspace(root, path.join(base, 'nope', 'deeper', 'x.png'))).toBeNull();
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('maps a workspace path reached through a symlinked parent onto the real root', () => {
    const { realRoot, alias, realWs } = aliasedRoot(base, root);
    expect(inWorkspace(realRoot, path.join(alias, '.mobile-automator', 'screenshots', 'a.png'))).toBe(
      path.join(realWs, 'screenshots', 'a.png')
    );
    expect(inWorkspace(realRoot, path.join(alias, '.mobile-automator'))).toBe(realWs);
  });

  it('is null for a project file outside the workspace reached through the alias', () => {
    const { realRoot, alias } = aliasedRoot(base, root);
    expect(inWorkspace(realRoot, path.join(alias, 'shots', 'a.png'))).toBeNull();
  });

  it('still maps a symlinked .mobile-automator/screenshots reached through the alias, so a walk refuses it', () => {
    const { realRoot, alias, realWs } = aliasedRoot(base, root);
    fs.symlinkSync(outside, path.join(realWs, 'screenshots'));
    const got = inWorkspace(realRoot, path.join(alias, '.mobile-automator', 'screenshots', 'a.png'));
    expect(got).toBe(path.join(realWs, 'screenshots', 'a.png'));
    expectUnsafe(() => safeWorkspaceDest(realRoot, got), 'symlink');
  });

  // A workspace dir linked back at the project root resolves to the root
  // itself: the alias is the root, not that link, so the path stays a
  // workspace path (and a walk refuses the link).
  it('maps through the shallowest ancestor that is the root, not a workspace link back to it', () => {
    const { realRoot, alias, realWs } = aliasedRoot(base, root);
    fs.symlinkSync('..', path.join(realWs, 'screenshots'));
    const got = inWorkspace(realRoot, path.join(alias, '.mobile-automator', 'screenshots', 'a.png'));
    expect(got).toBe(path.join(realWs, 'screenshots', 'a.png'));
    expectUnsafe(() => safeWorkspaceDest(realRoot, got), 'symlink');
  });

  it('only looks: no fs call but realpath', () => {
    const { realRoot, alias } = aliasedRoot(base, root);
    const lookOnly = { realpathSync: fs.realpathSync };
    const p = path.join(alias, '.mobile-automator', 'screenshots', 'a.png');
    expect(inWorkspace(realRoot, p, { fs: lookOnly })).toBe(path.join(realRoot, '.mobile-automator', 'screenshots', 'a.png'));
    expect(inWorkspace(realRoot, path.join(outside, 'x.png'), { fs: lookOnly })).toBeNull();
  });
});

// The entry points for a path the user chose: each makes the inWorkspace
// choice itself and hands back the path to use.
describe('userDir / userDest / userFile (#347)', () => {
  it('userDir walks a workspace directory, refusing a link; elsewhere it only mkdirs', () => {
    fs.symlinkSync(outside, path.join(ws, '.logs'));
    expectUnsafe(() => userDir(root, path.join(ws, '.logs'), { create: true }), 'symlink');
    const plain = path.join(outside, 'logs', 'deep');
    expect(userDir(root, plain, { create: true })).toBe(plain);
    expect(fs.lstatSync(plain).isDirectory()).toBe(true);
    expect(userDir(root, path.join(outside, 'absent'))).toBe(path.join(outside, 'absent'));
    expect(fs.existsSync(path.join(outside, 'absent'))).toBe(false);
  });

  it('userDir and userDest return the re-rooted path through an aliased root', () => {
    const { realRoot, alias, realWs } = aliasedRoot(base, root);
    expect(userDir(realRoot, path.join(alias, '.mobile-automator', 'a'), { create: true })).toBe(path.join(realWs, 'a'));
    expect(userDest(realRoot, path.join(alias, '.mobile-automator', 'b', 'x.png'))).toBe(path.join(realWs, 'b', 'x.png'));
  });

  it('userDest refuses a workspace leaf link and passes any other path through unchanged', () => {
    fs.symlinkSync(canaryFile, path.join(ws, 'shot.png'));
    expectUnsafe(() => userDest(root, path.join(ws, 'shot.png')), 'symlink');
    const given = path.join(outside, 'link-or-not.png');
    fs.symlinkSync(canaryFile, given);
    expect(userDest(root, given)).toBe(given);
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('userFile confines a workspace file and words an outside refusal in the path scope', () => {
    fs.symlinkSync(outside, path.join(ws, 'results'));
    const inside = userFile(root, path.join(ws, 'results', 'r.txt'));
    expect(inside.scope).toBe('workspace');
    expect(expectUnsafe(() => inside.open(inside.path, O_WRONLY | O_CREAT), 'symlink').scope).toBe('workspace');

    const leaf = path.join(outside, 'r.txt');
    fs.symlinkSync(canaryFile, leaf);
    const out = userFile(root, leaf);
    expect(out).toMatchObject({ path: leaf });
    expect(expectUnsafe(() => out.open(out.path, O_WRONLY | O_CREAT), 'symlink').scope).toBe('path');
    expect(snapshot(outside)).toEqual({ 'r.txt': CANARY, 'secret.txt': CANARY });
  });
});

// #362: a path inside the project but outside the workspace (`reports/r.xml`,
// with `reports` a committed link to anywhere) gets the project walk, worded
// in the 'path' scope. Only a path outside the project is the user's own call.
describe('inProject / userPath scopes (#362)', () => {
  it('classifies a workspace, a project and an outside path', () => {
    const elsewhere = path.join(outside, 'r.xml');
    expect(userPath(root, path.join(ws, 'reports', 'r.xml'))).toEqual({
      path: path.join(ws, 'reports', 'r.xml'),
      scope: 'workspace',
    });
    expect(userPath(root, path.join(root, 'reports', 'r.xml'))).toEqual({
      path: path.join(root, 'reports', 'r.xml'),
      scope: 'path',
    });
    expect(userPath(root, root)).toMatchObject({ path: root, scope: 'path' });
    expect(userPath(root, elsewhere)).toEqual({ path: elsewhere, scope: 'outside' });
  });

  it('inProject keeps a lexical project path and is null outside the project', () => {
    expect(inProject(root, path.join(root, 'reports', 'r.xml'))).toBe(path.join(root, 'reports', 'r.xml'));
    expect(inProject(root, path.join(ws, 'a'))).toBe(path.join(ws, 'a'));
    expect(inProject(root, path.join(outside, 'r.xml'))).toBeNull();
    expect(inProject(root, path.join(base, 'r.xml'))).toBeNull();
  });

  it('re-roots a project path reached through a symlinked parent onto the real root', () => {
    const { realRoot, alias } = aliasedRoot(base, root);
    expect(inProject(realRoot, path.join(alias, 'reports', 'r.xml'))).toBe(path.join(realRoot, 'reports', 'r.xml'));
    expect(userPath(realRoot, path.join(alias, 'reports', 'r.xml'))).toEqual({
      path: path.join(realRoot, 'reports', 'r.xml'),
      scope: 'path',
    });
  });
});

// crash get --out's directory must already exist outside the project, so its
// open must create none there: an option of userFile, not a caller-swapped open.
describe('userFile mkdirOutside', () => {
  it('makes a missing directory outside the project by default, and none when false', () => {
    const made = path.join(outside, 'made', 'r.txt');
    fs.closeSync(userFile(root, made).open(made, O_WRONLY | O_CREAT));
    expect(fs.existsSync(made)).toBe(true);

    const notMade = path.join(outside, 'not-made', 'r.txt');
    const t = userFile(root, notMade, { mkdirOutside: false });
    expect(() => t.open(notMade, O_WRONLY | O_CREAT)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
    expect(fs.existsSync(path.dirname(notMade))).toBe(false);
  });

  it('leaves a confined scope creating its directories through the walk', () => {
    const inWs = path.join(ws, 'new-dir', 'r.txt');
    const t = userFile(root, inWs, { mkdirOutside: false });
    fs.closeSync(t.open(t.path, O_WRONLY | O_CREAT));
    expect(fs.existsSync(inWs)).toBe(true);
  });
});

describe('userFile in the project, outside the workspace (#362)', () => {
  const reports = () => path.join(root, 'reports');
  const openIn = (t) => t.open(t.path, O_WRONLY | O_CREAT);

  it('refuses a linked reports/ (symlink, path scope), the outside untouched', () => {
    fs.symlinkSync(outside, reports());
    const before = snapshot(outside);
    const t = userFile(root, path.join(reports(), 'r.xml'));
    expect(t.scope).toBe('path');
    const err = expectUnsafe(() => openIn(t), 'symlink');
    expect(err.kind).toBe('environment');
    expect(err.scope).toBe('path');
    expect(err.message).toMatch(/^Refusing to use path /);
    expect(err.message).not.toContain(outside);
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a nested link (reports/sub -> outside)', () => {
    fs.mkdirSync(reports());
    fs.symlinkSync(outside, path.join(reports(), 'sub'));
    const before = snapshot(outside);
    const t = userFile(root, path.join(reports(), 'sub', 'r.xml'));
    expect(expectUnsafe(() => openIn(t), 'symlink').scope).toBe('path');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a world-writable directory', () => {
    fs.mkdirSync(reports());
    fs.chmodSync(reports(), 0o777);
    const t = userFile(root, path.join(reports(), 'r.xml'));
    expect(expectUnsafe(() => openIn(t), 'world_writable').scope).toBe('path');
    expect(fs.readdirSync(reports())).toEqual([]);
  });

  it('refuses a foreign-owned directory; MAUTO_TRUST_WORKSPACE_OWNER=1 skips the owner check only', () => {
    fs.mkdirSync(reports());
    const file = path.join(reports(), 'r.xml');
    expect(expectUnsafe(() => openIn(userFile(root, file, {}, { fs: foreignAt(reports()) })), 'foreign_owner').scope).toBe(
      'path'
    );
    const trusted = userFile(root, file, {}, { fs: foreignAt(reports()), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } });
    fs.closeSync(openIn(trusted));
    expect(fs.existsSync(file)).toBe(true);

    const linked = path.join(root, 'linked');
    fs.symlinkSync(outside, linked);
    const t = userFile(root, path.join(linked, 'r.xml'), { env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } });
    expectUnsafe(() => openIn(t), 'symlink');
  });

  it('a plain reports/ works, its missing directories created by an O_CREAT open', () => {
    const file = path.join(reports(), 'deep', 'r.xml');
    const t = userFile(root, file);
    const fd = openIn(t);
    fs.writeSync(fd, '<x/>');
    fs.closeSync(fd);
    expect(fs.lstatSync(path.join(reports(), 'deep')).isDirectory()).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('<x/>');
  });

  it('preflight creates nothing and refuses a link, in every scope', () => {
    userFile(root, path.join(reports(), 'deep', 'r.xml')).preflight();
    expect(fs.existsSync(reports())).toBe(false);

    fs.symlinkSync(outside, reports());
    expect(expectUnsafe(() => userFile(root, path.join(reports(), 'r.xml')).preflight(), 'symlink').scope).toBe('path');

    fs.symlinkSync(outside, path.join(ws, 'results'));
    expect(
      expectUnsafe(() => userFile(root, path.join(ws, 'results', 'r.xml')).preflight(), 'symlink').scope
    ).toBe('workspace');
    userFile(root, path.join(ws, 'absent', 'r.xml')).preflight();
    expect(fs.existsSync(path.join(ws, 'absent'))).toBe(false);

    const out = path.join(outside, 'none', 'r.xml');
    userFile(root, out).preflight();
    expect(fs.existsSync(path.dirname(out))).toBe(false);
  });

  it('an outside path is unchanged: a linked directory there is the user\'s call', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-elsewhere-'));
    try {
      const link = path.join(elsewhere, 'link');
      fs.symlinkSync(outside, link);
      const t = userFile(root, path.join(link, 'r.xml'));
      expect(t.scope).toBe('outside');
      t.preflight();
      fs.closeSync(openIn(t));
      expect(fs.existsSync(path.join(outside, 'r.xml'))).toBe(true);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('userDest in the project, outside the workspace (#362)', () => {
  const reports = () => path.join(root, 'reports');

  it('refuses a linked reports/ (symlink, path scope), the outside untouched', () => {
    fs.symlinkSync(outside, reports());
    const before = snapshot(outside);
    const err = expectUnsafe(() => userDest(root, path.join(reports(), 'a.png')), 'symlink');
    expect(err.scope).toBe('path');
    expect(err.kind).toBe('environment');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a symlink leaf, a non-regular leaf and a foreign-owned directory', () => {
    fs.mkdirSync(reports());
    fs.symlinkSync(canaryFile, path.join(reports(), 'a.png'));
    expect(expectUnsafe(() => userDest(root, path.join(reports(), 'a.png')), 'symlink').scope).toBe('path');
    fs.mkdirSync(path.join(reports(), 'b.png'));
    expectUnsafe(() => userDest(root, path.join(reports(), 'b.png')), 'not_regular');
    expectUnsafe(() => userDest(root, path.join(reports(), 'c.png'), { fs: foreignAt(reports()) }), 'foreign_owner');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('a plain directory works; a missing one is not created', () => {
    fs.mkdirSync(reports());
    expect(userDest(root, path.join(reports(), 'a.png'))).toBe(path.join(reports(), 'a.png'));
    const missing = path.join(root, 'shots', 'deep', 'a.png');
    expect(userDest(root, missing)).toBe(missing);
    expect(fs.existsSync(path.join(root, 'shots'))).toBe(false);
  });

  it('an explicit path outside the project is returned byte-for-byte, nothing checked or made', () => {
    const given = path.join(outside, 'deeper', 'a.png');
    expect(userDest(root, given)).toBe(given);
    expect(fs.existsSync(path.dirname(given))).toBe(false);
  });
});

describe('safeWorkspaceDest', () => {
  it('creates the missing directories, not the leaf, and returns the resolved path', () => {
    const p = path.join(ws, 'screenshots', 'run-1', 'a.png');
    expect(safeWorkspaceDest(root, p)).toBe(p);
    expect(fs.lstatSync(path.join(ws, 'screenshots')).isDirectory()).toBe(true);
    expect(fs.lstatSync(path.join(ws, 'screenshots', 'run-1')).isDirectory()).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('accepts an existing regular leaf', () => {
    const p = path.join(ws, 'a.png');
    fs.writeFileSync(p, 'png');
    expect(safeWorkspaceDest(root, p)).toBe(p);
    expect(fs.readFileSync(p, 'utf8')).toBe('png');
  });

  it('refuses a symlinked parent dir (symlink), creating nothing outside', () => {
    fs.symlinkSync(outside, path.join(ws, 'screenshots'));
    const before = snapshot(outside);
    const err = expectUnsafe(() => safeWorkspaceDest(root, path.join(ws, 'screenshots', 'run-1', 'a.png')), 'symlink');
    expect(err.scope).toBe('workspace');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a symlink leaf (symlink), leaving its target untouched', () => {
    const p = path.join(ws, 'a.png');
    fs.symlinkSync(canaryFile, p);
    expectUnsafe(() => safeWorkspaceDest(root, p), 'symlink');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('refuses a dangling symlink leaf (symlink), creating no target', () => {
    const target = path.join(outside, 'planted.png');
    const p = path.join(ws, 'a.png');
    fs.symlinkSync(target, p);
    expectUnsafe(() => safeWorkspaceDest(root, p), 'symlink');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses a directory or a FIFO leaf (not_regular)', () => {
    fs.mkdirSync(path.join(ws, 'a.png'));
    expectUnsafe(() => safeWorkspaceDest(root, path.join(ws, 'a.png')), 'not_regular');
    const fifo = path.join(ws, 'b.png');
    if (makeFifo(fifo)) expectUnsafe(() => safeWorkspaceDest(root, fifo), 'not_regular');
  });

  it('refuses a hard-linked leaf (hardlink), leaving it intact', () => {
    const p = path.join(ws, 'a.png');
    fs.linkSync(canaryFile, p);
    expectUnsafe(() => safeWorkspaceDest(root, p), 'hardlink');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('refuses a foreign-owned leaf (foreign_owner), unless MAUTO_TRUST_WORKSPACE_OWNER=1', () => {
    const p = path.join(ws, 'a.png');
    fs.writeFileSync(p, 'png');
    expectUnsafe(() => safeWorkspaceDest(root, p, { fs: foreignAt(p) }), 'foreign_owner');
    expect(safeWorkspaceDest(root, p, { fs: foreignAt(p), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } })).toBe(p);
  });

  it('refuses a destination outside the workspace (escape)', () => {
    expectUnsafe(() => safeWorkspaceDest(root, path.join(root, 'shots', 'a.png')), 'escape');
    expect(fs.existsSync(path.join(root, 'shots'))).toBe(false);
  });
});


// Containment is lexical on resolved paths. The filesystem root is the one
// parent that already ends in a separator, so `parent + sep` would be `//` and
// nothing would be inside it (#347: the crash --out home rule asks whether a
// project root of `/` contains the home directory).
describe('isInside', () => {
  test.each([
    ['/a/b', '/a', true],
    ['/a', '/a', true],
    ['/ab', '/a', false],
    ['/a', '/a/b', false],
    ['/home/u', '/', true],
    ['/', '/', true],
  ])('isInside(%s, %s) is %s', (child, parent, expected) => {
    expect(isInside(child, parent)).toBe(expected);
  });
});
