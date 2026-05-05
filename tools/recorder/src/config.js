'use strict';

const fs = require('fs');
const path = require('path');

function loadProjectConfig(projectRoot) {
  const cfgPath = path.join(projectRoot, 'mobile-automator', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`config.json not found at ${cfgPath}. Run /mobile-automator:setup first.`);
  }
  const raw = fs.readFileSync(cfgPath, 'utf8');
  return JSON.parse(raw);
}

function resolveModeAndDefaults(cfg) {
  const mode = cfg.mode || 'platform-aware';
  return {
    ...cfg,
    mode,
  };
}

module.exports = { loadProjectConfig, resolveModeAndDefaults };
