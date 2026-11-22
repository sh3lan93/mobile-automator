'use strict';

// safe-fs for project files outside the workspace (#347): readProjectFile and
// createProjectFile (the host files `mauto init` writes), bounded by the
// project root, and UnsafePathError's 'path' scope wording. Fixture:
// tests/helpers/safe-fs-fixture.js.

const fs = require('fs');
const path = require('path');

const {
  UnsafePathError,
  readProjectFile,
  createProjectFile,
} = require('../../../src/workspace/safe-fs');
const {
  makeSafeFsFixture,
  removeSafeFsFixture,
  CANARY,
  snapshot,
  expectUnsafe,
  foreignFs,
  foreignAt,
  aliasedRoot,
} = require('../../helpers/safe-fs-fixture');

let base;
let root;
let outside;
let canaryFile;

beforeEach(() => {
  ({ base, root, outside, canaryFile } = makeSafeFsFixture());
});

afterEach(() => {
  removeSafeFsFixture(base);
});

describe('readProjectFile', () => {
  it('reads a project file below the root and one at the root', () => {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"a":1}');
    fs.writeFileSync(path.join(root, '.mcp.json'), '{"b":2}');
    expect(readProjectFile(root, path.join(root, '.claude', 'settings.json'))).toBe('{"a":1}');
    expect(readProjectFile(root, path.join(root, '.mcp.json'))).toBe('{"b":2}');
  });

  it('is null for an absent file and an absent parent dir, creating nothing', () => {
    expect(readProjectFile(root, path.join(root, '.mcp.json'))).toBeNull();
    expect(readProjectFile(root, path.join(root, '.claude', 'skills', 'x', 'SKILL.md'))).toBeNull();
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
  });

  it('refuses a symlinked parent dir (symlink) in the path scope, never reading through it', () => {
    fs.symlinkSync(outside, path.join(root, '.claude'));
    const err = expectUnsafe(() => readProjectFile(root, path.join(root, '.claude', 'secret.txt')), 'symlink');
    expect(err.scope).toBe('path');
    expect(err.message.startsWith('Refusing to use path ')).toBe(true);
    expect(err.message).not.toContain(CANARY);
    expect(err.path).toBe(path.join(root, '.claude'));
  });

  it('refuses a symlinked component deeper down (symlink)', () => {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.symlinkSync(outside, path.join(root, '.claude', 'skills'));
    expectUnsafe(() => readProjectFile(root, path.join(root, '.claude', 'skills', 'secret.txt')), 'symlink');
  });

  it('refuses a symlink leaf (symlink) in the path scope', () => {
    fs.symlinkSync(canaryFile, path.join(root, '.mcp.json'));
    const err = expectUnsafe(() => readProjectFile(root, path.join(root, '.mcp.json')), 'symlink');
    expect(err.scope).toBe('path');
  });

  it('refuses a dangling symlink leaf (symlink), never reading it as absent', () => {
    fs.symlinkSync(path.join(outside, 'gone.json'), path.join(root, '.mcp.json'));
    expectUnsafe(() => readProjectFile(root, path.join(root, '.mcp.json')), 'symlink');
  });

  it('refuses a path outside the project (escape) in the path scope', () => {
    const err = expectUnsafe(() => readProjectFile(root, canaryFile), 'escape');
    expect(err.scope).toBe('path');
    expect(err.message).toMatch(/outside the project directory/);
  });

  it('refuses a file over maxBytes (too_large)', () => {
    fs.writeFileSync(path.join(root, 'big.md'), 'x'.repeat(11));
    expectUnsafe(() => readProjectFile(root, path.join(root, 'big.md'), { maxBytes: 10 }), 'too_large');
    expect(readProjectFile(root, path.join(root, 'big.md'), { maxBytes: 11 })).toBe('x'.repeat(11));
  });

  it('refuses a foreign-owned leaf or component (foreign_owner)', () => {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}');
    const file = path.join(root, '.claude', 'settings.json');
    expectUnsafe(() => readProjectFile(root, file, {}, { fs: foreignFs(['fstatSync']) }), 'foreign_owner');
    expectUnsafe(() => readProjectFile(root, file, {}, { fs: foreignAt(path.join(root, '.claude')) }), 'foreign_owner');
  });

  it('accepts a project root reached through a symlinked parent', () => {
    const { alias } = aliasedRoot(base, root);
    fs.writeFileSync(path.join(root, '.mcp.json'), '{}');
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"c":3}');
    expect(readProjectFile(alias, path.join(alias, '.mcp.json'))).toBe('{}');
    expect(readProjectFile(alias, path.join(alias, '.claude', 'settings.json'))).toBe('{"c":3}');
  });

  it('never checks the project root itself or its ancestors', () => {
    fs.writeFileSync(path.join(root, '.mcp.json'), '{}');
    fs.chmodSync(base, 0o777);
    fs.chmodSync(root, 0o777);
    try {
      expect(readProjectFile(root, path.join(root, '.mcp.json'), {}, { fs: foreignAt(root) })).toBe('{}');
    } finally {
      fs.chmodSync(root, 0o755);
      fs.chmodSync(base, 0o700);
    }
  });

  it('closes the fd it opened, on success and on refusal', () => {
    fs.writeFileSync(path.join(root, 'a.md'), 'a');
    fs.writeFileSync(path.join(root, 'big.md'), 'x'.repeat(11));
    const opened = [];
    const closed = [];
    const tracking = { ...fs };
    tracking.openSync = (...args) => {
      const fd = fs.openSync(...args);
      opened.push(fd);
      return fd;
    };
    tracking.closeSync = (fd) => (closed.push(fd), fs.closeSync(fd));
    readProjectFile(root, path.join(root, 'a.md'), {}, { fs: tracking });
    expectUnsafe(() => readProjectFile(root, path.join(root, 'big.md'), { maxBytes: 10 }, { fs: tracking }), 'too_large');
    expect(opened).toHaveLength(2);
    expect(closed.sort()).toEqual(opened.sort());
  });
});

