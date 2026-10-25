'use strict';

const path = require('path');
const { McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const {
  createCall,
  resolveServerEntry,
  CONNECT_TIMEOUT_MS,
  ENGINE_REAP_MAX_MS,
} = require('../../../src/device/mobile-mcp-client');

// Fake SDK. The fake Client mirrors the real one where it matters: connect()
// calls transport.start(), honours options.timeout by rejecting with
// McpError(RequestTimeout), and runs its own close() on failure — which, like
// the real StdioClientTransport, clears the pid before the child is gone.
function fakeSdk({ connect = 'ok', pid = 4321 } = {}) {
  const made = {};
  class StdioClientTransport {
    constructor(params) {
      this.params = params;
      this._pid = null;
      this.closed = 0;
      made.transport = this;
    }
    async start() {
      this._pid = pid;
    }
    get pid() {
      return this._pid;
    }
    async close() {
      this._pid = null;
      this.closed += 1;
    }
  }
  class Client {
    constructor() {
      this.onclose = undefined;
      made.client = this;
    }
    async connect(transport, options) {
      made.connectOptions = options;
      this.transport = transport;
      await transport.start();
      if (connect === 'timeout') {
        void transport.close();
        throw new McpError(ErrorCode.RequestTimeout, 'Request timed out');
      }
      if (connect === 'boom') {
        void transport.close();
        throw new Error('spawn ENOENT');
      }
    }
    async close() {
      await this.transport.close();
      if (this.onclose) this.onclose();
    }
    async callTool() {
      return { content: [{ type: 'text', text: '{"ok":1}' }] };
    }
  }
  return { sdk: { Client, StdioClientTransport }, made };
}

function fakeReaper({ dies = true } = {}) {
  const calls = [];
  return {
    calls,
    waitForDeath: async (pid, opts) => {
      calls.push(['waitForDeath', pid, opts]);
      return dies;
    },
    terminate: async (pid, opts) => {
      calls.push(['terminate', pid, opts]);
      return 'dead';
    },
  };
}

const server = { command: 'fake-node', args: ['fake-entry.js'] };

describe('createCall lifecycle (#156)', () => {
  test('forwards the connect timeout to client.connect', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, server, connectTimeoutMs: 1234, reaper: fakeReaper() });
    expect(made.connectOptions).toEqual({ timeout: 1234 });
  });

  test('defaults the connect timeout to CONNECT_TIMEOUT_MS', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, server, reaper: fakeReaper() });
    expect(made.connectOptions).toEqual({ timeout: CONNECT_TIMEOUT_MS });
    expect(CONNECT_TIMEOUT_MS).toBe(10000);
  });

  test('a connect timeout throws ENGINE_CONNECT_TIMEOUT naming the bound', async () => {
    const { sdk } = fakeSdk({ connect: 'timeout' });
    const err = await createCall({ sdk, server, connectTimeoutMs: 500, reaper: fakeReaper() }).catch((e) => e);
    expect(err.code).toBe('ENGINE_CONNECT_TIMEOUT');
    expect(err.message).toBe('mobile-mcp did not finish initializing within 500ms');
    expect(err.cause).toBeInstanceOf(McpError);
  });

  test('a failed connect checks the engine pid captured at start; an engine already gone is not signalled', async () => {
    const { sdk } = fakeSdk({ connect: 'timeout', pid: 777 });
    const reaper = fakeReaper({ dies: true });
    await createCall({ sdk, server, reaper }).catch(() => {});
    expect(reaper.calls).toEqual([['waitForDeath', 777, { budgetMs: 0 }]]);
  });

  // #156: no passive wait for the SDK's fire-and-forget close ladder (stdin end,
  // 2s, SIGTERM, 2s, SIGKILL) — that time is spent inside the spawner's 15s
  // readiness window, before the daemon can record its connect_failure.
  test('a live engine is terminated at once, by pid, not group', async () => {
    const { sdk } = fakeSdk({ connect: 'timeout', pid: 777 });
    const reaper = fakeReaper({ dies: false });
    await createCall({ sdk, server, reaper }).catch(() => {});
    expect(reaper.calls).toEqual([
      ['waitForDeath', 777, { budgetMs: 0 }],
      ['terminate', 777, { group: false, graceMs: 1000 }],
    ]);
  });

  test('ENGINE_REAP_MAX_MS is the full SIGTERM-grace-then-SIGKILL bound', () => {
    expect(ENGINE_REAP_MAX_MS).toBe(2000);
  });

  test('a non-timeout connect error passes through unchanged', async () => {
    const { sdk } = fakeSdk({ connect: 'boom' });
    const err = await createCall({ sdk, server, reaper: fakeReaper() }).catch((e) => e);
    expect(err.message).toBe('spawn ENOENT');
    expect(err.code).toBeUndefined();
  });

  test('an engine exit after connect calls onEngineExit exactly once', async () => {
    const { sdk, made } = fakeSdk();
    const onEngineExit = jest.fn();
    await createCall({ sdk, server, onEngineExit, reaper: fakeReaper() });
    made.client.onclose();
    made.client.onclose();
    expect(onEngineExit).toHaveBeenCalledTimes(1);
  });

  test('our own close() never reports an engine exit', async () => {
    const { sdk } = fakeSdk();
    const onEngineExit = jest.fn();
    const { close } = await createCall({ sdk, server, onEngineExit, reaper: fakeReaper() });
    await close();
    expect(onEngineExit).not.toHaveBeenCalled();
  });

  test('a failed connect never reports an engine exit', async () => {
    const { sdk, made } = fakeSdk({ connect: 'timeout' });
    const onEngineExit = jest.fn();
    await createCall({ sdk, server, onEngineExit, reaper: fakeReaper() }).catch(() => {});
    if (made.client.onclose) made.client.onclose();
    expect(onEngineExit).not.toHaveBeenCalled();
  });

  test('the injected server command reaches the transport', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, server, reaper: fakeReaper() });
    expect(made.transport.params.command).toBe('fake-node');
    expect(made.transport.params.args).toEqual(['fake-entry.js']);
  });

  // #213: pinned at the spawn seam, not only on the pure helper — this is the
  // env the engine process actually receives.
  test('the engine is spawned with its telemetry disabled by default', async () => {
    const keys = ['MOBILEMCP_DISABLE_TELEMETRY', 'MAUTO_TELEMETRY', 'DO_NOT_TRACK'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    try {
      const { sdk, made } = fakeSdk();
      await createCall({ sdk, server, reaper: fakeReaper() });
      expect(made.transport.params.env.MOBILEMCP_DISABLE_TELEMETRY).toBe('1');
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

// #236: the engine is the daemon's long-lived child, so its argv is on `ps` for
// every user on the host. Given the workspace root, the in-project entry is
// passed relative to it and the engine runs with cwd = root, which is what
// makes the relative path resolve.
describe('createCall engine argv (#236)', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  test('with projectRoot: a root-relative entry and cwd = root', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, projectRoot: repoRoot, reaper: fakeReaper() });
    const { args, cwd, command } = made.transport.params;
    expect(command).toBe(process.execPath);
    expect(cwd).toBe(repoRoot);
    expect(args).toEqual([path.relative(repoRoot, resolveServerEntry())]);
    expect(path.isAbsolute(args[0])).toBe(false);
    expect(path.resolve(cwd, args[0])).toBe(resolveServerEntry());
  });

  test('without projectRoot: the absolute entry and no cwd, as before', async () => {
    const { sdk, made } = fakeSdk();
    await createCall({ sdk, reaper: fakeReaper() });
    expect(made.transport.params.args).toEqual([resolveServerEntry()]);
    expect(made.transport.params).not.toHaveProperty('cwd');
    expect(made.transport.params.env.MOBILECLI_PATH).toBe(process.env.MOBILECLI_PATH);
  });
});
