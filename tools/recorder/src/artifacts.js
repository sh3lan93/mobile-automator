'use strict';

const fs = require('fs');
const path = require('path');

class ArtifactsStore {
  constructor({ projectRoot, scenarioId }) {
    this._root = path.join(projectRoot, 'mobile-automator', '.recorder', scenarioId);
    this._scenarioId = scenarioId;
    this._eventsPath = path.join(this._root, 'events.jsonl');
    this._editsPath = path.join(this._root, 'edits.jsonl');
    this._assertionsPath = path.join(this._root, 'assertions.json');
    this._metadataPath = path.join(this._root, 'metadata.json');
  }

  init(metadata) {
    fs.mkdirSync(path.join(this._root, 'hierarchy'), { recursive: true });
    fs.mkdirSync(path.join(this._root, 'screenshots'), { recursive: true });
    fs.writeFileSync(this._metadataPath, JSON.stringify(metadata, null, 2));
    fs.writeFileSync(this._eventsPath, '');
    fs.writeFileSync(this._editsPath, '');
    fs.writeFileSync(this._assertionsPath, '[]');
  }

  appendEvent(ev) {
    fs.appendFileSync(this._eventsPath, JSON.stringify(ev) + '\n');
  }

  appendEdit(ed) {
    fs.appendFileSync(this._editsPath, JSON.stringify(ed) + '\n');
  }

  appendAssertion(ass) {
    const arr = JSON.parse(fs.readFileSync(this._assertionsPath, 'utf8'));
    arr.push(ass);
    fs.writeFileSync(this._assertionsPath, JSON.stringify(arr, null, 2));
  }

  writeHierarchySnapshot(t, snap) {
    const fileName = String(t).padStart(7, '0') + '.json';
    fs.writeFileSync(path.join(this._root, 'hierarchy', fileName), JSON.stringify(snap));
  }

  copyScreenshotIn(srcPath, name) {
    fs.copyFileSync(srcPath, path.join(this._root, 'screenshots', name));
  }

  rootPath() {
    return this._root;
  }

  assertScreenshotPath(assertion_id) {
    return path.join(this._root, 'screenshots', 'assert_' + assertion_id + '.png');
  }

  deleteAssertScreenshot(assertion_id) {
    const filePath = this.assertScreenshotPath(assertion_id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  cleanupOnSuccess() {
    if (fs.existsSync(this._root)) fs.rmSync(this._root, { recursive: true, force: true });
  }

  cleanupOnCancel() {
    this.cleanupOnSuccess();
  }
}

module.exports = { ArtifactsStore };
