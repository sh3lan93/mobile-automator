'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { startHttpServer } = require('../../../tools/recorder/src/server/http-server');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('http-server', () => {
  let projectRoot;
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-srv-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator', '.recorder', 's'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('binds to localhost on a kernel-assigned port and writes port file', async () => {
    const srv = await startHttpServer({ projectRoot, scenarioId: 's' });
    expect(srv.port).toBeGreaterThan(0);
    const portFile = path.join(projectRoot, 'mobile-automator/.recorder/s/recorder.port');
    expect(fs.readFileSync(portFile, 'utf8').trim()).toBe(String(srv.port));
    await srv.close();
  });

  test('serves index.html at /', async () => {
    const srv = await startHttpServer({ projectRoot, scenarioId: 's' });
    const res = await get(srv.port, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Mobile Automator Recorder');
    await srv.close();
  });

  test('returns 404 on unknown paths', async () => {
    const srv = await startHttpServer({ projectRoot, scenarioId: 's' });
    const res = await get(srv.port, '/nope');
    expect(res.status).toBe(404);
    await srv.close();
  });
});
