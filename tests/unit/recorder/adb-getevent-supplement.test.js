'use strict';

const { EventEmitter } = require('events');
const { AdbGeteventSupplement } = require('../../../tools/recorder/src/capture/adb-getevent');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdout.setEncoding = () => {};
  proc.kill = jest.fn();
  return proc;
}

describe('AdbGeteventSupplement', () => {
  test('on iOS, start() is a no-op and never spawns adb', () => {
    const spawn = jest.fn();
    const emit = jest.fn();
    const sup = new AdbGeteventSupplement({ platform: 'ios', emit, spawn });
    sup.start();
    expect(spawn).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(sup.disabled).toBe(true);
  });

  test('on Android, spawns `adb shell getevent -lt` and parses stdout chunks', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn(() => proc);
    const emitted = [];
    const sup = new AdbGeteventSupplement({
      platform: 'android',
      emit: (e) => emitted.push(e),
      tStart: 17236.789,
      spawn,
    });
    sup.start();

    expect(spawn).toHaveBeenCalledWith('adb', ['shell', 'getevent', '-lt']);
    expect(sup.disabled).toBe(false);

    proc.stdout.emit('data', '[   17236.789012] /dev/input/event0: EV_KEY       KEY_BACK             DOWN\n');
    proc.stdout.emit('data', '[   17236.834521] /dev/input/event0: EV_KEY       KEY_BACK             UP\n');

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ kind: 'key', key: 'BACK', state: 'down' });
    expect(emitted[1]).toMatchObject({ kind: 'key', key: 'BACK', state: 'up' });
  });

  test('feeds partial chunks into the parser correctly', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn(() => proc);
    const emitted = [];
    const sup = new AdbGeteventSupplement({ platform: 'android', emit: (e) => emitted.push(e), spawn });
    sup.start();

    proc.stdout.emit('data', '[   17236.789012] /dev/input/event0: EV_KEY       KEY_BACK             DOWN\n[   17236.834');
    proc.stdout.emit('data', '521] /dev/input/event0: EV_KEY       KEY_BACK             UP\n');

    expect(emitted).toHaveLength(2);
    expect(emitted.map((e) => e.state)).toEqual(['down', 'up']);
  });

  test('on close, flushes a trailing line that lacked a newline', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn(() => proc);
    const emitted = [];
    const sup = new AdbGeteventSupplement({ platform: 'android', emit: (e) => emitted.push(e), spawn });
    sup.start();

    proc.stdout.emit('data', '[   17236.789012] /dev/input/event0: EV_KEY       KEY_BACK             DOWN');
    expect(emitted).toHaveLength(0);
    proc.emit('close');
    expect(emitted).toHaveLength(1);
  });

  test('handles synchronous spawn ENOENT by warning once and disabling, no crash', () => {
    const spawn = jest.fn(() => { const err = new Error('spawn adb ENOENT'); err.code = 'ENOENT'; throw err; });
    const warn = jest.fn();
    const emit = jest.fn();
    const sup = new AdbGeteventSupplement({ platform: 'android', emit, spawn, warn });
    sup.start();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('adb: command not found; hardware key events disabled');
    expect(sup.disabled).toBe(true);
  });

  test('handles asynchronous proc error event with ENOENT', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn(() => proc);
    const warn = jest.fn();
    const emit = jest.fn();
    const sup = new AdbGeteventSupplement({ platform: 'android', emit, spawn, warn });
    sup.start();

    const err = new Error('spawn adb ENOENT'); err.code = 'ENOENT';
    proc.emit('error', err);

    expect(warn).toHaveBeenCalledWith('adb: command not found; hardware key events disabled');
    expect(sup.disabled).toBe(true);
  });

  test('non-ENOENT spawn errors disable the supplement silently (no spurious warning)', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn(() => proc);
    const warn = jest.fn();
    const sup = new AdbGeteventSupplement({ platform: 'android', emit: jest.fn(), spawn, warn });
    sup.start();

    proc.emit('error', new Error('something else'));

    expect(warn).not.toHaveBeenCalled();
    expect(sup.disabled).toBe(true);
  });

  test('stop() kills the child process and flushes the parser', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn(() => proc);
    const emitted = [];
    const sup = new AdbGeteventSupplement({ platform: 'android', emit: (e) => emitted.push(e), spawn });
    sup.start();

    proc.stdout.emit('data', '[   17236.789012] /dev/input/event0: EV_KEY       KEY_BACK             DOWN');
    sup.stop();

    expect(proc.kill).toHaveBeenCalled();
    expect(emitted).toHaveLength(1); // trailing line flushed by parser.end()
  });
});
