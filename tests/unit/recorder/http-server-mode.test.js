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

describe('GET /api/mode', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-http-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('returns the session mode as JSON', async () => {
    const srv = await startHttpServer({ projectRoot: root, scenarioId: 's', mode: 'platform-agnostic' });
    const res = await get(srv.port, '/api/mode');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ mode: 'platform-agnostic' });
    await srv.close();
  });

  test('defaults to platform-aware when mode not supplied', async () => {
    const srv = await startHttpServer({ projectRoot: root, scenarioId: 's' });
    const res = await get(srv.port, '/api/mode');
    expect(JSON.parse(res.body)).toEqual({ mode: 'platform-aware' });
    await srv.close();
  });
});
