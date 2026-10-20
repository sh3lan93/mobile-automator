'use strict';

const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { injectDeviceArg } = require('./tool-args');
const { resolveSingleDevice } = require('./device-resolver');
const { normalizeDevices } = require('./device-model');
const { ErrorCode } = require('@modelcontextprotocol/sdk/types.js');

// Bound on mobile-mcp's MCP initialize handshake (#156). Measured at ~200ms on
// mobile-mcp 1.0.5 — initialize touches no device — so 10s is ~50x headroom.
// The spawner kills an unready daemon when its readiness window closes, and a
// failed connect is reported only once the engine is reaped, so
// CONNECT_TIMEOUT_MS + ENGINE_REAP_MAX_MS, plus headroom for the daemon's own
// boot, MUST stay below session-spawn's DEFAULT_READY_TIMEOUT_MS — or the
// daemon is killed instead of failing with its own daemon.connect_failure.
// Pinned by tests/unit/device/timeout-invariant.test.js.
// (The SDK's own default is 60s, which is longer than the window watching it.)
const CONNECT_TIMEOUT_MS = 10000;

// A failed connect terminates the engine at once rather than waiting out the
// SDK's fire-and-forget close (stdin end → 2s → SIGTERM → 2s → SIGKILL): an
// engine that never initialized has nothing to flush, and every second spent
// here is spent inside the spawner's readiness window. SIGTERM, SIGKILL after
// ENGINE_KILL_GRACE_MS, then up to ENGINE_KILL_GRACE_MS more for the death.
const ENGINE_KILL_GRACE_MS = 1000;
const ENGINE_REAP_MAX_MS = 2 * ENGINE_KILL_GRACE_MS;

// Resolve the mobile-mcp server entry point from the bundled, pinned
// dependency rather than fetching `@latest` at runtime. We read the package's
// own `bin` map (mcp-server-mobile -> lib/index.js) so the path stays correct
// across mobile-mcp versions, then spawn it with the current Node binary.
//
// Resolution is done lazily inside createCall (not at module load) so that the
// module can be required without mobile-mcp installed — the smoke test only
// asserts the module loads and exports createCall.
function resolveServerEntry() {
  const pkgPath = require.resolve('@mobilenext/mobile-mcp/package.json');
  const pkg = require('@mobilenext/mobile-mcp/package.json');
  const pkgDir = path.dirname(pkgPath);
  const binRel =
    typeof pkg.bin === 'string'
      ? pkg.bin
      : (pkg.bin && pkg.bin['mcp-server-mobile']) || pkg.main || 'lib/index.js';
  return path.join(pkgDir, binRel);
}

// The environment mauto's own engine process is spawned with. Pure: returns a
// new object and never mutates baseEnv.
//
// MOBILEMCP_ALLOW_UNSAFE_URLS defaults to "1" (#212). mobile-mcp rejects every
// non-http(s) URL in mobile_open_url unless it is set, which blocks the
// documented `open_url` deep-link capability (myapp://...). That guard exists to
// stop an LLM whose ONLY reach is MCP from opening arbitrary schemes; an agent
// driving mauto already has a shell and could open the same URL via adb or
// simctl, so under mauto it protects nothing. The URL reaches the device as an
// argv element on the default mobilecli robot (no shell), and the legacy adb
// robot escapes shell metacharacters. A user-set value wins: the engine only
// accepts the exact string "1", so MOBILEMCP_ALLOW_UNSAFE_URLS=0 restores the
// guard. The env is read when the engine spawns, so a running session daemon
// must be ended (`mauto session end`) before a change takes effect.
function buildEngineEnv({ device = null, baseEnv = process.env } = {}) {
  const env = {
    ...baseEnv,
    MOBILEMCP_ALLOW_UNSAFE_URLS: baseEnv.MOBILEMCP_ALLOW_UNSAFE_URLS ?? '1',
  };
  // mobile-mcp reads the target device from the environment / its own
  // selection; we pass it through when provided so callers can pin a device.
  if (device) env.MOBILE_MCP_DEVICE = device;
  return env;
}

// The SDK transport, remembering the engine pid the moment the child is spawned
// (#156). It has to be remembered: on a failed connect the SDK runs
// `void this.close()`, and StdioClientTransport.close() clears its pid
// synchronously — so by the time createCall's catch runs, `pid` is already null
// while the child may still be alive. `spawnedPid` is never cleared.
// Client.connect() awaits transport.start(), which is what makes start() the
// place to read it; tests/integration/engine-lifecycle.test.js pins that against
// the real SDK (a failed connect still reaps the engine).
function pidTracking(Transport) {
  return class PidTrackingTransport extends Transport {
    async start() {
      await super.start();
      this.spawnedPid = this.pid;
    }
  };
}

