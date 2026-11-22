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
//   { id, type: 'hello', nonce }         — handshake (#361): the client's
//                                          first frame on every connection
//
// The daemon answers hello with { id, ok: true, result: { proof } }, where
// proof is session-paths.sessionProof(salt, projectRoot, nonce): proof that it
// holds this workspace's session secret (.session/marker.salt). The client
// sends nothing else until the proof checks out. A nonce that is missing, not
// a string, empty or longer than 256 characters is refused (ok: false). A
// daemon older than the handshake answers `unknown request type`, which the
// client reads as "no daemon".
//
// Response frames:
//   { id, ok: true, result }
//   { id, ok: false, error: { message } }
//
// FrameParser owns the framing on both sides: encode() writes a frame, push()
// buffers partial chunks and yields whole frames. A malformed line is REPORTED
// (yielded as an error frame), never thrown — a single bad line must not kill
// the connection. (The encode/decode of a single frame is a JSON.stringify /
// JSON.parse one-liner with no independent reason to live as separate exports,
// so they fold into the one module that earns its keep.)

const NL = '\n';

// Buffers byte chunks and yields one parsed object per complete '\n'-terminated
// line. push() returns an array of results; each result is either
// { value } for a parsed object or { error, line } for a malformed line.
class FrameParser {
  // Serialize a request/response object to one newline-terminated wire frame.
  static encode(obj) {
    return JSON.stringify(obj) + NL;
  }

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
  FrameParser,
};
