'use strict';

// safe-fs's generic primitives for a caller with its own rules: dirPolicy,
// checkDir (one directory) and safeDir's policy for its last component. Every policy here is the test's
// own, so these pin the primitives, not any caller's policy; the device
// session's policies built on them (#346) are in
// tests/unit/device/session-dir.test.js. The fixture is
// tests/helpers/safe-fs-fixture.js.

const fs = require('fs');
const path = require('path');

const {
  UnsafePathError,
  WORKSPACE_DIR,
  dirPolicy,
  checkDir,
  safeDir,
} = require('../../../src/workspace/safe-fs');
const {
  REAL_UID,
  FOREIGN_UID,
  itNotRoot,
  makeFixture,
  snapshot,
  expectUnsafe,
  foreignFs,
} = require('../../helpers/safe-fs-fixture');

// A 0700-tight workspace directory: the override still applies.
const PRIVATE_IN_WS = dirPolicy({ ...WORKSPACE_DIR, forbiddenBits: 0o077, modeReason: 'not_private' });
// A 0700-tight directory with wording of its own and no override.
const STRICT = dirPolicy({
  subject: 'test directory',
  hints: { symlink: 'strict symlink hint' },
  fallbackHint: 'strict fallback hint',
  trustOverride: false,
  forbiddenBits: 0o077,
  modeReason: 'not_private',
});
const OVERRIDE = { MAUTO_TRUST_WORKSPACE_OWNER: '1' };

let base;
let root;
let ws;
let outside;

beforeEach(() => {
  ({ base, root, ws, outside } = makeFixture());
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('dirPolicy', () => {
  const full = {
    subject: 's',
    hints: {},
    fallbackHint: 'h',
    trustOverride: false,
    forbiddenBits: 0o077,
    modeReason: 'not_private',
  };

  it.each(Object.keys(full))('refuses a policy missing %s', (key) => {
    const partial = { ...full };
    delete partial[key];
    expect(() => dirPolicy(partial)).toThrow(new RegExp(`missing ${key}`));
  });

  it('refuses a trustOverride that is not a boolean', () => {
    expect(() => dirPolicy({ ...full, trustOverride: 1 })).toThrow(/boolean/);
  });

  it('refuses an unknown modeReason', () => {
    expect(() => dirPolicy({ ...full, modeReason: 'mystery' })).toThrow(/modeReason/);
  });

  it('is frozen, hints included, and drops unknown fields', () => {
    const p = dirPolicy({ ...full, extra: true });
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.hints)).toBe(true);
    expect(p).not.toHaveProperty('extra');
  });
});

// The last component of a workspace walk under the caller's policy; every
// component above it stays a WORKSPACE_DIR.
describe('safeDir with a policy for its last component', () => {
  let d;
  beforeEach(() => {
    d = path.join(ws, 'private');
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o700);
  });

  it('accepts a 0700 target under a group-writable workspace (only the last component is held to it)', () => {
    fs.chmodSync(ws, 0o775);
    expect(safeDir(root, d, { policy: PRIVATE_IN_WS })).toBe(fs.realpathSync(d));
  });

  it('the components above it stay workspace directories: a world-writable one is world_writable', () => {
    fs.chmodSync(ws, 0o777);
    expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_IN_WS }), 'world_writable');
  });

  it.each([['0755', 0o755], ['0750', 0o750], ['0705', 0o705], ['0701', 0o701]])(
    'refuses a target at %s with the policy modeReason',
    (_label, mode) => {
      fs.chmodSync(d, mode);
      const err = expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_IN_WS }), 'not_private');
      expect(err.path).toBe(d);
    }
  );

  it('under the default policy, the same 0755 and g+w targets are still accepted', () => {
    for (const mode of [0o755, 0o775]) {
      fs.chmodSync(d, mode);
      expect(safeDir(root, d)).toBe(fs.realpathSync(d));
    }
  });

  it('a policy with trustOverride honours MAUTO_TRUST_WORKSPACE_OWNER=1 for a foreign target', () => {
    expect(safeDir(root, d, { policy: PRIVATE_IN_WS }, { fs: foreignFs(['lstatSync']), env: OVERRIDE })).toBe(
      fs.realpathSync(d)
    );
    expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_IN_WS }, { fs: foreignFs(['lstatSync']) }), 'foreign_owner');
  });

  it('the override never loosens the mode check', () => {
    fs.chmodSync(d, 0o750);
    const deps = { fs: foreignFs(['lstatSync']), env: OVERRIDE };
    expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_IN_WS }, deps), 'not_private');
  });

  itNotRoot('create + mode 0o700 makes a target the policy accepts under umask 022', () => {
    const fresh = path.join(ws, 'fresh');
    const umask = process.umask(0o022);
    try {
      safeDir(root, fresh, { create: true, mode: 0o700, policy: PRIVATE_IN_WS });
    } finally {
      process.umask(umask);
    }
    expect(fs.lstatSync(fresh).mode & 0o777).toBe(0o700);
  });
});

