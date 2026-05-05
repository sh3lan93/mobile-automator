'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const COLOR_RANGES = {
  light_blue: { rMin: 80, rMax: 180, gMin: 140, gMax: 220, bMin: 200, bMax: 255 },
};

function readPngPixels(buf) {
  // Minimal PNG decoder: lazy-load `pngjs` if available; otherwise fall back to ffmpeg-extracted RGBA.
  // For unit tests we use small PNGs and ImageMagick produces uncompressed-friendly output.
  // We'll use Node's built-in `zlib` + a tiny PNG IHDR parser. For brevity, depend on `pngjs`.
  // (Add `pngjs` to recorder package.json deps if not present.)
  const { PNG } = require('pngjs');
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function detectIndicatorInFrame(buf, { color = 'light_blue', minPixels = 6 } = {}) {
  const { width, height, data } = readPngPixels(buf);
  const rng = COLOR_RANGES[color];
  let sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (r >= rng.rMin && r <= rng.rMax && g >= rng.gMin && g <= rng.gMax && b >= rng.bMin && b <= rng.bMax) {
        sumX += x; sumY += y; count += 1;
      }
    }
  }
  if (count < minPixels) return null;
  return { x: Math.round(sumX / count), y: Math.round(sumY / count) };
}

class VideoTapDetector {
  constructor({ emit, color = 'light_blue', fps = 30 }) {
    this._emit = emit;
    this._color = color;
    this._fps = fps;
  }

  processFrames(frames) {
    let active = null;
    for (const frame of frames) {
      const dot = detectIndicatorInFrame(frame.buf, { color: this._color });
      if (dot && !active) {
        this._emit({ kind: 'down', t: frame.t, x: dot.x, y: dot.y });
        active = { x: dot.x, y: dot.y };
      } else if (dot && active) {
        this._emit({ kind: 'move', t: frame.t, x: dot.x, y: dot.y });
        active = { x: dot.x, y: dot.y };
      } else if (!dot && active) {
        this._emit({ kind: 'up', t: frame.t, x: active.x, y: active.y });
        active = null;
      }
    }
    if (active) {
      const last = frames[frames.length - 1];
      this._emit({ kind: 'up', t: last.t, x: active.x, y: active.y });
    }
  }

  /** Run ffmpeg to extract frames; returns Promise<Array<{t, buf}>>. Used in integration tests. */
  async extractFrames(videoPath, outDir) {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-i', videoPath, '-vf', `fps=${this._fps}`, path.join(outDir, 'frame_%05d.png')]);
      ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    });
    const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort();
    return files.map((f, i) => ({ t: Math.round((i * 1000) / this._fps), buf: fs.readFileSync(path.join(outDir, f)) }));
  }
}

module.exports = { detectIndicatorInFrame, VideoTapDetector };
