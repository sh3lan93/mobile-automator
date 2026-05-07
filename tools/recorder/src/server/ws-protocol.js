'use strict';

const { WebSocketServer } = require('ws');

function attachWsServer({ httpServer }) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set();
  const messageHandlers = [];
  const disconnectHandlers = [];
  const connectHandlers = [];
  let lastBroadcast = null;

  wss.on('connection', (ws) => {
    clients.add(ws);
    for (const h of connectHandlers) h();
    if (lastBroadcast) {
      const cached = JSON.stringify(lastBroadcast);
      // Deferred so the client's 'open' event resolves and the test/consumer
      // can attach its 'message' listener before the cached payload arrives.
      // setTimeout(0) loses this race under jest's full-suite load; 25ms is
      // generous enough to win reliably while staying invisible to the user.
      setTimeout(() => { if (ws.readyState === 1) ws.send(cached); }, 25);
    }
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      for (const h of messageHandlers) h(msg);
    });
    ws.on('close', () => {
      clients.delete(ws);
      for (const h of disconnectHandlers) h();
    });
  });

  return {
    broadcast(message) {
      lastBroadcast = message;
      const data = JSON.stringify(message);
      for (const c of clients) {
        if (c.readyState === 1) c.send(data);
      }
    },
    onMessage(fn) { messageHandlers.push(fn); },
    onConnect(fn) { connectHandlers.push(fn); },
    onDisconnect(fn) { disconnectHandlers.push(fn); },
    clientCount() { return clients.size; },
    close() { wss.close(); },
  };
}

module.exports = { attachWsServer };
