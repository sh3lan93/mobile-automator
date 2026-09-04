'use strict';

// Human-facing sink for interactive debugging. STDERR ONLY — stdout is owned
// exclusively by the verb's envelope (or its raw guide/schema output), and a
// single stray stdout write silently breaks the contract every calling agent
// depends on. The stream is injected so a test can prove that.

const SKIP = new Set(['ts', 'v', 'mauto_version', 'node', 'os', 'level', 'event']);

function write(event = {}, { stream = process.stderr } = {}) {
  const parts = [`[${event.level || 'info'}]`, event.event || 'event'];
  for (const [k, v] of Object.entries(event)) {
    if (SKIP.has(k)) continue;
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${v}`);
  }
  stream.write(parts.join(' ') + '\n');
}

module.exports = { write };
