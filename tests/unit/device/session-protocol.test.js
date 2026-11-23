'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  FrameParser,
  MAX_NONCE_LENGTH,
  sessionProof,
  helloRequest,
  answerHello,
  verifyHello,
} = require('../../../src/device/session-protocol');

const SALT = 'a'.repeat(64);
const OTHER_SALT = 'b'.repeat(64);

describe('session-protocol', () => {
  // encode() writes a frame; push() reads it back — the two are inverses.
  test('a request frame round-trips through encode + push', () => {
    const req = { id: 7, type: 'call', tool: 'mobile_press_button', args: { button: 'BACK' } };
    const wire = FrameParser.encode(req);
    expect(wire.endsWith('\n')).toBe(true);
    expect(new FrameParser().push(wire).map((r) => r.value)).toEqual([req]);
  });

  test('a response frame round-trips through encode + push', () => {
    const res = { id: 7, ok: true, result: { ok: 1 } };
    const wire = FrameParser.encode(res);
    expect(wire.endsWith('\n')).toBe(true);
    expect(new FrameParser().push(wire).map((r) => r.value)).toEqual([res]);
  });

  describe('FrameParser', () => {
    test('yields one frame per complete line', () => {
      const p = new FrameParser();
      const out = p.push('{"a":1}\n{"b":2}\n');
      expect(out.map((r) => r.value)).toEqual([{ a: 1 }, { b: 2 }]);
    });

    test('buffers a partial chunk until the newline arrives', () => {
      const p = new FrameParser();
      expect(p.push('{"a":')).toEqual([]);
      const out = p.push('1}\n');
      expect(out.map((r) => r.value)).toEqual([{ a: 1 }]);
    });

    test('handles concatenated + split frames across chunks', () => {
      const p = new FrameParser();
      const first = p.push('{"a":1}\n{"b":');
      expect(first.map((r) => r.value)).toEqual([{ a: 1 }]);
      const second = p.push('2}\n{"c":3}\n');
      expect(second.map((r) => r.value)).toEqual([{ b: 2 }, { c: 3 }]);
    });

    test('reports a malformed line without throwing', () => {
      const p = new FrameParser();
      const out = p.push('not json\n{"ok":1}\n');
      expect(out[0].error).toBeInstanceOf(Error);
      expect(out[0].line).toBe('not json');
      expect(out[1].value).toEqual({ ok: 1 });
    });

    test('tolerates blank lines', () => {
      const p = new FrameParser();
      const out = p.push('\n{"a":1}\n\n');
      expect(out.map((r) => r.value)).toEqual([{ a: 1 }]);
    });
  });
});

describe('the hello handshake (#361)', () => {
  // #361: the daemon's answer to the client's hello. Pinned: a change to the
  // message format strands every running daemon, so it must be deliberate
  // (bump the v1 tag).
  test('sessionProof is HMAC-SHA256(salt, tagged real root + nonce), pinned', () => {
    const root = '/nonexistent-mauto-proof-root';
    expect(sessionProof('s3cret', root, 'n0nce')).toBe(
      'fd01870555e8efc7047c05fe52ca436fe2adff378a31124e2ac9ad36b1ca56fb'
    );
    expect(sessionProof('s3cret', `${root}/`, 'n0nce')).toBe(sessionProof('s3cret', root, 'n0nce'));
  });

  test('sessionProof differs per salt, root and nonce', () => {
    const p = sessionProof(SALT, '/a/proj', 'n');
    expect(sessionProof(OTHER_SALT, '/a/proj', 'n')).not.toBe(p);
    expect(sessionProof(SALT, '/a/proj2', 'n')).not.toBe(p);
    expect(sessionProof(SALT, '/a/proj', 'm')).not.toBe(p);
  });

  test('sessionProof keys by realpath, so one root reached two ways agrees', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-'));
    const link = `${real}-link`;
    fs.symlinkSync(real, link);
    try {
      expect(sessionProof(SALT, link, 'n')).toBe(sessionProof(SALT, real, 'n'));
    } finally {
      fs.unlinkSync(link);
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  test('helloRequest is a hello with a fresh 64-hex nonce, inside the daemon bound', () => {
    const a = helloRequest();
    const b = helloRequest();
    expect(a.type).toBe('hello');
    expect(a.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(a.nonce.length).toBeLessThanOrEqual(MAX_NONCE_LENGTH);
    expect(b.nonce).not.toBe(a.nonce);
  });

  test('answerHello proves the salt; verifyHello accepts it and nothing else', () => {
    const { nonce } = helloRequest();
    const res = answerHello(SALT, '/a/proj', { type: 'hello', nonce });
    expect(res).toEqual({ ok: true, result: { proof: sessionProof(SALT, '/a/proj', nonce) } });
    expect(verifyHello(SALT, '/a/proj', nonce, res)).toBe(true);
    expect(verifyHello(OTHER_SALT, '/a/proj', nonce, res)).toBe(false);
    expect(verifyHello(SALT, '/a/proj2', nonce, res)).toBe(false);
    expect(verifyHello(SALT, '/a/proj', 'other', res)).toBe(false);
    for (const bad of [null, {}, { ok: false }, { ok: true }, { ok: true, result: { proof: 42 } }, { ok: true, result: { proof: 'ab' } }]) {
      expect(verifyHello(SALT, '/a/proj', nonce, bad)).toBe(false);
    }
  });

  test('answerHello refuses a nonce that is missing, not a string, empty or over the bound', () => {
    const message = `hello needs a nonce: a string of 1 to ${MAX_NONCE_LENGTH} characters`;
    for (const nonce of [undefined, 7, '', 'x'.repeat(MAX_NONCE_LENGTH + 1)]) {
      expect(answerHello(SALT, '/a/proj', { type: 'hello', nonce })).toEqual({ ok: false, error: { message } });
    }
    expect(answerHello(SALT, '/a/proj', { type: 'hello', nonce: 'x'.repeat(MAX_NONCE_LENGTH) }).ok).toBe(true);
  });
});
