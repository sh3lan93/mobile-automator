'use strict';

// PngFramer — splits a stream of concatenated PNG files into individual
// frame buffers. ffmpeg with `-f image2pipe -vcodec png -` emits PNG files
// back-to-back with no delimiter beyond each PNG's own structure, so a
// consumer needs to detect frame boundaries.
//
// A PNG file always ends with an IEND chunk whose serialised form on the
// wire is the fixed 8-byte sequence:
//   0x49 0x45 0x4E 0x44  (type 'IEND')
//   0xAE 0x42 0x60 0x82  (CRC of an empty IEND chunk)
// The CRC is deterministic because IEND carries no payload, so the full
// 8-byte tail is identical across every well-formed PNG. Finding that
// sequence in the accumulated buffer is sufficient to mark a frame end.
//
// Collisions inside earlier IDAT payloads are theoretically possible but
// vanishingly unlikely for compressed image data; if it ever surfaces in
// practice the right upgrade is full chunk-length parsing.

const PNG_IEND_TAIL = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);

class PngFramer {
  constructor({ onFrame }) {
    this._buf = Buffer.alloc(0);
    this._onFrame = onFrame;
  }

  feed(chunk) {
    if (!chunk || chunk.length === 0) return;
    this._buf = Buffer.concat([this._buf, chunk]);
    let end;
    while ((end = this._buf.indexOf(PNG_IEND_TAIL)) !== -1) {
      const frameEnd = end + PNG_IEND_TAIL.length;
      const frame = this._buf.slice(0, frameEnd);
      this._buf = this._buf.slice(frameEnd);
      this._onFrame(frame);
    }
  }
}

module.exports = { PngFramer, PNG_IEND_TAIL };
