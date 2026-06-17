'use strict';

// Newline-delimited JSON framing for the device session daemon protocol.
//
// The client sends request frames; the daemon replies with response frames.
// Each frame is a single JSON object terminated by exactly one '\n'. Requests
// carry an `id` so a client can correlate responses on a multiplexed socket.
//
// Request frames:
//   { id, type: 'call', tool, args }     — route a mobile-mcp tool call
//   { id, type: 'shutdown' }             — control: ask the daemon to exit
//   { id, type: 'ping' }                 — liveness probe
//
// Response frames:
//   { id, ok: true, result }
//   { id, ok: false, error: { message } }
//
// All encoders are pure; FrameParser buffers partial chunks and yields whole
// frames. A malformed line is REPORTED (yielded as an error frame), never
// thrown — a single bad line must not kill the connection.

const NL = '\n';

function encodeRequest(req) {
  return JSON.stringify(req) + NL;
}

function decodeRequest(line) {
  return JSON.parse(line);
}

function encodeResponse(res) {
  return JSON.stringify(res) + NL;
}

function decodeResponse(line) {
  return JSON.parse(line);
}

// Buffers byte chunks and yields one parsed object per complete '\n'-terminated
// line. push() returns an array of results; each result is either
// { value } for a parsed object or { error, line } for a malformed line.
class FrameParser {
  constructor() {
    this._buf = '';
  }

  push(chunk) {
    this._buf += chunk == null ? '' : String(chunk);
    const out = [];
    let idx;
    while ((idx = this._buf.indexOf(NL)) !== -1) {
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (line.length === 0) continue; // tolerate blank lines
      try {
        out.push({ value: JSON.parse(line) });
      } catch (err) {
        out.push({ error: err, line });
      }
    }
    return out;
  }
}

module.exports = {
  encodeRequest,
  decodeRequest,
  encodeResponse,
  decodeResponse,
  FrameParser,
};
