'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');

describe('assertScreenshotPath', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-asrt-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('returns path.join(root, "screenshots", "assert_a1.png") for id "a1"', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    const expected = path.join(projectRoot, 'mobile-automator', '.recorder', 's', 'screenshots', 'assert_a1.png');
    expect(store.assertScreenshotPath('a1')).toBe(expected);
  });

  test('returns correct path for id "a99"', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    const expected = path.join(projectRoot, 'mobile-automator', '.recorder', 's', 'screenshots', 'assert_a99.png');
    expect(store.assertScreenshotPath('a99')).toBe(expected);
  });
});

describe('deleteAssertScreenshot', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-del-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('deletes the file when it exists', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });

    const filePath = store.assertScreenshotPath('a1');
    fs.writeFileSync(filePath, 'dummy');
    expect(fs.existsSync(filePath)).toBe(true);

    store.deleteAssertScreenshot('a1');

    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('is a no-op when the file does not exist', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });

    const filePath = store.assertScreenshotPath('a99');
    expect(fs.existsSync(filePath)).toBe(false);

    expect(() => {
      store.deleteAssertScreenshot('a99');
    }).not.toThrow();
  });
});
