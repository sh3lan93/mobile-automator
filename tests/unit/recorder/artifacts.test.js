'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');

describe('ArtifactsStore', () => {
  let projectRoot;
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-art-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator'));
  });
  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('initializes directory tree on construction', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'login_flow' });
    store.init({ mode: 'platform-aware', app_version: '1.0.0' });
    const root = path.join(projectRoot, 'mobile-automator', '.recorder', 'login_flow');
    expect(fs.existsSync(path.join(root, 'metadata.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'hierarchy'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'screenshots'))).toBe(true);
  });

  test('appendEvent writes JSONL line', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });
    store.appendEvent({ t: 100, kind: 'tap', x: 50, y: 50 });
    store.appendEvent({ t: 200, kind: 'tap', x: 60, y: 60 });
    const content = fs.readFileSync(path.join(projectRoot, 'mobile-automator/.recorder/s/events.jsonl'), 'utf8');
    expect(content.trim().split('\n')).toHaveLength(2);
    const first = JSON.parse(content.split('\n')[0]);
    expect(first).toMatchObject({ t: 100, kind: 'tap' });
  });

  test('writeHierarchySnapshot creates per-timestamp file', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });
    store.writeHierarchySnapshot(1234, { elements: [{ id: 'a' }] });
    const file = path.join(projectRoot, 'mobile-automator/.recorder/s/hierarchy/0001234.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ elements: [{ id: 'a' }] });
  });

  test('cleanupOnSuccess removes the entire artifact tree', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });
    store.appendEvent({ t: 1, kind: 'tap' });
    expect(fs.existsSync(path.join(projectRoot, 'mobile-automator/.recorder/s'))).toBe(true);
    store.cleanupOnSuccess();
    expect(fs.existsSync(path.join(projectRoot, 'mobile-automator/.recorder/s'))).toBe(false);
  });

  test('appendEdit and appendAssertion build their respective files', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });
    store.appendEdit({ t: 1, kind: 'rename', step_id: 'tap_x', new_name: 'tap_login' });
    store.appendAssertion({ id: 'a1', anchor_step_id: 'tap_login', nl_text: 'welcome shown' });
    const editsContent = fs.readFileSync(path.join(projectRoot, 'mobile-automator/.recorder/s/edits.jsonl'), 'utf8');
    expect(editsContent.trim()).toContain('rename');
    const assertions = JSON.parse(fs.readFileSync(path.join(projectRoot, 'mobile-automator/.recorder/s/assertions.json'), 'utf8'));
    expect(assertions).toHaveLength(1);
    expect(assertions[0].nl_text).toBe('welcome shown');
  });
});
