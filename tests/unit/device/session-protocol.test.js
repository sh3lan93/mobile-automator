'use strict';

const { FrameParser } = require('../../../src/device/session-protocol');

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
