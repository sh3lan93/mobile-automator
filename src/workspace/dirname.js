'use strict';

// The one place the per-project workspace directory is named. The workspace is
// hidden (`.mobile-automator/`) so it stays out of the way in a project root;
// it used to be the visible `mobile-automator/`. Every path in the CLI is built
// from WORKSPACE_DIRNAME, and tests/lint/workspace-dirname-single-source.test.js
// fails the build if a string literal elsewhere spells either name.
//
// LEGACY_WORKSPACE_DIRNAME exists only so a pre-rename workspace can be
// recognised and reported; nothing writes to it.

const WORKSPACE_DIRNAME = '.mobile-automator';
const LEGACY_WORKSPACE_DIRNAME = 'mobile-automator';

module.exports = { WORKSPACE_DIRNAME, LEGACY_WORKSPACE_DIRNAME };
