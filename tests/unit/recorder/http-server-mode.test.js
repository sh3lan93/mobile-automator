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

  test('returns the session mode as JSON (allow_sensitive_input defaults to false)', async () => {
    const srv = await startHttpServer({ projectRoot: root, scenarioId: 's', mode: 'platform-agnostic' });
    const res = await get(srv.port, '/api/mode');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ mode: 'platform-agnostic', allow_sensitive_input: false });
    await srv.close();
  });

  test('defaults to platform-aware when mode not supplied (allow_sensitive_input defaults to false)', async () => {
    const srv = await startHttpServer({ projectRoot: root, scenarioId: 's' });
    const res = await get(srv.port, '/api/mode');
    expect(JSON.parse(res.body)).toEqual({ mode: 'platform-aware', allow_sensitive_input: false });
    await srv.close();
  });

  test('reflects allowSensitiveInput=true in the payload (slice #9)', async () => {
    const srv = await startHttpServer({ projectRoot: root, scenarioId: 's', allowSensitiveInput: true });
    const res = await get(srv.port, '/api/mode');
    expect(JSON.parse(res.body)).toEqual({ mode: 'platform-aware', allow_sensitive_input: true });
    await srv.close();
  });

  test('coerces truthy/falsy allowSensitiveInput to a boolean', async () => {
    const srv = await startHttpServer({ projectRoot: root, scenarioId: 's', allowSensitiveInput: 1 });
    const res = await get(srv.port, '/api/mode');
    expect(JSON.parse(res.body).allow_sensitive_input).toBe(true);
    await srv.close();
  });
});