describe('createProjectFile', () => {
  it('creates the file under missing dirs below the root, each one a real directory', () => {
    const p = path.join(root, '.claude', 'skills', 'mobile-automator-execute', 'SKILL.md');
    const fd = createProjectFile(root, p);
    fs.writeSync(fd, 'ok');
    fs.closeSync(fd);
    expect(fs.readFileSync(p, 'utf8')).toBe('ok');
    for (const d of ['.claude', path.join('.claude', 'skills'), path.join('.claude', 'skills', 'mobile-automator-execute')]) {
      expect(fs.lstatSync(path.join(root, d)).isDirectory()).toBe(true);
    }
  });

  it('creates a file at the project root itself', () => {
    const p = path.join(root, '.mcp.json');
    fs.closeSync(createProjectFile(root, p));
    expect(fs.lstatSync(p).isFile()).toBe(true);
  });

  it.each([
    ['the first component', ['.claude']],
    ['a deeper component', ['.claude', 'skills']],
  ])('refuses %s as a symlink (symlink), creating nothing outside', (_label, parts) => {
    if (parts.length > 1) fs.mkdirSync(path.join(root, ...parts.slice(0, -1)), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ...parts));
    const before = snapshot(outside);
    const err = expectUnsafe(() => createProjectFile(root, path.join(root, '.claude', 'skills', 'x', 'SKILL.md')), 'symlink');
    expect(err.scope).toBe('path');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a path outside the project (escape), creating nothing there', () => {
    const before = snapshot(outside);
    expectUnsafe(() => createProjectFile(root, path.join(root, '..', 'outside', 'new', 'x.md')), 'escape');
    expect(snapshot(outside)).toEqual(before);
  });

  it('is exclusive: an existing file or a dangling link fails EEXIST, untouched', () => {
    const p = path.join(root, '.mcp.json');
    fs.writeFileSync(p, 'held');
    let caught;
    try {
      createProjectFile(root, p);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(UnsafePathError);
    expect(caught.code).toBe('EEXIST');
    expect(fs.readFileSync(p, 'utf8')).toBe('held');

    const target = path.join(outside, 'planted.md');
    const link = path.join(root, 'AGENTS.md');
    fs.symlinkSync(target, link);
    caught = undefined;
    try {
      createProjectFile(root, link);
    } catch (err) {
      caught = err;
    }
    expect(caught.code).toBe('EEXIST');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('honours mode (0o600 under umask 022)', () => {
    const umask = process.umask(0o022);
    try {
      const p = path.join(root, '.claude', 'x.tmp');
      fs.closeSync(createProjectFile(root, p, { mode: 0o600 }));
      expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(umask);
    }
  });

  it('refuses a foreign-owned new leaf in the path scope, with the path hint', () => {
    const p = path.join(root, '.mcp.json');
    const err = expectUnsafe(() => createProjectFile(root, p, {}, { fs: foreignFs(['fstatSync']) }), 'foreign_owner');
    expect(err.scope).toBe('path');
    expect(err.hint).toMatch(/^Files mauto writes must belong/);
  });
});

describe('UnsafePathError in the path scope (a project file, a user-chosen file)', () => {
  const scoped = (reason) => new UnsafePathError('/p/.claude/skills', reason, { scope: 'path' });

  it('escape names the project directory, not the workspace', () => {
    const err = scoped('escape');
    expect(err.scope).toBe('path');
    expect(err.kind).toBe('environment');
    expect(err.code).toBe('EUNSAFEPATH');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it resolves outside the project directory (escape).');
    expect(err.hint).toBe(
      'mauto only writes inside the project directory. Replace any link on the way with a real directory inside the project.'
    );
  });

  it('symlink keeps the shared reason text, with a path hint', () => {
    const err = scoped('symlink');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it is a symbolic link (symlink).');
    expect(err.hint).toBe(
      'mauto never writes through a symbolic link. Replace the link with a real directory or file, then re-run.'
    );
  });

  it('foreign_owner keeps the escape hatch in a path hint', () => {
    const err = scoped('foreign_owner');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it is owned by another user (foreign_owner).');
    expect(err.hint).toBe(
      'Files mauto writes must belong to the user running mauto. Fix the ownership (chown), or set MAUTO_TRUST_WORKSPACE_OWNER=1 if you trust this checkout (for example a CI container running as root); it skips only the owner check.'
    );
  });

  it('a reason with no path override falls back to the shared text and hint', () => {
    const err = scoped('world_writable');
    const shared = new UnsafePathError('/p/.claude/skills', 'world_writable');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it is writable by every user (world_writable).');
    expect(err.hint).toBe(shared.hint);
  });

  it.each(['hardlink', 'too_large', 'mystery', 'escape', 'symlink', 'foreign_owner'])(
    'no %s hint in the path scope claims the file is in the workspace',
    (reason) => {
      // The escape hatch's variable name is the one mention allowed.
      const hint = scoped(reason).hint.replace('MAUTO_TRUST_WORKSPACE_OWNER', '');
      expect(hint).not.toMatch(/workspace|\.mobile-automator/i);
    }
  );
});
