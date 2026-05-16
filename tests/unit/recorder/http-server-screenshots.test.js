'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { startHttpServer } = require('../../../tools/recorder/src/server/http-server');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

describe('GET /screenshots/:file.png', () => {
  let projectRoot;
  let srv;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-shots-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator', '.recorder', 's', 'screenshots'), { recursive: true });
    srv = await startHttpServer({ projectRoot, scenarioId: 's' });
  });

  afterEach(async () => {
    await srv.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('serves a PNG file from the bundle screenshots dir with Content-Type image/png', async () => {
    const screenshotsDir = path.join(projectRoot, 'mobile-automator', '.recorder', 's', 'screenshots');
    const dummyPng = Buffer.alloc(10);
    fs.writeFileSync(path.join(screenshotsDir, 'assert_a1.png'), dummyPng);

    const res = await get(srv.port, '/screenshots/assert_a1.png');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBe(10);
  });

  test('returns 404 for path traversal attempt (../../etc/passwd)', async () => {
    const res = await get(srv.port, '/screenshots/../../etc/passwd');

    expect(res.status).toBe(404);
  });

  test('returns 404 for non-PNG extension (.txt)', async () => {
    const screenshotsDir = path.join(projectRoot, 'mobile-automator', '.recorder', 's', 'screenshots');
    fs.writeFileSync(path.join(screenshotsDir, 'note.txt'), 'hello');

    const res = await get(srv.port, '/screenshots/note.txt');

    expect(res.status).toBe(404);
  });

  test('returns 404 for non-existent file', async () => {
    const res = await get(srv.port, '/screenshots/does_not_exist.png');

    expect(res.status).toBe(404);
  });
});
