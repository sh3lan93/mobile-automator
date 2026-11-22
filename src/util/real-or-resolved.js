'use strict';

const fs = require('fs');
const path = require('path');

// The realpath of `p`, or null when it has none (it does not exist yet, or was
// deleted). The one try/catch around fs.realpathSync outside safe-fs's walk.
// For a caller that skips what cannot be resolved (output-roots: a root with no
// realpath cannot contain a directory that exists).
function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return null;
  }
}

// The realpath of `p`, or its absolute path when it cannot be resolved. One
// project reached through several paths (macOS's /tmp is /private/tmp; a
// checkout behind a symlink) shares its realpath, which is why callers compare
// or key by it.
function realOrResolved(p) {
  return realpathOrNull(p) ?? path.resolve(p);
}

module.exports = { realpathOrNull, realOrResolved };
