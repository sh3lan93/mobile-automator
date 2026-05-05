'use strict';

const { WebSocketServer } = require('ws');

function attachWsServer({ httpServer }) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set();
  const messageHandlers = [];
  const disconnectHandlers = [];
  let lastBroadcast = null;

  wss.on('connection', (ws) => {
    clients.add(ws);
    if (lastBroadcast) {
      const cached = JSON.stringify(lastBroadcast);
      setTimeout(() => { if (ws.readyState === 1) ws.send(cached); }, 0);
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
    onDisconnect(fn) { disconnectHandlers.push(fn); },
    clientCount() { return clients.size; },
    close() { wss.close(); },
  };
}

module.exports = { attachWsServer };
