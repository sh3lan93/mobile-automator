'use strict';

// #347, end to end through buildProgram: `mauto screenshot <path>` hands the
// path to the engine, which writes the PNG itself, so mauto never holds the
// fd. A destination inside .mobile-automator/ is checked first (a cloned repo
// can commit `screenshots/` as a link to anywhere) and a refusal is one
// `environment` envelope naming the workspace path, with the bridge never
// asked. A destination anywhere else is the user's own call and reaches the
// bridge exactly as resolved (Review Focus 5: `mauto screenshot /tmp/x.png`).

const fs = require('fs');
const path = require('path');

const { CANARY, tmpDir, snapshot, fixture, runIn } = require('../helpers/workspace-safety');

// A device factory whose bridge records every path it is asked to save to.
function recordingFactory() {
  const shots = [];
  const factory = async () => ({
    bridge: {
      screenshot: async (dest) => {
        shots.push(dest);
        return dest;
      },
    },
    close: async () => {},
  });
  return { shots, factory };
}

// `.mobile-automator/screenshots` planted as a link to the outside dir, which
// already holds a file carrying the canary.
function plantScreenshots(ws, outside) {
  fs.writeFileSync(path.join(outside, 'a.png'), CANARY);
  fs.symlinkSync(outside, path.join(ws, 'screenshots'));
}

function expectRefused({ calls, written }, ws) {
  expect(calls).toHaveLength(1);
  const [r] = calls;
  expect(r.exitKind).toBe('environment');
  expect(r.envelope.ok).toBe(false);
  expect(r.envelope.error.kind).toBe('environment');
  expect(r.envelope.error.message).toMatch(/^Refusing to use workspace path /);
  expect(r.envelope.error.message).toContain(path.join(ws, 'screenshots'));
  // The refusal's own hint, not the device one the handler's catch would give.
  expect(r.envelope.hint).toMatch(/never follows links/);
  expect(JSON.stringify(calls)).not.toContain(CANARY);
  expect(written).not.toContain(CANARY);
}

describe('screenshot confines a workspace destination (#347)', () => {
  test('screenshot .mobile-automator/screenshots/a.png with screenshots -> outside fails environment', async () => {
    const { root, ws, outside } = fixture(plantScreenshots);
    const before = snapshot(outside);
    const { shots, factory } = recordingFactory();

    const out = await runIn(root, ['screenshot', '.mobile-automator/screenshots/a.png'], { deviceBridgeFactory: factory });

    expectRefused(out, ws);
    expect(shots).toEqual([]);
    expect(snapshot(outside)).toEqual(before);
  });

  test('the same plant reached through an alias of the project root is refused the same way', async () => {
    const { root, ws, outside } = fixture(plantScreenshots);
    const before = snapshot(outside);
    const alias = path.join(tmpDir('mauto-cli-alias-'), 'project');
    fs.symlinkSync(root, alias);
    const { shots, factory } = recordingFactory();

    const out = await runIn(
      root,
      ['screenshot', path.join(alias, '.mobile-automator', 'screenshots', 'a.png')],
      { deviceBridgeFactory: factory }
    );

    expectRefused(out, ws);
    expect(shots).toEqual([]);
    expect(snapshot(outside)).toEqual(before);
  });

  test('a destination outside the project reaches the bridge exactly as given', async () => {
    const { root } = fixture(() => {});
    const elsewhere = path.join(tmpDir('mauto-cli-elsewhere-'), 'a.png');
    const { shots, factory } = recordingFactory();

    const { calls } = await runIn(root, ['screenshot', elsewhere], { deviceBridgeFactory: factory });

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('ok');
    expect(calls[0].envelope.data).toEqual({ path: elsewhere });
    expect(shots).toEqual([elsewhere]);
  });

  test('a relative in-workspace destination on a clean tree: resolved, its directory created', async () => {
    const { root, ws } = fixture(() => {});
    const { shots, factory } = recordingFactory();
    const expected = path.join(ws, 'screenshots', 'home', 'a.png');

    const { calls } = await runIn(root, ['screenshot', '.mobile-automator/screenshots/home/a.png'], {
      deviceBridgeFactory: factory,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].exitKind).toBe('ok');
    expect(shots).toEqual([expected]);
    expect(fs.lstatSync(path.dirname(expected)).isDirectory()).toBe(true);
  });
});

describe('handleScreenshot confinement (#347)', () => {
  const { handleScreenshot } = require('../../src/cli');
  const { UnsafePathError } = require('../../src/workspace/safe-fs');

  function recordingBridge() {
    const shots = [];
    return {
      shots,
      bridge: {
        screenshot: async (dest) => {
          shots.push(dest);
          return dest;
        },
      },
    };
  }

  test('a refused workspace destination throws the typed refusal before the bridge is asked', async () => {
    const { root, outside } = fixture(plantScreenshots);
    const before = snapshot(outside);
    const { shots, bridge } = recordingBridge();

    await expect(
      handleScreenshot({ deviceBridge: bridge, projectRoot: root, cwd: root }, '.mobile-automator/screenshots/a.png')
    ).rejects.toBeInstanceOf(UnsafePathError);

    expect(shots).toEqual([]);
    expect(snapshot(outside)).toEqual(before);
  });

  test('a bridge failure on a confined destination is still a device envelope', async () => {
    const { root } = fixture(() => {});
    const bridge = { screenshot: async () => { throw new Error('no device'); } };

    const { envelope, exitKind } = await handleScreenshot(
      { deviceBridge: bridge, projectRoot: root, cwd: root },
      '.mobile-automator/screenshots/a.png'
    );

    expect(exitKind).toBe('device');
    expect(envelope.error.kind).toBe('device');
  });

  test('a path outside the workspace but inside the project is passed through, no directory made', async () => {
    const { root } = fixture(() => {});
    const { shots, bridge } = recordingBridge();

    const { exitKind } = await handleScreenshot({ deviceBridge: bridge, projectRoot: root, cwd: root }, 'docs/shot.png');

    expect(exitKind).toBe('ok');
    expect(shots).toEqual([path.join(root, 'docs', 'shot.png')]);
    expect(fs.existsSync(path.join(root, 'docs'))).toBe(false);
  });
});
