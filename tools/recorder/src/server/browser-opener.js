'use strict';

const { spawn: defaultSpawn } = require('child_process');

/**
 * Open the given URL in the host OS's default browser.
 *
 * Best-effort: failures (unsupported platform, missing launcher binary, spawn
 * throwing synchronously) are reported via the injected `warn` and swallowed
 * so they cannot crash the recorder sidecar. The caller always prints the URL
 * to stdout regardless, so a silent failure here is still recoverable.
 *
 * - `noGui: true` short-circuits without spawning (used by `--no-gui` so CI
 *   and headless tests don't pop a browser).
 * - `spawn` is injectable so the unit tests can drive each platform branch
 *   without actually launching a browser. Mirrors the pattern in
 *   `tools/recorder/src/capture/adb-getevent.js`.
 *
 * @param {object} args
 * @param {string} args.url - URL to open. If falsy, no-ops silently.
 * @param {string} [args.platform=process.platform] - OS branch selector.
 * @param {boolean} [args.noGui=false] - When true, do not spawn anything.
 * @param {Function} [args.spawn=child_process.spawn] - Spawn injector.
 * @param {Function} [args.warn=console.warn] - Warning channel.
 */
function openInBrowser({
  url,
  platform = process.platform,
  noGui = false,
  spawn = defaultSpawn,
  warn = console.warn,
} = {}) {
  if (noGui) return;
  if (!url) return;

  let cmd;
  let args;
  switch (platform) {
    case 'darwin':
      cmd = 'open';
      args = [url];
      break;
    case 'linux':
      cmd = 'xdg-open';
      args = [url];
      break;
    case 'win32':
      cmd = 'cmd';
      args = ['/c', 'start', '', url];
      break;
    default:
      warn(`[recorder] auto-open: unsupported platform ${platform}; open ${url} manually`);
      return;
  }

  try {
    const proc = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    if (proc && typeof proc.unref === 'function') {
      proc.unref();
    }
  } catch (err) {
    warn(`[recorder] auto-open failed (${err && err.message ? err.message : err}); open ${url} manually`);
  }
}

module.exports = { openInBrowser };
