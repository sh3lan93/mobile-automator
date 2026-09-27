'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeFlusher, FLUSH_INTERVAL_MS, MAX_FLUSH_INTERVAL_MS, MAX_CLAIMED } = require('../../../src/observe/flush');
const spool = require('../../../src/observe/spool');
const { spoolPath } = require('../../../src/observe/paths');
const telemetry = require('../../../src/observe/telemetry');

const TOKEN = { MAUTO_TELEMETRY_TOKEN: 'phc_real' };

function workspace({ enabled = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-flush-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'mobile-automator', 'config.json'),
    JSON.stringify({ telemetry: { enabled } }, null, 2)
  );
  return root;
}

function spoolN(root, n) {
  for (let i = 0; i < n; i++) {
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: {} });
  }
}

function stubTransport(results) {
  const calls = [];
  const queue = [...results];
  return {
    calls,
    postBatch: async (payloads) => {
      calls.push(payloads);
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  };
}

const OK = { ok: true, retry: false, status: 200 };
const RETRY = { ok: false, retry: true, status: 503 };
const PERMANENT = { ok: false, retry: false, status: 401 };

beforeEach(() => telemetry._resetMemo());

describe('telemetry flush', () => {
  it('never touches the transport while telemetry is disabled', async () => {
    const root = workspace({ enabled: false });
    const transport = {
      postBatch: () => {
        throw new Error('the transport must not be reachable while telemetry is disabled');
      },
    };
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport });
    await expect(flush()).resolves.toMatchObject({ skipped: 'not_configured', sent: 0 });
  });

  it('never touches the transport under a kill switch, even with an enabled config', async () => {
    const root = workspace({ enabled: true });
    const transport = {
      postBatch: () => {
        throw new Error('the transport must not be reachable under MAUTO_TELEMETRY=0');
      },
    };
    const flush = makeFlusher({ projectRoot: root, env: { ...TOKEN, MAUTO_TELEMETRY: '0' }, transport });
    await expect(flush()).resolves.toMatchObject({ skipped: 'kill_switch', sent: 0 });
  });

  it('claims, posts and deletes', async () => {
    const root = workspace();
    spoolN(root, 3);
    const transport = stubTransport([OK]);

    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();

    expect(r).toMatchObject({ ok: true, sent: 3, dropped: 0, kept: 0 });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toHaveLength(3);
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toEqual([]);
  });

  it('is a no-op with an empty spool', async () => {
    const root = workspace();
    const transport = stubTransport([OK]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();
    expect(r).toMatchObject({ ok: true, sent: 0, kept: 0 });
    expect(transport.calls).toHaveLength(0);
  });

  it('keeps the claimed batch on a retryable failure and re-sends it next flush', async () => {
    const root = workspace();
    spoolN(root, 2);
    const transport = stubTransport([RETRY, OK]);
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport });

    const first = await flush();
    expect(first).toMatchObject({ ok: false, sent: 0, kept: 1 });
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toHaveLength(1);

    const second = await flush();
    expect(second).toMatchObject({ ok: true, sent: 2, kept: 0 });
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toEqual([]);
  });

  it('drops a permanently-rejected batch so a revoked token cannot wedge the queue', async () => {
    const root = workspace();
    spoolN(root, 2);
    const transport = stubTransport([PERMANENT]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();
    expect(r).toMatchObject({ ok: false, sent: 0, dropped: 2, kept: 0 });
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toEqual([]);
  });

  it('backs off on repeated failure and resets on success', async () => {
    const root = workspace();
    const transport = stubTransport([RETRY]);
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport });

    spoolN(root, 1);
    expect((await flush()).nextDelayMs).toBe(FLUSH_INTERVAL_MS * 2);
    expect((await flush()).nextDelayMs).toBe(FLUSH_INTERVAL_MS * 4);
    expect((await flush()).nextDelayMs).toBe(FLUSH_INTERVAL_MS * 8);

    const ok = makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([OK]) });
    expect((await ok()).nextDelayMs).toBe(FLUSH_INTERVAL_MS);
  });

  it('caps the backoff at half an hour', async () => {
    const root = workspace();
    spoolN(root, 1);
    const flush = makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([RETRY]) });
    let delay = 0;
    for (let i = 0; i < 20; i++) delay = (await flush()).nextDelayMs;
    expect(delay).toBe(MAX_FLUSH_INTERVAL_MS);
  });

  it('retries leftover batches before claiming a fresh one, oldest first', async () => {
    const root = workspace();
    spoolN(root, 1);
    await makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([RETRY]) })();

    spoolN(root, 1);
    const transport = stubTransport([OK]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();

    expect(r).toMatchObject({ ok: true, sent: 2 });
    expect(transport.calls).toHaveLength(2); // the leftover, then the fresh claim
  });

  it('prunes claimed batches beyond the cap so a permanently-offline machine converges', async () => {
    const root = workspace();
    const failing = makeFlusher({ projectRoot: root, env: TOKEN, transport: stubTransport([RETRY]) });
    for (let i = 0; i < MAX_CLAIMED + 4; i++) {
      spoolN(root, 1);
      await failing();
    }
    expect(spool.listClaimed({ projectRoot: root, env: {} }).length).toBeLessThanOrEqual(MAX_CLAIMED);
  });

  it('chunks a large batch and stops at the first retryable chunk', async () => {
    const root = workspace();
    spoolN(root, 600); // > 2 * BATCH_SIZE
    const transport = stubTransport([OK, RETRY, OK]);
    const r = await makeFlusher({ projectRoot: root, env: TOKEN, transport })();
    expect(transport.calls.map((c) => c.length)).toEqual([250, 250]);
    expect(r).toMatchObject({ ok: false, sent: 250, kept: 1 });
  });

  it('records its own outcome locally at debug — a user\'s flaky wifi is not a daemon failure', async () => {
    const root = workspace();
    spoolN(root, 2);
    const seen = [];
    await makeFlusher({
      projectRoot: root,
      env: TOKEN,
      transport: stubTransport([RETRY]),
      observe: (e) => seen.push(e),
    })();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ level: 'debug', event: 'telemetry.flush', ok: false, count: 2, http_status: 503 });
  });

  it('never rejects, whatever the transport does', async () => {
    const root = workspace();
    spoolN(root, 1);
    const transport = {
      postBatch: async () => {
        throw new Error('transport blew up in a way postBatch was supposed to catch');
      },
    };
    await expect(makeFlusher({ projectRoot: root, env: TOKEN, transport })()).resolves.toMatchObject({ ok: false });
  });
});
