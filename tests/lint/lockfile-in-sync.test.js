'use strict';

// package-lock.json's root entry is a copy of package.json's identity fields,
// rewritten by `npm install`. Editing package.json without one leaves the two
// disagreeing — and since CI installs with `npm ci`, which installs *from the
// lockfile*, the disagreement is invisible until something downstream reads the
// wrong value. This has drifted twice already (e15a74b, and again while #162
// was in flight), so it is mechanized rather than reviewed.
//
// `engines.node` lives here rather than in node-version-agreement.test.js
// because the lockfile is not a claim about what users need; it is a derived
// artifact that must mirror package.json field for field.

const pkg = require('../../package.json');
const lock = require('../../package-lock.json');

describe('package-lock.json mirrors package.json', () => {
  const root = (lock.packages || {})[''];

  test('the lockfile has a packages[""] root entry to compare against', () => {
    // Absent on pre-npm-v7 lockfiles, or if the file was hand-edited.
    expect(root).toBeDefined();
  });

  test('name, version and engines.node all agree', () => {
    expect({
      name: lock.name,
      version: lock.version,
      rootName: root && root.name,
      rootVersion: root && root.version,
      rootEnginesNode: root && (root.engines || {}).node,
    }).toEqual({
      name: pkg.name,
      version: pkg.version,
      rootName: pkg.name,
      rootVersion: pkg.version,
      rootEnginesNode: (pkg.engines || {}).node,
    });
  });
});
