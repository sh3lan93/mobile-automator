'use strict';

// #144 — the stale-integration notice `mauto guide` prepends, rendered for the
// widest input (every host stale, every status kind present) so the guide lint
// guards can hold it to the same standard as the guide prose it precedes.
// Not a test file (no `.test.js`), so jest does not run it on its own.

const { renderStaleNotice } = require('../../src/init/stale-notice');
const { HOSTS } = require('../../src/init/host-plan');

function allHostsStaleNotice() {
  const statuses = ['missing', 'outdated', 'unreadable'];
  return renderStaleNotice(
    HOSTS.map((agent, i) => ({
      agent,
      installed: true,
      stale: true,
      files: [
        { path: `/project/${agent}/a`, status: 'missing' },
        { path: `/project/${agent}/b`, status: 'outdated' },
      ],
      mcp: { path: `/project/${agent}/mcp.json`, status: statuses[i % statuses.length] },
    }))
  );
}

module.exports = { allHostsStaleNotice };
