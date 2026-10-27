'use strict';

// The one place the per-project workspace is named and located. The workspace
// is hidden (`.mobile-automator/`) so it stays out of the way in a project
// root; it used to be the visible `mobile-automator/`. Every path in the CLI is
// built from workspaceDir(), and tests/lint/workspace-dirname-single-source.test.js
// fails the build if any file outside src/workspace/ names the constants or
// spells either directory as a string literal.
//
// LEGACY_WORKSPACE_DIRNAME exists only so a pre-rename workspace can be
// recognised and reported; nothing writes to it.
//
// A leaf module (requires only `path`) so anything can import it without a cycle.

const path = require('path');

const WORKSPACE_DIRNAME = '.mobile-automator';
const LEGACY_WORKSPACE_DIRNAME = 'mobile-automator';

// The workspace root under a project root. Callers join their own subpath onto
// this rather than rebuilding it from the name.
function workspaceDir(projectRoot) {
  return path.join(projectRoot, WORKSPACE_DIRNAME);
}

module.exports = { WORKSPACE_DIRNAME, LEGACY_WORKSPACE_DIRNAME, workspaceDir };
