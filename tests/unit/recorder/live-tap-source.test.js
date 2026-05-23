'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { createLiveTapSource } = require('../../../tools/recorder/src/capture/live-tap-source');

const FRAMES = path.resolve(__dirname, '../../fixtures/recorder/video-frames');
const PNG_DOT = fs.readFileSync(path.join(FRAMES, 'dot-at-50-30.png'));
const PNG_NO_DOT = fs.readFileSync(path.join(FRAMES, 'no-indicator.png'));
const PNG_IOS_DOT = fs.readFileSync(path.join(FRAMES, 'ios-dot-at-50-30.png'));

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.kill = jest.fn();
  proc.killed = false;
  return proc;
}

function makeSpawn() {
  const calls = [];
  const procs = [];
  const fn = jest.fn((cmd, args) => {
    const proc = makeFakeProc();
    calls.push({ cmd, args, proc });
    procs.push(proc);
    return proc;
  });
  return Object.assign(fn, { calls, procs });
}

function fakeMcpBridge({ width = 400, height = 200, fail = false } = {}) {
  return {
    getScreenSize: jest.fn(async () => {
      if (fail) throw new Error('device offline');
      return { width, height };
    }),
  };
}

describe('createLiveTapSource', () => {
  test('refuses to start when getScreenSize rejects and never spawns the capture chain', async () => {
    const spawn = makeSpawn();
    const errors = [];
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge({ fail: true }),
      onEvent: jest.fn(),
      onError: (err) => errors.push(err),
      spawn,
    });
    await tapSource.start();
    expect(spawn).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/device offline/);
  });

  test('on Android with no deviceLabel, spawns `adb exec-out screenrecord -` and pipes to ffmpeg', async () => {
    const spawn = makeSpawn();
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.calls[0].cmd).toBe('adb');
    expect(spawn.calls[0].args).toEqual([
      'exec-out', 'screenrecord', '--output-format=h264', '--time-limit', '180', '-',
    ]);
    expect(spawn.calls[1].cmd).toBe('ffmpeg');
  });

  test('on Android with a deviceLabel, targets that device with `adb -s <label>`', async () => {
    const spawn = makeSpawn();
    const tapSource = createLiveTapSource({
      platform: 'android',
      deviceLabel: 'emulator-5554',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    expect(spawn.calls[0].cmd).toBe('adb');
    expect(spawn.calls[0].args.slice(0, 2)).toEqual(['-s', 'emulator-5554']);
  });

  test('on iOS, spawns `xcrun simctl io booted recordVideo --codec=h264 -`', async () => {
    const spawn = makeSpawn();
    const tapSource = createLiveTapSource({
      platform: 'ios',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    expect(spawn.calls[0].cmd).toBe('xcrun');
    expect(spawn.calls[0].args).toEqual([
      'simctl', 'io', 'booted', 'recordVideo', '--codec=h264', '-',
    ]);
  });

  test('configures ffmpeg with the right image2pipe args and scaleHeight', async () => {
    const spawn = makeSpawn();
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge(),
      fps: 12,
      scaleHeight: 1000,
      onEvent: jest.fn(),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    expect(spawn.calls[1].cmd).toBe('ffmpeg');
    const args = spawn.calls[1].args;
    expect(args).toContain('-i');
    expect(args).toContain('pipe:0');
    expect(args).toContain('-f');
    expect(args).toContain('image2pipe');
    expect(args).toContain('-vcodec');
    expect(args).toContain('png');
    // Find the -vf arg
    const vfIdx = args.indexOf('-vf');
    expect(vfIdx).toBeGreaterThanOrEqual(0);
    expect(args[vfIdx + 1]).toBe('fps=12,scale=-1:1000');
  });

  test('feeding a PNG through fake ffmpeg stdout produces a down event with rescaled coordinates', async () => {
    const spawn = makeSpawn();
    const events = [];
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge({ width: 400, height: 200 }),
      scaleHeight: 100, // matches fixture height (200x100), so rescale factor = 200/100 = 2x
      onEvent: (e) => events.push(e),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    const ffmpegProc = spawn.calls[1].proc;
    ffmpegProc.stdout.write(PNG_DOT);
    // PassThrough is synchronous on small writes, but be defensive.
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('down');
    // Fixture dot is at ~(50, 30); with 2x rescale, expect ~(100, 60).
    expect(events[0].x).toBeGreaterThanOrEqual(95);
    expect(events[0].x).toBeLessThanOrEqual(105);
    expect(events[0].y).toBeGreaterThanOrEqual(55);
    expect(events[0].y).toBeLessThanOrEqual(65);
  });

  test('on iOS, uses the ios_simulator colour profile (rejects light_blue indicator)', async () => {
    const spawn = makeSpawn();
    const events = [];
    const tapSource = createLiveTapSource({
      platform: 'ios',
      mcpBridge: fakeMcpBridge({ width: 200, height: 100 }),
      scaleHeight: 100,
      onEvent: (e) => events.push(e),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    const ffmpegProc = spawn.calls[1].proc;
    ffmpegProc.stdout.write(PNG_DOT); // light_blue dot fixture — must NOT register under iOS profile
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([]);
    ffmpegProc.stdout.write(PNG_IOS_DOT); // grey-disk fixture — should register
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('down');
  });

  test('a full down/no-dot cycle through fake ffmpeg emits down then up', async () => {
    const spawn = makeSpawn();
    const events = [];
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge({ width: 200, height: 100 }),
      scaleHeight: 100,
      onEvent: (e) => events.push(e),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    const ffmpegProc = spawn.calls[1].proc;
    ffmpegProc.stdout.write(PNG_DOT);
    await new Promise((resolve) => setImmediate(resolve));
    ffmpegProc.stdout.write(PNG_NO_DOT);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.map((e) => e.kind)).toEqual(['down', 'up']);
  });

  test('stop() sends SIGTERM to both processes', async () => {
    const spawn = makeSpawn();
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: jest.fn(),
      spawn,
    });
    await tapSource.start();
    tapSource.stop();
    expect(spawn.calls[0].proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawn.calls[1].proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('stop() escalates to SIGKILL if processes have not exited after the grace period', async () => {
    jest.useFakeTimers();
    try {
      const spawn = makeSpawn();
      const tapSource = createLiveTapSource({
        platform: 'android',
        mcpBridge: fakeMcpBridge(),
        onEvent: jest.fn(),
        onError: jest.fn(),
        spawn,
      });
      await tapSource.start();
      tapSource.stop();
      // SIGTERM sent immediately, SIGKILL deferred.
      expect(spawn.calls[0].proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(spawn.calls[0].proc.kill).not.toHaveBeenCalledWith('SIGKILL');
      jest.advanceTimersByTime(2000);
      expect(spawn.calls[0].proc.kill).toHaveBeenCalledWith('SIGKILL');
      expect(spawn.calls[1].proc.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });

  test('non-zero exit from the capture process invokes onError', async () => {
    const spawn = makeSpawn();
    const errors = [];
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: (err) => errors.push(err),
      spawn,
    });
    await tapSource.start();
    spawn.calls[0].proc.emit('exit', 1);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/capture.*exit.*1/i);
  });

  test('SIGTERM exit (code 143) from the capture process does NOT invoke onError', async () => {
    const spawn = makeSpawn();
    const errors = [];
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: (err) => errors.push(err),
      spawn,
    });
    await tapSource.start();
    spawn.calls[0].proc.emit('exit', 143);
    expect(errors).toEqual([]);
  });

  test('non-zero exit from ffmpeg invokes onError', async () => {
    const spawn = makeSpawn();
    const errors = [];
    const tapSource = createLiveTapSource({
      platform: 'android',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: (err) => errors.push(err),
      spawn,
    });
    await tapSource.start();
    spawn.calls[1].proc.emit('exit', 2);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/ffmpeg.*exit.*2/i);
  });

  test('rejects an unknown platform', async () => {
    const spawn = makeSpawn();
    const errors = [];
    const tapSource = createLiveTapSource({
      platform: 'windows',
      mcpBridge: fakeMcpBridge(),
      onEvent: jest.fn(),
      onError: (err) => errors.push(err),
      spawn,
    });
    await tapSource.start();
    expect(spawn).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/platform.*windows/i);
  });
});
