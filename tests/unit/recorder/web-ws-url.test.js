/**
 * @jest-environment jsdom
 */

'use strict';

// Mark the environment so app.js does not auto-connect a real WebSocket.
window.__RECORDER_TEST__ = true;

const path = require('path');
const appPath = path.resolve(__dirname, '../../../tools/recorder/web/app.js');

// eslint-disable-next-line import/no-dynamic-require
const app = require(appPath);

describe('recorderWsUrl', () => {
  test('builds a ws:// URL from an http: location', () => {
    expect(app.recorderWsUrl({ protocol: 'http:', host: '127.0.0.1:56166' }))
      .toBe('ws://127.0.0.1:56166/ws');
  });

  test('builds a wss:// URL from an https: location', () => {
    expect(app.recorderWsUrl({ protocol: 'https:', host: 'example.test:443' }))
      .toBe('wss://example.test:443/ws');
  });

  test('result does NOT contain the old hardcoded port 7681 (regression guard)', () => {
    expect(app.recorderWsUrl({ protocol: 'http:', host: '127.0.0.1:40000' }))
      .not.toContain('7681');
  });
});
