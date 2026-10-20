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
// artifact that must mirror package.json field for field. The same goes for
// `os` (#165): npm copies it into the root entry, and a stale copy would leave
// the lockfile declaring hosts package.json no longer supports, or vice versa.
// What the docs and the runtime guard say about `os` is checked by
// ./host-support-agreement.test.js.

const pkg = require('../../package.json');
const lock = require('../../package-lock.json');

describe('package-lock.json mirrors package.json', () => {
  const root = (lock.packages || {})[''];

  test('the lockfile has a packages[""] root entry to compare against', () => {
    // Absent on pre-npm-v7 lockfiles, or if the file was hand-edited.
    expect(root).toBeDefined();
  });

  test('name, version, engines.node and os all agree', () => {
    expect({
      name: lock.name,
      version: lock.version,
      rootName: root && root.name,
      rootVersion: root && root.version,
      rootEnginesNode: root && (root.engines || {}).node,
      rootOs: root && root.os,
    }).toEqual({
      name: pkg.name,
      version: pkg.version,
      rootName: pkg.name,
      rootVersion: pkg.version,
      rootEnginesNode: (pkg.engines || {}).node,
      rootOs: pkg.os,
    });
  });
});
