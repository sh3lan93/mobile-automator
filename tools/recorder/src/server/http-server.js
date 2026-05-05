'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const WEB_ROOT = path.resolve(__dirname, '..', '..', 'web');

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(WEB_ROOT, urlPath);
  if (!filePath.startsWith(WEB_ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

async function startHttpServer({ projectRoot, scenarioId, requestHandler = null }) {
  const server = http.createServer((req, res) => {
    if (requestHandler) { try { if (requestHandler(req, res)) return; } catch (e) { /* fall through */ } }
    serveStatic(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = server.address().port;
  const portFile = path.join(projectRoot, 'mobile-automator', '.recorder', scenarioId, 'recorder.port');
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(port));
  process.env.MOBILE_AUTOMATOR_RECORDER_PORT = String(port);

  return {
    port,
    server,
    close: () => new Promise((res) => server.close(() => res())),
  };
}

module.exports = { startHttpServer };
