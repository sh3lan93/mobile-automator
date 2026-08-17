'use strict';

// Re-export shim: the canonical advisory lock now lives in src/util/lock.js.
// Kept so existing importers of src/memory/lock keep working.
module.exports = require('../util/lock');
