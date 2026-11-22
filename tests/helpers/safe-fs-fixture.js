'use strict';

// The shared fixture for the safe-fs suites (#345, #347): a real tmp tree,
// because the guarantees are about how the kernel resolves (or refuses to
// resolve) links; only "another owner" is simulated (an injected getuid or a
// wrapped fs), because jest cannot chown.
//
// Each fixture has a project root holding `.mobile-automator/` and a sibling
// `outside/` holding a canary file. A refusal must leave `outside/` exactly as
// it was and never put the canary or the outside path in an envelope.

const os = require('os');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const { UnsafePathError } = require('../../src/workspace/safe-fs');

const CANARY = 'SECRET-CANARY';
const REAL_UID = process.getuid();

// A fresh fixture: { base, root, ws, outside, canaryFile }. Remove it with
// removeSafeFsFixture(base).
function makeSafeFsFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-safefs-'));
  const root = path.join(base, 'project');
  const ws = path.join(root, '.mobile-automator');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(outside);
  const canaryFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(canaryFile, CANARY);
  return { base, root, ws, outside, canaryFile };
}

function removeSafeFsFixture(base) {
  fs.rmSync(base, { recursive: true, force: true });
}

// A snapshot of every name and byte under outside/, to prove a refusal wrote,
// created and truncated nothing there. Nested, so an empty directory created
// there shows too.
function snapshot(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    out[name] = st.isDirectory() ? snapshot(p) : fs.readFileSync(p, 'utf8');
  }
  return out;
}

function expectUnsafe(fn, reason) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(UnsafePathError);
  expect(caught.code).toBe('EUNSAFEPATH');
  expect(caught.reason).toBe(reason);
  return caught;
}

// An fs whose stat calls report another owner. `which` picks lstat (the dir
// walk), fstat (the leaf) or both.
function foreignFs(which = ['lstatSync', 'fstatSync']) {
  const wrapped = { ...fs };
  for (const name of which) {
    wrapped[name] = (...args) => {
      const st = fs[name](...args);
      st.uid = REAL_UID + 1;
      return st;
    };
  }
  return wrapped;
}

// An fs whose lstat reports another owner for one path only: the walk passes
// every other component, so the refusal (or acceptance) is that path's alone.
function foreignAt(target) {
  return {
    ...fs,
    lstatSync: (p, ...rest) => {
      const st = fs.lstatSync(p, ...rest);
      if (path.resolve(p) === path.resolve(target)) st.uid = REAL_UID + 1;
      return st;
    },
  };
}

function makeFifo(p) {
  try {
    childProcess.execFileSync('mkfifo', [p], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false; // no mkfifo on this host: nothing to test
  }
}

// A blocking open on a FIFO would freeze the event loop so jest's timeout
// could never fire; run it in a child with a hard timeout instead. `call` is
// the expression to evaluate, with the module bound to `m` and the remaining
// argv strings to `a`; the child prints the refusal reason (or fs code).
function reasonInChild(call, ...args) {
  const modulePath = require.resolve('../../src/workspace/safe-fs');
  const script = [
    'const [, mod, ...a] = process.argv; const m = require(mod);',
    `try { ${call}; process.stdout.write("null"); }`,
    'catch (e) { process.stdout.write(JSON.stringify(e.reason || e.code)); }',
  ].join('\n');
  return JSON.parse(
    childProcess.execFileSync(process.execPath, ['-e', script, modulePath, ...args], {
      encoding: 'utf8',
      timeout: 3000,
    })
  );
}

function readReasonInChild(projectRoot, file) {
  return reasonInChild('m.readWorkspaceFile(a[0], a[1])', projectRoot, file);
}

// The project root as discover reports it (process.cwd(), physical), and an
// alias for it: the logical path an agent sees after `pwd` in zsh, or macOS's
// /tmp -> /private/tmp.
function aliasedRoot(base, root) {
  const realRoot = fs.realpathSync(root);
  const alias = path.join(base, 'alias');
  fs.symlinkSync(realRoot, alias);
  return { realRoot, alias, realWs: path.join(realRoot, '.mobile-automator') };
}

module.exports = {
  CANARY,
  REAL_UID,
  makeSafeFsFixture,
  removeSafeFsFixture,
  snapshot,
  expectUnsafe,
  foreignFs,
  foreignAt,
  makeFifo,
  reasonInChild,
  readReasonInChild,
  aliasedRoot,
};
