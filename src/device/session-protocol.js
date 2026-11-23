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
// The daemon answers hello with { id, ok: true, result: { proof } }: proof that
// it holds this workspace's session secret (.session/marker.salt). The client
// sends nothing else until the proof checks out. The handshake's three steps
// live here, below FrameParser: helloRequest (client), answerHello (daemon)
// and verifyHello (client). A daemon older than the handshake answers
// `unknown request type`, which the client reads as "no daemon".
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

const crypto = require('crypto');

const { realOrResolved } = require('../util/real-or-resolved');

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

// The hello handshake (#361), in one place: the nonce the client sends, the
// bound the daemon holds it to, the proof, and the check.
//
// The client's nonce: 32 random bytes as hex (64 characters).
const HELLO_NONCE_BYTES = 32;
// The longest nonce the daemon will HMAC, so a peer cannot make it hash an
// arbitrary amount. The client's own is well inside it.
const MAX_NONCE_LENGTH = 256;

// HMAC-SHA256 keyed by the workspace salt over a tagged message naming the
// real project root and the client's nonce, as hex. Only a process that can
// read this workspace's .session/marker.salt can produce it, and the root
// keeps a copied workspace (which carries the salt) from vouching for the
// original. The nonce makes each answer single-use. The `v1` tag versions the
// message: changing it strands every running daemon, so it changes only with
// the tag.
function sessionProof(salt, projectRoot, nonce) {
  const message = `mauto-session-proof:v1\n${realOrResolved(projectRoot)}\n${nonce}`;
  return crypto.createHmac('sha256', String(salt)).update(message).digest('hex');
}

// Client: the hello frame to send (without its id), with a fresh nonce.
function helloRequest() {
  return { type: 'hello', nonce: crypto.randomBytes(HELLO_NONCE_BYTES).toString('hex') };
}

// Daemon: the reply body (without its id) to a hello frame `req`. A nonce that
// is missing, not a string, empty or longer than MAX_NONCE_LENGTH is refused.
function answerHello(salt, projectRoot, req) {
  const { nonce } = req;
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > MAX_NONCE_LENGTH) {
    return { ok: false, error: { message: `hello needs a nonce: a string of 1 to ${MAX_NONCE_LENGTH} characters` } };
  }
  return { ok: true, result: { proof: sessionProof(salt, projectRoot, nonce) } };
}

// Client: did the reply `res` to the hello carrying `nonce` prove the salt?
// Constant-time, and false for anything that is not an ok reply carrying a
// proof string of the expected length.
function verifyHello(salt, projectRoot, nonce, res) {
  const got = res && res.ok && res.result ? res.result.proof : null;
  if (typeof got !== 'string') return false;
  const a = Buffer.from(got, 'utf8');
  const b = Buffer.from(sessionProof(salt, projectRoot, nonce), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  FrameParser,
  MAX_NONCE_LENGTH,
  sessionProof,
  helloRequest,
  answerHello,
  verifyHello,
};