// Integration glue: spawns mobile-mcp over stdio and returns a `call`
// function shaped exactly like the one DeviceBridge expects.
//
// `sdk`, `server` and `reaper` are test seams: production passes none of them.
// tests/unit/device/mobile-mcp-client-lifecycle.test.js drives this against a
// fake SDK; tests/integration/engine-lifecycle.test.js against the real SDK and
// a fixture MCP server.
async function createCall({
  device,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  onEngineExit = null,
  sdk = { Client, StdioClientTransport },
  server = null,
  reaper = require('./process-reaper'),
} = {}) {
  // Resolved lazily, here, so the module still loads without mobile-mcp installed.
  const { command, args } = server || { command: process.execPath, args: [resolveServerEntry()] };
  const Transport = pidTracking(sdk.StdioClientTransport);
  const transport = new Transport({
    command,
    args,
    env: buildEngineEnv({ device }),
  });

  const client = new sdk.Client({ name: 'mauto', version: '0.1.0' }, { capabilities: {} });

  // Engine liveness (#156). The SDK fires onclose on EVERY child close — a real
  // engine death and our own close() alike — so `closing` separates the two.
  // A failed connect also sets it: that failure is reported by the throw.
  let closing = false;
  let reported = false;
  client.onclose = () => {
    if (closing || reported) return;
    reported = true;
    if (typeof onEngineExit === 'function') onEngineExit();
  };

  try {
    await client.connect(transport, { timeout: connectTimeoutMs });
  } catch (err) {
    closing = true;
    await reapEngine(transport.spawnedPid, reaper);
    throw connectError(err, connectTimeoutMs);
  }

  async function rawCall(toolName, args = {}) {
    const res = await client.callTool({ name: toolName, arguments: args });
    return parseToolResult(res);
  }
  const { call } = makeCall({ rawCall, device });

  async function close() {
    closing = true;
    try {
      await client.close();
    } catch (_e) {
      // best-effort teardown
    }
  }

  return { call, close };
}

// The SDK's connect-failure cleanup is fire-and-forget, so the engine is
// terminated here, at once, and the error leaves createCall only once it is
// gone — nothing may outlive the failure it reports. The budget-0 check first:
// an engine that already exited (the ConnectionClosed path) is not signalled.
// group:false: the engine is not a process-group leader.
async function reapEngine(pid, reaper) {
  if (!pid) return;
  if (await reaper.waitForDeath(pid, { budgetMs: 0 })) return;
  await reaper.terminate(pid, { group: false, graceMs: ENGINE_KILL_GRACE_MS });
}

// A timed-out initialize becomes an error that names the bound; anything else
// (spawn ENOENT, a protocol mismatch) passes through untouched.
function connectError(err, timeoutMs) {
  if (!(err && err.code === ErrorCode.RequestTimeout)) return err;
  const e = new Error(`mobile-mcp did not finish initializing within ${timeoutMs}ms`);
  e.code = 'ENGINE_CONNECT_TIMEOUT';
  e.cause = err;
  return e;
}

// Pure orchestration over a low-level rawCall(toolName, args) => Promise<parsed>.
// Threads a concrete device id into every tool call except the discovery verb,
// lazily auto-discovering a single device when none was pinned (cached after
// the first resolution). Extracted from createCall so it is unit-testable
// without spawning mobile-mcp.
function makeCall({ rawCall, device = null }) {
  let resolvedPromise = device != null ? Promise.resolve(device) : null;
  function ensureDevice() {
    if (!resolvedPromise) {
      resolvedPromise = rawCall('mobile_list_available_devices', {})
        .then((listed) => resolveSingleDevice(normalizeDevices(listed))) // throws DeviceResolutionError on 0/many
        .catch((err) => {
          // A failed discovery must not wedge the cache: the next call re-lists.
          resolvedPromise = null;
          throw err;
        });
    }
    return resolvedPromise;
  }
  async function call(toolName, args = {}) {
    if (toolName === 'mobile_list_available_devices') {
      return rawCall(toolName, args);
    }
    // The auto-resolved device can go stale (disconnected, a new one appears);
    // the cached id then fails every call with `Device "X" not found` until the
    // daemon restarts. Retry ONCE by busting the cache and re-resolving — but
    // only for an auto-resolved device (device === null): a user-pinned daemon
    // must never silently switch devices.
    let retried = false;
    for (;;) {
      const deviceId = await ensureDevice();
      try {
        return await rawCall(toolName, injectDeviceArg(toolName, args, deviceId));
      } catch (err) {
        const staleAutoResolved =
          device == null && !retried && /Device .+ not found/i.test(err && err.message);
        if (!staleAutoResolved) throw err;
        retried = true;
        resolvedPromise = null;
      }
    }
  }
  return { call };
}

// Collect the text content blocks from an MCP tool result into one string.
function textContent(res) {
  const content = res && res.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

// mobile-mcp returns *recoverable* failures (its `ActionableError`) as ordinary
// text content WITHOUT the `isError` flag, appending this sentinel so an agent
// reads the hint and retries. We must treat those as failures too, otherwise
// the error text gets laundered into a successful `{ok:true}` envelope.
const MOBILE_MCP_ACTIONABLE_SUFFIX = '. Please fix the issue and try again.';

// mobile-mcp returns its payload as text content that is itself JSON.
// Parse defensively: prefer JSON text content, fall back to raw text/struct.
function parseToolResult(res) {
  if (!res) return null;

  // `isError` covers "real exceptions"; the sentinel covers ActionableError.
  // Surface both so device verbs fail honestly instead of reporting ok:true.
  if (res.isError) {
    throw new Error(textContent(res) || 'mobile-mcp tool call failed');
  }

  if (res.structuredContent !== undefined) return res.structuredContent;

  const content = res.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text);
    for (const t of texts) {
      try {
        return JSON.parse(t);
      } catch (_e) {
        // not JSON; keep looking, fall through to raw join
      }
    }
    if (texts.length) {
      const joined = texts.join('\n');
      if (joined.endsWith(MOBILE_MCP_ACTIONABLE_SUFFIX)) {
        throw new Error(joined);
      }
      return joined;
    }
  }
  return res;
}

// resolveServerEntry is exported so tests/integration/mobile-mcp-contract.test.js
// spawns the pinned engine by the exact path production does, not a copy of it.
module.exports = {
  createCall,
  makeCall,
  parseToolResult,
  resolveServerEntry,
  CONNECT_TIMEOUT_MS,
  ENGINE_REAP_MAX_MS,
  buildEngineEnv,
};
