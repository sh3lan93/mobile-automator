'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');

describe('ArtifactsStore.writeCrashLog', () => {
  let projectRoot;
  let persistentParent;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-art-crash-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator'));
    persistentParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-art-crash-persistent-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(persistentParent, { recursive: true, force: true });
  });

  // Note: per slice #10 orchestrator contract, the caller is responsible for
  // sanitizing colons in the ISO timestamp (e.g. '2026-05-20T18-23-09.123Z').
  // writeCrashLog passes the value through verbatim.
  const TS = '2026-05-20T18-23-09.123Z';
  const BODY = 'logcat line 1\nlogcat line 2\nFATAL EXCEPTION: main\n';

  test('writes both in-bundle and persistent copies and returns both paths', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'login_flow' });
    store.init({ mode: 'platform-aware' });

    const persistentRoot = path.join(persistentParent, 'crashes');
    const result = store.writeCrashLog({
      timestampISO: TS,
      body: BODY,
      persistentRoot,
    });

    const expectedInBundle = path.join(
      projectRoot,
      'mobile-automator',
      '.recorder',
      'login_flow',
      'crashes',
      `${TS}.log`
    );
    const expectedPersistent = path.join(
      persistentRoot,
      `login_flow-${TS}.log`
    );

    expect(result).toEqual({
      inBundlePath: expectedInBundle,
      persistentPath: expectedPersistent,
    });
    expect(fs.existsSync(expectedInBundle)).toBe(true);
    expect(fs.existsSync(expectedPersistent)).toBe(true);
    expect(fs.readFileSync(expectedInBundle, 'utf8')).toBe(BODY);
    expect(fs.readFileSync(expectedPersistent, 'utf8')).toBe(BODY);
  });

  test('creates the in-bundle crashes/ subdirectory if missing', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });
    const crashesDir = path.join(projectRoot, 'mobile-automator', '.recorder', 's', 'crashes');
    expect(fs.existsSync(crashesDir)).toBe(false);

    store.writeCrashLog({
      timestampISO: TS,
      body: BODY,
      persistentRoot: path.join(persistentParent, 'crashes'),
    });

    expect(fs.existsSync(crashesDir)).toBe(true);
    expect(fs.statSync(crashesDir).isDirectory()).toBe(true);
  });

  test('creates persistentRoot if it does not exist', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });

    const persistentRoot = path.join(persistentParent, 'nested', 'crashes');
    expect(fs.existsSync(persistentRoot)).toBe(false);

    store.writeCrashLog({
      timestampISO: TS,
      body: BODY,
      persistentRoot,
    });

    expect(fs.existsSync(persistentRoot)).toBe(true);
    expect(fs.existsSync(path.join(persistentRoot, `s-${TS}.log`))).toBe(true);
  });

  test('body is written verbatim as UTF-8 (byte content)', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });

    const utf8Body = 'crash: éèñ line\n中文 trace\n';
    const persistentRoot = path.join(persistentParent, 'crashes');
    const { inBundlePath, persistentPath } = store.writeCrashLog({
      timestampISO: TS,
      body: utf8Body,
      persistentRoot,
    });

    const expectedBytes = Buffer.from(utf8Body, 'utf8');
    expect(fs.readFileSync(inBundlePath)).toEqual(expectedBytes);
    expect(fs.readFileSync(persistentPath)).toEqual(expectedBytes);
  });

  test('cleanupOnCancel removes the in-bundle copy but the persistent copy survives', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'session_x' });
    store.init({ mode: 'platform-aware' });

    const persistentRoot = path.join(persistentParent, 'crashes');
    const { inBundlePath, persistentPath } = store.writeCrashLog({
      timestampISO: TS,
      body: BODY,
      persistentRoot,
    });

    expect(fs.existsSync(inBundlePath)).toBe(true);
    expect(fs.existsSync(persistentPath)).toBe(true);

    store.cleanupOnCancel();

    expect(fs.existsSync(inBundlePath)).toBe(false);
    expect(fs.existsSync(persistentPath)).toBe(true);
    expect(fs.readFileSync(persistentPath, 'utf8')).toBe(BODY);
  });

  test('cleanupOnSuccess removes the bundle but the persistent copy survives', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'session_y' });
    store.init({ mode: 'platform-aware' });

    const persistentRoot = path.join(persistentParent, 'crashes');
    const { inBundlePath, persistentPath } = store.writeCrashLog({
      timestampISO: TS,
      body: BODY,
      persistentRoot,
    });

    expect(fs.existsSync(inBundlePath)).toBe(true);
    expect(fs.existsSync(persistentPath)).toBe(true);

    store.cleanupOnSuccess();

    const bundleRoot = path.join(projectRoot, 'mobile-automator', '.recorder', 'session_y');
    expect(fs.existsSync(bundleRoot)).toBe(false);
    expect(fs.existsSync(persistentPath)).toBe(true);
    expect(fs.readFileSync(persistentPath, 'utf8')).toBe(BODY);
  });

  test('persistent filename embeds scenarioId followed by timestamp', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'my_scenario' });
    store.init({ mode: 'platform-aware' });

    const persistentRoot = path.join(persistentParent, 'crashes');
    const { persistentPath } = store.writeCrashLog({
      timestampISO: TS,
      body: BODY,
      persistentRoot,
    });

    expect(path.basename(persistentPath)).toBe(`my_scenario-${TS}.log`);
    expect(path.dirname(persistentPath)).toBe(persistentRoot);
  });
});
