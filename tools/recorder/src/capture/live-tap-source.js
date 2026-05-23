'use strict';

// live-tap-source — runs a parallel platform-native screen pipe alongside
// mobile-mcp's own screen recording (which keeps producing the saved video
// for the artifact bundle). The pipe is downsampled by ffmpeg into a stream
// of small PNG frames; PngFramer splits them; StreamingVideoTapDetector
// turns visible touch indicators into {down, move, up} events; coords are
// rescaled from the downsampled space back to the device's logical
// resolution before being handed to the caller (which is mode-b.js, which
// feeds them into GestureClassifier).
//
// The mobile-mcp `mobile_start_screen_recording` call continues to run on
// its own — the two streams target the same device but do not interfere.

const { PngFramer } = require('./png-framer');
const { StreamingVideoTapDetector } = require('./video-tap-detector');

const KILL_GRACE_MS = 2000;

function buildCaptureArgs({ platform, deviceLabel }) {
  if (platform === 'android') {
    const prefix = deviceLabel ? ['-s', deviceLabel] : [];
    return {
      cmd: 'adb',
      args: [...prefix, 'exec-out', 'screenrecord', '--output-format=h264', '--time-limit', '180', '-'],
    };
  }
  if (platform === 'ios') {
    return {
      cmd: 'xcrun',
      args: ['simctl', 'io', 'booted', 'recordVideo', '--codec=h264', '-'],
    };
  }
  return null;
}

function buildFfmpegArgs({ fps, scaleHeight }) {
  return [
    '-loglevel', 'error',
    '-i', 'pipe:0',
    '-vf', `fps=${fps},scale=-1:${scaleHeight}`,
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-',
  ];
}

function colorForPlatform(platform) {
  return platform === 'ios' ? 'ios_simulator' : 'light_blue';
}

function createLiveTapSource({
  platform,
  mcpBridge,
  deviceLabel,
  fps = 15,
  scaleHeight = 1200,
  onEvent,
  onError,
  spawn = require('child_process').spawn,
} = {}) {
  let captureProc = null;
  let ffmpegProc = null;
  let stopped = false;

  const captureCmd = buildCaptureArgs({ platform, deviceLabel });

  async function start() {
    if (!captureCmd) {
      onError(new Error(`live-tap-source: unsupported platform "${platform}"`));
      return;
    }

    let screen;
    try {
      screen = await mcpBridge.getScreenSize();
    } catch (e) {
      onError(e);
      return;
    }

    const factor = screen.height / scaleHeight;
    const detector = new StreamingVideoTapDetector({
      color: colorForPlatform(platform),
      emit: ({ kind, t, x, y }) => onEvent({
        kind,
        t,
        x: Math.round(x * factor),
        y: Math.round(y * factor),
      }),
    });
    const framer = new PngFramer({
      onFrame: (buf) => {
        try {
          detector.feedFrame({ t: Date.now(), buf });
        } catch (e) {
          onError(e);
        }
      },
    });

    captureProc = spawn(captureCmd.cmd, captureCmd.args);
    ffmpegProc = spawn('ffmpeg', buildFfmpegArgs({ fps, scaleHeight }));

    // Glue the two pipes. captureProc.stdout → ffmpegProc.stdin.
    captureProc.stdout.pipe(ffmpegProc.stdin);

    ffmpegProc.stdout.on('data', (chunk) => framer.feed(chunk));

    // Drain stderr to avoid pipe deadlock.
    if (captureProc.stderr && typeof captureProc.stderr.resume === 'function') captureProc.stderr.resume();
    if (ffmpegProc.stderr && typeof ffmpegProc.stderr.resume === 'function') ffmpegProc.stderr.resume();

    captureProc.on('error', (err) => onError(err));
    captureProc.on('exit', (code) => {
      if (code != null && code !== 0 && code !== 143) {
        onError(new Error(`live-tap-source: capture process exit ${code}`));
      }
    });
    ffmpegProc.on('error', (err) => onError(err));
    ffmpegProc.on('exit', (code) => {
      if (code != null && code !== 0 && code !== 143) {
        onError(new Error(`live-tap-source: ffmpeg process exit ${code}`));
      }
    });

    // Expose the detector so flush() runs at stop time.
    stopHooks.push(() => { try { detector.flush(); } catch (_e) { /* swallow */ } });
  }

  const stopHooks = [];

  function stop() {
    if (stopped) return;
    stopped = true;

    for (const hook of stopHooks) hook();

    for (const proc of [captureProc, ffmpegProc]) {
      if (!proc) continue;
      try { proc.kill('SIGTERM'); } catch (_e) { /* swallow */ }
    }

    const killTimer = setTimeout(() => {
      for (const proc of [captureProc, ffmpegProc]) {
        if (!proc) continue;
        if (proc.killed) continue;
        try { proc.kill('SIGKILL'); } catch (_e) { /* swallow */ }
      }
    }, KILL_GRACE_MS);
    if (typeof killTimer.unref === 'function') killTimer.unref();
  }

  return { start, stop };
}

module.exports = { createLiveTapSource, KILL_GRACE_MS };
