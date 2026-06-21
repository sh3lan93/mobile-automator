'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { startLiveCapture } = require('../../../tools/recorder/src/lifecycle/live');

function setupProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live-cap-'));
  fs.mkdirSync(path.join(projectRoot, 'mobile-automator'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'mobile-automator', 'config.json'),
    JSON.stringify({ mode: 'platform-aware', app_package: 'com.example.app' }, null, 2),
  );
  return projectRoot;
}

function makeFakeWsCtx() {
  const messageHandlers = [];
  const broadcasts = [];
  return {
    broadcast: jest.fn((msg) => broadcasts.push(msg)),
    onMessage(fn) { messageHandlers.push(fn); },
    onConnect() {},
    onDisconnect() {},
    clientCount() { return 0; },
    close: jest.fn(),
    _broadcasts: broadcasts,
    _simulateMessage(msg) { for (const h of messageHandlers) h(msg); },
  };
}

function makeFakeHttpSrv(port = 0) {
  return { port, server: {}, close: jest.fn().mockResolvedValue(undefined) };
}

describe('startLiveCapture (lifecycle/live)', () => {
  let projectRoot;
  beforeEach(() => { projectRoot = setupProject(); });
  afterEach(() => { fs.rmSync(projectRoot, { recursive: true, force: true }); });

  test('initialises ArtifactsStore with mode + scenario_id + platform', async () => {
    const wsCtx = makeFakeWsCtx();
    const httpSrv = makeFakeHttpSrv();
    await startLiveCapture({
      projectRoot,
      scenarioId: 'login',
      platform: 'android',
      mode: 'b',
      opts: {},
      deps: {
        startHttpServer: jest.fn().mockResolvedValue(httpSrv),
        attachWsServer: jest.fn().mockReturnValue(wsCtx),
        startC3: jest.fn().mockResolvedValue(0),
        startModeB: jest.fn().mockResolvedValue(0),
        openInBrowser: jest.fn(),
      },
    });

    const metaPath = path.join(projectRoot, 'mobile-automator', '.recorder', 'login', 'metadata.json');
    expect(fs.existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    expect(meta.mode).toBe('platform-aware');
    expect(meta.scenario_id).toBe('login');
    expect(meta.platform).toBe('android');
    expect(meta.capture_mode).toBe('b');
  });

  test('starts HTTP server and attaches WS server', async () => {
    const startHttp = jest.fn().mockResolvedValue(makeFakeHttpSrv());
    const attachWs = jest.fn().mockReturnValue(makeFakeWsCtx());
    await startLiveCapture({
      projectRoot,
      scenarioId: 'scn',
      platform: 'android',
      mode: 'b',
      opts: { allowSensitiveInput: true },
      deps: {
        startHttpServer: startHttp,
        attachWsServer: attachWs,
        startC3: jest.fn().mockResolvedValue(0),
        startModeB: jest.fn().mockResolvedValue(0),
        openInBrowser: jest.fn(),
      },
    });
    expect(startHttp).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot,
      scenarioId: 'scn',
      mode: 'platform-aware',
      allowSensitiveInput: true,
    }));
    expect(attachWs).toHaveBeenCalled();
  });

  test('mode=c3 delegates to startC3', async () => {
    const startC3 = jest.fn().mockResolvedValue(0);
    const startModeB = jest.fn().mockResolvedValue(0);
    const wsCtx = makeFakeWsCtx();
    const httpSrv = makeFakeHttpSrv();

    const code = await startLiveCapture({
      projectRoot,
      scenarioId: 'scn',
      platform: 'android',
      mode: 'c3',
      opts: {},
      deps: {
        startHttpServer: jest.fn().mockResolvedValue(httpSrv),
        attachWsServer: jest.fn().mockReturnValue(wsCtx),
        startC3,
        startModeB,
        openInBrowser: jest.fn(),
      },
    });

    expect(startC3).toHaveBeenCalledTimes(1);
    expect(startModeB).not.toHaveBeenCalled();
    expect(startC3.mock.calls[0][0]).toEqual(expect.objectContaining({
      store: expect.any(Object),
      wsCtx,
      httpSrv,
      sessionId: 'scn',
      platform: 'android',
      appPackage: 'com.example.app',
    }));
    expect(code).toBe(0);
  });

  test('mode=b delegates to startModeB', async () => {
    const startC3 = jest.fn().mockResolvedValue(0);
    const startModeB = jest.fn().mockResolvedValue(0);
    const wsCtx = makeFakeWsCtx();
    const httpSrv = makeFakeHttpSrv();

    const code = await startLiveCapture({
      projectRoot,
      scenarioId: 'scn',
      platform: 'android',
      mode: 'b',
      opts: {},
      deps: {
        startHttpServer: jest.fn().mockResolvedValue(httpSrv),
        attachWsServer: jest.fn().mockReturnValue(wsCtx),
        startC3,
        startModeB,
        openInBrowser: jest.fn(),
      },
    });

    expect(startModeB).toHaveBeenCalledTimes(1);
    expect(startC3).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  test('broadcasts initial mode message', async () => {
    const wsCtx = makeFakeWsCtx();
    await startLiveCapture({
      projectRoot,
      scenarioId: 'scn',
      platform: 'android',
      mode: 'b',
      opts: {},
      deps: {
        startHttpServer: jest.fn().mockResolvedValue(makeFakeHttpSrv()),
        attachWsServer: jest.fn().mockReturnValue(wsCtx),
        startC3: jest.fn().mockResolvedValue(0),
        startModeB: jest.fn().mockResolvedValue(0),
        openInBrowser: jest.fn(),
      },
    });
    expect(wsCtx._broadcasts).toContainEqual({ type: 'mode', mode: 'platform-aware' });
  });

  test('auto-opens browser after HTTP server starts (before mode handler)', async () => {
    const wsCtx = makeFakeWsCtx();
    const httpSrv = makeFakeHttpSrv(54321);
    const openInBrowser = jest.fn();
    const startModeB = jest.fn().mockImplementation(() => {
      // Order proof: the browser must already be opened by the time the mode
      // handler runs.
      expect(openInBrowser).toHaveBeenCalledTimes(1);
      return Promise.resolve(0);
    });

    await startLiveCapture({
      projectRoot,
      scenarioId: 'scn',
      platform: 'android',
      mode: 'b',
      opts: { noGui: false },
      deps: {
        startHttpServer: jest.fn().mockResolvedValue(httpSrv),
        attachWsServer: jest.fn().mockReturnValue(wsCtx),
        startC3: jest.fn().mockResolvedValue(0),
        startModeB,
        openInBrowser,
      },
    });

    expect(openInBrowser).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:54321/',
      noGui: false,
    }));
  });

  test('passes noGui:true through to the browser opener', async () => {
    const wsCtx = makeFakeWsCtx();
    const httpSrv = makeFakeHttpSrv(54321);
    const openInBrowser = jest.fn();

    await startLiveCapture({
      projectRoot,
      scenarioId: 'scn',
      platform: 'android',
      mode: 'b',
      opts: { noGui: true },
      deps: {
        startHttpServer: jest.fn().mockResolvedValue(httpSrv),
        attachWsServer: jest.fn().mockReturnValue(wsCtx),
        startC3: jest.fn().mockResolvedValue(0),
        startModeB: jest.fn().mockResolvedValue(0),
        openInBrowser,
      },
    });

    expect(openInBrowser).toHaveBeenCalledWith(expect.objectContaining({ noGui: true }));
  });

  test('always prints the GUI URL to stderr', async () => {
    const wsCtx = makeFakeWsCtx();
    const httpSrv = makeFakeHttpSrv(54321);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await startLiveCapture({
        projectRoot,
        scenarioId: 'scn',
        platform: 'android',
        mode: 'b',
        opts: {},
        deps: {
          startHttpServer: jest.fn().mockResolvedValue(httpSrv),
          attachWsServer: jest.fn().mockReturnValue(wsCtx),
          startC3: jest.fn().mockResolvedValue(0),
          startModeB: jest.fn().mockResolvedValue(0),
          openInBrowser: jest.fn(),
        },
      });

      const printed = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('http://127.0.0.1:54321/');
    } finally {
      errSpy.mockRestore();
    }
  });

  test('closes WS + HTTP server on completion', async () => {
    const wsCtx = makeFakeWsCtx();
    const httpSrv = makeFakeHttpSrv();
    await startLiveCapture({
      projectRoot,
      scenarioId: 'scn',
      platform: 'android',
      mode: 'b',
      opts: {},
      deps: {
        startHttpServer: jest.fn().mockResolvedValue(httpSrv),
        attachWsServer: jest.fn().mockReturnValue(wsCtx),
        startC3: jest.fn().mockResolvedValue(0),
        startModeB: jest.fn().mockResolvedValue(0),
        openInBrowser: jest.fn(),
      },
    });
    expect(wsCtx.close).toHaveBeenCalled();
    expect(httpSrv.close).toHaveBeenCalled();
  });
});
