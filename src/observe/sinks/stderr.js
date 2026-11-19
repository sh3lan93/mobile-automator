'use strict';

// Human-facing sink for interactive debugging. STDERR ONLY — stdout is owned
// exclusively by the verb's envelope (or its raw guide/schema output), and a
// single stray stdout write silently breaks the contract every calling agent
// depends on. The stream is injected so a test can prove that.

const { neutraliseControls } = require('../../output/neutralise');

const SKIP = new Set(['ts', 'v', 'mauto_version', 'node', 'os', 'level', 'event']);

function write(event = {}, { stream = process.stderr } = {}) {
  // Values can carry device text: escape control characters, newlines
  // included, so one event is always exactly one inert line (#349).
  const clean = (v) => neutraliseControls(String(v), { escapeNewlines: true });
  const parts = [`[${clean(event.level || 'info')}]`, clean(event.event || 'event')];
  for (const [k, v] of Object.entries(event)) {
    if (SKIP.has(k)) continue;
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${clean(v)}`);
  }
  stream.write(parts.join(' ') + '\n');
}

module.exports = { write };
