'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { ArtifactsStore } = require('../../../tools/recorder/src/artifacts');
const {
  handleSaveMessage,
  handleCancelMessage,
} = require('../../../tools/recorder/src/session-handlers');

describe('session-handlers', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-sess-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('handleSaveMessage signals exit code 0 and does not call cleanup', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });
    store.appendEvent({ t: 1, kind: 'tap' });

    const cleanupSpy = jest.spyOn(store, 'cleanupOnCancel');
    const codes = [];
    handleSaveMessage({ store, onDone: (code) => codes.push(code) });

    expect(codes).toEqual([0]);
    expect(cleanupSpy).not.toHaveBeenCalled();
    // Artifact tree still exists.
    expect(fs.existsSync(path.join(projectRoot, 'mobile-automator/.recorder/s'))).toBe(true);
  });

  test('handleCancelMessage calls cleanupOnCancel once then signals exit code 130', () => {
    const store = new ArtifactsStore({ projectRoot, scenarioId: 's' });
    store.init({ mode: 'platform-aware' });
    store.appendEvent({ t: 1, kind: 'tap' });

    const cleanupSpy = jest.spyOn(store, 'cleanupOnCancel');
    const codes = [];
    handleCancelMessage({ store, onDone: (code) => codes.push(code) });

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(codes).toEqual([130]);
    expect(fs.existsSync(path.join(projectRoot, 'mobile-automator/.recorder/s'))).toBe(false);
  });

  test('handleCancelMessage is safe when artifact directory does not exist', () => {
    // Construct store but never call init — so the directory does not exist.
    const store = new ArtifactsStore({ projectRoot, scenarioId: 'never-inited' });
    expect(fs.existsSync(path.join(projectRoot, 'mobile-automator/.recorder/never-inited'))).toBe(false);

    const codes = [];
    expect(() => {
      handleCancelMessage({ store, onDone: (code) => codes.push(code) });
    }).not.toThrow();

    expect(codes).toEqual([130]);
  });
});
