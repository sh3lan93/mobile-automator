'use strict';

// #363, end to end through buildProgram: every verb that reads a scenario
// (validate, run, result finalize --scenario) refuses one reached through a
// committed link inside the checkout, a linked leaf or a linked project
// directory, with an `environment` envelope that never prints what the link
// points at, and `run` refuses before any device work. A scenario outside the
// project is the user's own: a link of theirs there is followed.

const fs = require('fs');
const path = require('path');

const { CANARY, tmpDir, fixture, runIn } = require('../helpers/workspace-safety');

const scenario = (extra = {}) => ({
  $schema_version: '2.1',
  scenario_id: 'demo',
  name: 'Demo',
  description: 'd',
  platform: 'android',
  app_package: 'com.example.app',
  mode: 'platform-agnostic',
  metadata: { app_version: 'debug', environment: 'ci' },
  steps: [{ id: 'launch', action: 'launch_app', description: 'Launch' }],
  assertions: [],
  ...extra,
});

// The canary sits in an otherwise valid scenario, so a read that followed the
// link would parse it and could echo it (a validation error, a hint).
const plantCanary = (outside) => {
  fs.writeFileSync(path.join(outside, 'x.json'), JSON.stringify(scenario({ description: CANARY, name: CANARY })));
};

const PLANTS = {
  'a scenario leaf linked outside': {
    plant: (ws, outside) => {
      plantCanary(outside);
      fs.mkdirSync(path.join(ws, 'scenarios'));
      fs.symlinkSync(path.join(outside, 'x.json'), path.join(ws, 'scenarios', 'x.json'));
    },
    file: (root) => path.join(root, '.mobile-automator', 'scenarios', 'x.json'),
  },
  'a project directory linked outside': {
    plant: (ws, outside) => {
      plantCanary(outside);
      fs.symlinkSync(outside, path.join(path.dirname(ws), 'flows'));
    },
    file: (root) => path.join(root, 'flows', 'x.json'),
  },
};

const VERBS = {
  validate: (file) => ['validate', file],
  run: (file) => ['run', file, '--run-id', 'run_20261122_120000'],
  'result finalize --scenario': (file) => ['result', 'finalize', '--run-id', 'run_20261122_120000', '--scenario', file],
};

const CASES = [];
for (const [plantName, plant] of Object.entries(PLANTS)) {
  for (const [verbName, argv] of Object.entries(VERBS)) CASES.push([`${verbName}: ${plantName}`, plant, argv]);
}

describe('a scenario reached through a committed link is refused (#363)', () => {
  test.each(CASES)('%s', async (_name, { plant, file }, argv) => {
    const { root } = fixture(plant);
    const deviceCalls = [];
    const deviceBridgeFactory = async () => {
      deviceCalls.push('connect');
      return { bridge: {}, close: async () => {} };
    };

    const { calls, written } = await runIn(root, argv(file(root)), { deviceBridgeFactory });

    expect(calls).toHaveLength(1);
    const [r] = calls;
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/^Refusing to use /);
    expect(JSON.stringify(calls)).not.toContain(CANARY);
    expect(written).not.toContain(CANARY);
    expect(deviceCalls).toEqual([]);
  });
});

describe("a scenario outside the project is the user's own", () => {
  test("validate follows the user's link to it", async () => {
    const { root } = fixture(() => {});
    const elsewhere = tmpDir('mauto-elsewhere-');
    try {
      fs.writeFileSync(path.join(elsewhere, 'real.json'), JSON.stringify(scenario()));
      fs.symlinkSync(path.join(elsewhere, 'real.json'), path.join(elsewhere, 'mine.json'));
      const { calls } = await runIn(root, ['validate', path.join(elsewhere, 'mine.json')]);
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('ok');
      expect(calls[0].envelope.data).toEqual({ valid: true });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

// Without a workspace there is no checkout, so validate reads the scenario as
// the user named it: the cwd is never taken for a project root and walked
// (from `/`, that walk refused macOS's /var link and Linux's o+w /tmp).
describe('validate without a workspace reads the user\'s own file', () => {
  test('run from /, a scenario under the temp dir validates', async () => {
    const elsewhere = tmpDir('mauto-noworkspace-');
    try {
      const file = path.join(elsewhere, 's.json');
      fs.writeFileSync(file, JSON.stringify(scenario()));
      const { calls } = await runIn(elsewhere, ['validate', file], { cwd: '/' });
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('ok');
      expect(calls[0].envelope.data).toEqual({ valid: true });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("run from the directory holding it, the user's own link is followed", async () => {
    const elsewhere = tmpDir('mauto-noworkspace-');
    try {
      fs.writeFileSync(path.join(elsewhere, 'real.json'), JSON.stringify(scenario()));
      fs.symlinkSync(path.join(elsewhere, 'real.json'), path.join(elsewhere, 'mine.json'));
      const { calls } = await runIn(elsewhere, ['validate', path.join(elsewhere, 'mine.json')], { cwd: elsewhere });
      expect(calls).toHaveLength(1);
      expect(calls[0].exitKind).toBe('ok');
      expect(calls[0].envelope.data).toEqual({ valid: true });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
