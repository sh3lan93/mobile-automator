'use strict';

// loadScenario reads through safe-fs's readUserFile (#363): a committed link
// inside the checkout is refused environment, naming only the path; a file
// outside the project is the user's own and is read as named. The hash stays
// byte-exact on what was read (#275).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScenarioValidator } = require('../../../src/scenario/validator');
const { loadScenario } = require('../../../src/scenario/load');

const validator = new ScenarioValidator();
const CANARY = 'SECRET-CANARY-363';

const SCENARIO = {
  $schema_version: '2.1',
  scenario_id: 'demo',
  name: 'Démo — ünïcødé ✓',
  description: 'd',
  platform: 'android',
  app_package: 'com.example.app',
  mode: 'platform-agnostic',
  metadata: { app_version: 'debug', environment: 'ci' },
  steps: [{ id: 'launch', action: 'launch_app', description: 'Launch' }],
  assertions: [],
};

let base;
let root;
let ws;
let outside;
beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-load-')));
  root = path.join(base, 'project');
  ws = path.join(root, '.mobile-automator');
  outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(ws, 'scenarios'), { recursive: true });
  fs.mkdirSync(outside);
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const load = (file, opts = {}) => loadScenario(validator, file, { projectRoot: root, ...opts });

describe('the hash is byte-exact (#275)', () => {
  test.each([
    ['LF, non-ASCII', JSON.stringify(SCENARIO, null, 2) + '\n'],
    ['CRLF, non-ASCII', JSON.stringify(SCENARIO, null, 2).replace(/\n/g, '\r\n') + '\r\n'],
    ['escaped non-ASCII, no newline', JSON.stringify(SCENARIO).replace(/[^ -~\s]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)],
  ])('%s', (_name, text) => {
    for (const file of [path.join(ws, 'scenarios', 'x.json'), path.join(root, 'x.json'), path.join(outside, 'x.json')]) {
      fs.writeFileSync(file, text);
      const loaded = load(file);
      expect(loaded.failure).toBeUndefined();
      expect(loaded.sha256).toBe(sha(file));
      expect(loaded.scenario.name).toBe(SCENARIO.name);
    }
  });

  test('a BOM is still invalid JSON, as before', () => {
    const file = path.join(ws, 'scenarios', 'bom.json');
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(SCENARIO))]));
    const loaded = load(file);
    expect(loaded.failure.exitKind).toBe('invalid_input');
    expect(loaded.failure.envelope.error.message).toMatch(/^file is not valid JSON/);
  });
});

describe('a link inside the checkout is refused environment (#363)', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(outside, 'x.json'), JSON.stringify({ ...SCENARIO, description: CANARY }));
  });

  const expectRefused = (loaded) => {
    expect(loaded.failure.exitKind).toBe('environment');
    expect(loaded.failure.envelope.ok).toBe(false);
    expect(loaded.failure.envelope.error.kind).toBe('environment');
    expect(loaded.failure.envelope.error.message).toMatch(/^Refusing to use /);
    expect(JSON.stringify(loaded)).not.toContain(CANARY);
    expect(JSON.stringify(loaded)).not.toContain(outside);
  };

  test('a scenario leaf linked outside', () => {
    const file = path.join(ws, 'scenarios', 'x.json');
    fs.symlinkSync(path.join(outside, 'x.json'), file);
    expectRefused(load(file));
  });

  test('a project directory linked outside', () => {
    fs.symlinkSync(outside, path.join(root, 'flows'));
    expectRefused(load(path.join(root, 'flows', 'x.json')));
  });
});

describe('outside the project the file is the user\'s own', () => {
  test('a link of theirs is followed', () => {
    const real = path.join(outside, 'real.json');
    fs.writeFileSync(real, JSON.stringify(SCENARIO));
    const link = path.join(outside, 'mine.json');
    fs.symlinkSync(real, link);
    const loaded = load(link);
    expect(loaded.failure).toBeUndefined();
    expect(loaded.sha256).toBe(sha(real));
  });
});

describe('unreadable files stay invalid_input', () => {
  test('an absent file, in the workspace or outside', () => {
    for (const file of [path.join(ws, 'scenarios', 'none.json'), path.join(outside, 'none.json')]) {
      const loaded = load(file);
      expect(loaded.failure.exitKind).toBe('invalid_input');
      expect(loaded.failure.envelope.error.message).toMatch(/^cannot read file: ENOENT/);
      expect(loaded.failure.envelope.error.message).toContain(file);
    }
  });

  test('a directory outside the project', () => {
    const loaded = load(outside);
    expect(loaded.failure.exitKind).toBe('invalid_input');
    expect(loaded.failure.envelope.error.message).toMatch(/^cannot read file: /);
  });

  test('projectRoot is required', () => {
    expect(() => loadScenario(validator, path.join(outside, 'x.json'), {})).toThrow(/projectRoot/);
  });
});
