'use strict';

// buildProgram's workspace wiring (#188), in-process: which verbs require a
// discovered workspace, which tolerate its absence, and where the creating
// verbs write. The spawned end-to-end reproduction lives in
// tests/integration/cli-workspace-discovery.test.js.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildProgram } = require('../../src/cli');

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-cli-ws-')));
}

// Emitters double: captures both the envelope path and the raw-content path
// (guide/schema/bootstrap/memory show) without ending the test process.
function captureEmitters() {
  const calls = [];
  return {
    calls,
    emitters: {
      emit: (r) => calls.push(r),
      emitRaw: (raw, exitKind) => calls.push({ raw, exitKind }),
      finish: () => {},
      setVerb: () => {},
      setRunId: () => {},
      setSessionId: () => {},
      getRunId: () => null,
      getVerb: () => null,
    },
  };
}

async function runIn({ workspace, cwd }, ...argv) {
  const { calls, emitters } = captureEmitters();
  await buildProgram({ workspace, cwd, emitters }).parseAsync(['node', 'mauto', ...argv]);
  return calls;
}

describe('buildProgram workspace wiring (#188)', () => {
  describe('no workspace discovered', () => {
    let cwd;
    let workspace;

    beforeEach(() => {
      cwd = tmpDir();
      workspace = { root: null, searched: [cwd, path.dirname(cwd)] };
    });

    test.each([
      [['config', 'get', 'mode']],
      [['config', 'set', 'app_id', 'x']],
      [['memory', 'show']],
      [['memory', 'add', 'x', '--kind', 'preferences']],
      [['memory', 'forget', '--kind', 'preferences', '--match', 'x']],
      [['result', 'add-step', '--run-id', 'r1', '--step-id', 's', '--status', 'pass']],
      [['result', 'add-assertion', '--run-id', 'r1', '--step-id', 's', '--type', 'element_visible', '--pass', 'true']],
      [['result', 'add-crash', '--run-id', 'r1', '--crash-id', 'c1']],
      [['result', 'finalize', '--run-id', 'r1']],
    ])('%j fails environment with the searched paths in the hint', async (argv) => {
      const calls = await runIn({ workspace, cwd }, ...argv);
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('environment');
      expect(calls[0].envelope.ok).toBe(false);
      expect(calls[0].envelope.error.kind).toBe('environment');
      expect(calls[0].envelope.hint).toContain(cwd);
      expect(fs.existsSync(path.join(cwd, 'mobile-automator'))).toBe(false);
    });

    test('guide is tolerant: raw content, no failure', async () => {
      const calls = await runIn({ workspace, cwd }, 'guide', 'execute');
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('ok');
      expect(typeof calls[0].raw).toBe('string');
      expect(calls[0].raw.length).toBeGreaterThan(0);
    });

    test('setup scaffolds in cwd with no ancestor hint', async () => {
      const calls = await runIn({ workspace, cwd }, 'setup');
      expect(calls[0].envelope.ok).toBe(true);
      expect(calls[0].envelope.hint).toBeUndefined();
      expect(fs.existsSync(path.join(cwd, 'mobile-automator', 'config.json'))).toBe(true);
    });
  });

  describe('workspace discovered in an ancestor', () => {
    let root;
    let sub;
    let workspace;

    beforeEach(() => {
      root = tmpDir();
      fs.mkdirSync(path.join(root, 'mobile-automator'));
      fs.writeFileSync(path.join(root, 'mobile-automator', 'config.json'), '{"mode":"platform-agnostic"}\n');
      sub = path.join(root, 'pkg');
      fs.mkdirSync(sub);
      workspace = { root, searched: [sub, root] };
    });

    test('config get reads the ancestor workspace', async () => {
      const calls = await runIn({ workspace, cwd: sub }, 'config', 'get', 'mode');
      expect(calls[0].envelope).toMatchObject({ ok: true, data: { value: 'platform-agnostic' } });
    });

    test('setup creates a nested workspace in cwd and hints at the ancestor', async () => {
      const calls = await runIn({ workspace, cwd: sub }, 'setup');
      expect(calls[0].exitKind).toBe('ok');
      expect(calls[0].envelope.ok).toBe(true);
      expect(calls[0].envelope.hint).toContain(root);
      expect(fs.existsSync(path.join(sub, 'mobile-automator', 'config.json'))).toBe(true);
    });

    test('setup in the workspace root itself carries no ancestor hint', async () => {
      const calls = await runIn({ workspace: { root, searched: [root] }, cwd: root }, 'setup');
      expect(calls[0].envelope.ok).toBe(true);
      expect(calls[0].envelope.hint).toBeUndefined();
    });
  });
});
