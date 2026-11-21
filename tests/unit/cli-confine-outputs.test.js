'use strict';

// #347, end to end through buildProgram: the verbs that write a file the
// caller named. A cloned repo can commit a link anywhere in
// .mobile-automator/, so a path that lands there gets the workspace rules and
// a refusal is one `environment` envelope with the refusal's own hint. A path
// anywhere else keeps the verb's own rule.

const fs = require('fs');
const path = require('path');

const { CANARY, tmpDir, snapshot, fixture, runIn } = require('../helpers/workspace-safety');

const REPORT = 'FATAL EXCEPTION: main\n  at com.acme.Boom.run(Boom.java:1)';

// A device factory whose bridge records every crash id it is asked for.
function crashFactory() {
  const asked = [];
  const factory = async () => ({
    bridge: {
      getCrash: async (id) => {
        asked.push(id);
        return REPORT;
      },
    },
    close: async () => {},
  });
  return { asked, factory };
}

// `.mobile-automator/crash.txt` planted as a link to an outside file that
// already holds the canary.
function plantCrashLeaf(ws, outside) {
  fs.writeFileSync(path.join(outside, 'target.txt'), CANARY);
  fs.symlinkSync(path.join(outside, 'target.txt'), path.join(ws, 'crash.txt'));
}

function expectRefused({ calls, written }, refusedPath) {
  expect(calls).toHaveLength(1);
  const [r] = calls;
  expect(r.exitKind).toBe('environment');
  expect(r.envelope.ok).toBe(false);
  expect(r.envelope.error.kind).toBe('environment');
  expect(r.envelope.error.message).toMatch(/^Refusing to use workspace path /);
  expect(r.envelope.error.message).toContain(refusedPath);
  // The refusal's own hint, not the generic filesystem one.
  expect(r.envelope.hint).toMatch(/never follows links/);
  expect(JSON.stringify(calls)).not.toContain(CANARY);
  expect(written).not.toContain(CANARY);
}

describe('crash get --out confines a workspace destination (#347)', () => {
  test('--out .mobile-automator/crash.txt that links to an outside file fails environment, the file unchanged', async () => {
    const { root, ws, outside } = fixture(plantCrashLeaf);
    const before = snapshot(outside);
    const { factory } = crashFactory();

    const out = await runIn(root, ['crash', 'get', 'r1', '--out', '.mobile-automator/crash.txt'], {
      deviceBridgeFactory: factory,
    });

    expectRefused(out, path.join(ws, 'crash.txt'));
    expect(snapshot(outside)).toEqual(before);
  });

  test('the same plant reached through an alias of the project root is refused the same way', async () => {
    const { root, ws, outside } = fixture(plantCrashLeaf);
    const before = snapshot(outside);
    const alias = path.join(tmpDir('mauto-cli-alias-'), 'project');
    fs.symlinkSync(root, alias);
    const { factory } = crashFactory();

    const out = await runIn(
      root,
      ['crash', 'get', 'r1', '--out', path.join(alias, '.mobile-automator', 'crash.txt')],
      { deviceBridgeFactory: factory }
    );

    expectRefused(out, path.join(ws, 'crash.txt'));
    expect(snapshot(outside)).toEqual(before);
  });

  test('a clean workspace destination is written whole', async () => {
    const { root, ws } = fixture(() => {});
    const { asked, factory } = crashFactory();

    const { calls } = await runIn(root, ['crash', 'get', 'r1', '--out', '.mobile-automator/crashes/r1.txt'], {
      deviceBridgeFactory: factory,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('ok');
    expect(calls[0].envelope.data).toEqual({ crash_id: 'r1', path: '.mobile-automator/crashes/r1.txt', truncated: false });
    expect(asked).toEqual(['r1']);
    expect(fs.readFileSync(path.join(ws, 'crashes', 'r1.txt'), 'utf8')).toBe(REPORT);
  });
});
