'use strict';

const fs = require('fs');
const path = require('path');

// The realpath of `p`, or its absolute path when it cannot be resolved (it
// does not exist yet, or was deleted). One project reached through several
// paths (macOS's /tmp is /private/tmp; a checkout behind a symlink) shares
// its realpath, which is why callers compare or key by it.
function realOrResolved(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return path.resolve(p);
  }
}

module.exports = { realOrResolved };
