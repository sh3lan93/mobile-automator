'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const COLOR_RANGES = {
  // Android "Show taps": cyan/light-blue circle.
  light_blue: { rMin: 80, rMax: 180, gMin: 140, gMax: 220, bMin: 200, bMax: 255 },
  // iOS Simulator "Show Single Touches": translucent gray disk rendered by
  // the macOS host atop the iOS guest screen, intrinsic fill ~RGB(170,170,170).
  // The narrow brightness band (158–185) plus low `maxChannelDelta` (10)
  // isolates the disk's near-uniform mid-gray from real iOS UI pixels —
  // most app chrome is colour-tinted (channel delta > 10) or far outside
  // the brightness window, so background pollution is minimal.
  // Calibrated against `tests/fixtures/recorder/video-frames/ios-real-touch.png`.
  ios_simulator: { rMin: 158, rMax: 185, gMin: 158, gMax: 185, bMin: 158, bMax: 185, maxChannelDelta: 10 },
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
  const maxDelta = typeof rng.maxChannelDelta === 'number' ? rng.maxChannelDelta : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (r >= rng.rMin && r <= rng.rMax && g >= rng.gMin && g <= rng.gMax && b >= rng.bMin && b <= rng.bMax) {
        if (maxDelta !== null) {
          const minc = r < g ? (r < b ? r : b) : (g < b ? g : b);
          const maxc = r > g ? (r > b ? r : b) : (g > b ? g : b);
          if (maxc - minc > maxDelta) continue;
        }
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
    this._active = null;  // {x,y} of in-progress touch, or null
    this._lastT = 0;
  }

  feed(frame) {
    this._lastT = frame.t;
    const dot = detectIndicatorInFrame(frame.buf, { color: this._color });
    if (dot && !this._active) {
      this._emit({ kind: 'down', t: frame.t, x: dot.x, y: dot.y });
      this._active = { x: dot.x, y: dot.y };
    } else if (dot && this._active) {
      this._emit({ kind: 'move', t: frame.t, x: dot.x, y: dot.y });
      this._active = { x: dot.x, y: dot.y };
    } else if (!dot && this._active) {
      this._emit({ kind: 'up', t: frame.t, x: this._active.x, y: this._active.y });
      this._active = null;
    }
  }

  flush() {
    if (this._active) {
      this._emit({ kind: 'up', t: this._lastT, x: this._active.x, y: this._active.y });
      this._active = null;
    }
  }

  processFrames(frames) {
    // Back-compat batch API: a fresh, self-contained detection over `frames`.
    // Save and restore both _active and _lastT so a batch call cannot corrupt
    // the streaming state — without restoring _lastT a subsequent flush() would
    // emit an `up` at the batch's last-frame timestamp instead of the correct
    // streaming timestamp.
    const saved = this._active; this._active = null;
    const savedLastT = this._lastT;
    for (const frame of frames) this.feed(frame);
    if (this._active) {
      const last = frames[frames.length - 1];
      this._emit({ kind: 'up', t: last.t, x: this._active.x, y: this._active.y });
      this._active = null;
    }
    this._active = saved;
    this._lastT = savedLastT;
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