// One directory, with no workspace around it.
describe('checkDir', () => {
  let dir;
  beforeEach(() => {
    dir = path.join(base, 'onedir');
  });

  itNotRoot('create: true makes it with the given mode, even under umask 022', () => {
    const umask = process.umask(0o022);
    try {
      expect(checkDir(dir, STRICT, { create: true, mode: 0o700 })).toBeUndefined();
    } finally {
      process.umask(umask);
    }
    const st = fs.lstatSync(dir);
    expect(st.isDirectory()).toBe(true);
    expect(st.mode & 0o777).toBe(0o700);
  });

  it('accepts an existing directory the policy allows, without create', () => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o700);
    expect(() => checkDir(dir, STRICT)).not.toThrow();
  });

  it('without create, a missing dir throws the plain ENOENT error and creates nothing', () => {
    let caught;
    try {
      checkDir(dir, STRICT);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(UnsafePathError);
    expect(caught.code).toBe('ENOENT');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('creates only the last level: a missing parent is not made', () => {
    const deep = path.join(base, 'missing-parent', 'onedir');
    let caught;
    try {
      checkDir(deep, STRICT, { create: true, mode: 0o700 });
    } catch (err) {
      caught = err;
    }
    expect(caught.code).toBe('ENOENT');
    expect(fs.existsSync(path.join(base, 'missing-parent'))).toBe(false);
  });

  it('refuses a symlink to an acceptable directory (symlink), creating nothing there', () => {
    fs.chmodSync(outside, 0o700);
    fs.symlinkSync(outside, dir);
    const before = snapshot(outside);
    expectUnsafe(() => checkDir(dir, STRICT, { create: true, mode: 0o700 }), 'symlink');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a regular file (not_directory)', () => {
    fs.writeFileSync(dir, 'x');
    expectUnsafe(() => checkDir(dir, STRICT, { create: true }), 'not_directory');
  });

  it('a policy without trustOverride refuses a foreign dir even with MAUTO_TRUST_WORKSPACE_OWNER=1', () => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o700);
    expectUnsafe(() => checkDir(dir, STRICT, {}, { fs: foreignFs(['lstatSync']), env: OVERRIDE }), 'foreign_owner');
  });

  it('a policy with trustOverride accepts that foreign dir under the override', () => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o700);
    expect(() => checkDir(dir, PRIVATE_IN_WS, {}, { fs: foreignFs(['lstatSync']), env: OVERRIDE })).not.toThrow();
  });

  it.each([['0755', 0o755], ['0750', 0o750], ['0705', 0o705], ['0777', 0o777]])(
    'refuses an existing dir of ours at %s, never chmodding it',
    (_label, mode) => {
      fs.mkdirSync(dir);
      fs.chmodSync(dir, mode);
      expectUnsafe(() => checkDir(dir, STRICT, { create: true, mode: 0o700 }), 'not_private');
      expect(fs.lstatSync(dir).mode & 0o777).toBe(mode);
    }
  );

  it('tolerates a mkdir race (EEXIST) and checks what is there', () => {
    const racing = { ...fs };
    racing.mkdirSync = (p, opts) => {
      fs.mkdirSync(p, opts);
      fs.chmodSync(p, 0o700);
      throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    };
    expect(() => checkDir(dir, STRICT, { create: true, mode: 0o700 }, { fs: racing })).not.toThrow();
  });

  it('a mkdir race that plants a symlink is refused', () => {
    const racing = { ...fs };
    racing.mkdirSync = (p) => {
      fs.symlinkSync(outside, p);
      throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    };
    expectUnsafe(() => checkDir(dir, STRICT, { create: true, mode: 0o700 }, { fs: racing }), 'symlink');
  });
});

// A refusal takes all of its wording from the policy it was refused under.
describe('a refusal is worded by its policy', () => {
  let dir;
  beforeEach(() => {
    dir = path.join(base, 'onedir');
  });

  it("names the policy's subject and uses its hint for the reason", () => {
    fs.symlinkSync(outside, dir);
    const err = expectUnsafe(() => checkDir(dir, STRICT), 'symlink');
    expect(err.message).toBe(`Refusing to use test directory ${dir}: it is a symbolic link (symlink).`);
    expect(err.hint).toBe('strict symlink hint');
    expect(err.kind).toBe('environment');
    expect(err.path).toBe(dir);
  });

  it("falls back to the policy's fallbackHint for a reason it has no hint for", () => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o755);
    expect(expectUnsafe(() => checkDir(dir, STRICT), 'not_private').hint).toBe('strict fallback hint');
  });

  it('a foreign owner names both uids, under the policy subject', () => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o700);
    const err = expectUnsafe(() => checkDir(dir, STRICT, {}, { fs: foreignFs(['lstatSync']) }), 'foreign_owner');
    expect(err.message).toBe(
      `Refusing to use test directory ${dir}: it is owned by uid ${FOREIGN_UID}; you are uid ${REAL_UID} (foreign_owner).`
    );
    expect(err.hint).toBe('strict fallback hint');
  });

  it('a workspace refusal keeps the workspace wording and hints', () => {
    const err = expectUnsafe(() => safeDir(root, ws, {}, { getuid: () => REAL_UID + 1 }), 'foreign_owner');
    expect(err.message.startsWith(`Refusing to use workspace path ${ws}: `)).toBe(true);
    expect(err.hint).toContain('MAUTO_TRUST_WORKSPACE_OWNER=1');
  });
});
