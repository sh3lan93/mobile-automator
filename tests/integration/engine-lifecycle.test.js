'use strict';

// createCall against the REAL MCP SDK and a fixture server. The unit tests use
// a fake SDK, which can only behave the way we believe the SDK behaves; this
// file is what shows the timeout option and onclose actually do that.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCall, ENGINE_REAP_MAX_MS } = require('../../src/device/mobile-mcp-client');
// Exited, not merely unreaped: the engine is this test process's own child, and
// the instant createCall rejects it may still be a zombie that libuv reaps on
// the next turn of the loop. kill(pid, 0) alone would call that alive.
const { processAlive } = require('../../src/device/process-reaper');

jest.setTimeout(15000);

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'mcp-fixture-server.js');
const server = (mode, pidFile) => ({
  command: process.execPath,
  args: pidFile ? [FIXTURE, mode, pidFile] : [FIXTURE, mode],
});
const pidFileIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-engine-')), 'engine.pid');
const enginePid = (file) => Number(fs.readFileSync(file, 'utf8'));

// Slack for spawning the fixture and polling; the bound under test is the sum.
const SLACK_MS = 1000;

test('a server that never initializes fails with ENGINE_CONNECT_TIMEOUT, and is gone', async () => {
  const pidFile = pidFileIn();
  const started = Date.now();
  const err = await createCall({ server: server('never-init', pidFile), connectTimeoutMs: 500 }).catch((e) => e);
  expect(err.code).toBe('ENGINE_CONNECT_TIMEOUT');
  // The engine is terminated at once (#156), not after the SDK's 2s stdin-EOF
  // grace: the whole failure fits inside the bound plus ENGINE_REAP_MAX_MS.
  expect(Date.now() - started).toBeLessThan(500 + ENGINE_REAP_MAX_MS + SLACK_MS);
  // createCall only rejects once the engine is dead; the fixture ignores stdin
  // EOF, so this is the kill, not the engine leaving on its own.
  expect(processAlive(enginePid(pidFile))).toBe(false);
});

test('an engine that ignores SIGTERM too is SIGKILLed before the error is reported', async () => {
  const pidFile = pidFileIn();
  const started = Date.now();
  const err = await createCall({ server: server('wedged', pidFile), connectTimeoutMs: 500 }).catch((e) => e);
  expect(err.code).toBe('ENGINE_CONNECT_TIMEOUT');
  expect(Date.now() - started).toBeLessThan(500 + ENGINE_REAP_MAX_MS + SLACK_MS);
  expect(processAlive(enginePid(pidFile))).toBe(false);
});

test('an engine that exits after initialize fires onEngineExit once', async () => {
  const exits = [];
  await createCall({ server: server('exit-after-init'), onEngineExit: () => exits.push(Date.now()) });
  const deadline = Date.now() + 5000;
  while (exits.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  expect(exits).toHaveLength(1);
});

test('our own close() does not fire onEngineExit', async () => {
  const exits = [];
  const { close } = await createCall({ server: server('stay-up'), onEngineExit: () => exits.push(1) });
  await close();
  await new Promise((r) => setTimeout(r, 200));
  expect(exits).toHaveLength(0);
});
