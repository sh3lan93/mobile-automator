'use strict';

const fs = require('fs');
const path = require('path');

function formatArchiveTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
}

function archiveExistingScreenshots({ projectRoot, scenarioId, now } = {}) {
  const src = path.join(projectRoot, 'mobile-automator', 'screenshots', scenarioId);
  if (!fs.existsSync(src)) return null;

  const archiveRoot = path.join(projectRoot, 'mobile-automator', 'screenshots', '.archive');
  const ts = formatArchiveTimestamp(now || new Date());

  let dest = path.join(archiveRoot, `${scenarioId}-${ts}`);
  let suffix = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(archiveRoot, `${scenarioId}-${ts}-${suffix++}`);
  }

  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.renameSync(src, dest);
  return dest;
}

module.exports = { archiveExistingScreenshots, formatArchiveTimestamp };
