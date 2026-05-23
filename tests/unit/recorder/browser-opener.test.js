'use strict';

const { EventEmitter } = require('events');
const { openInBrowser } = require('../../../tools/recorder/src/server/browser-opener');

function makeFakeSpawn() {
  const calls = [];
  const procs = [];
  const fn = jest.fn((cmd, args, opts) => {
    const proc = new EventEmitter();
    proc.unref = jest.fn();
    calls.push({ cmd, args, opts });
    procs.push(proc);
    return proc;
  });
  fn._calls = calls;
  fn._procs = procs;
  return fn;
}

describe('openInBrowser', () => {
  const url = 'http://127.0.0.1:54321/';

  test('darwin: spawns `open` with the URL, detached, stdio ignored', () => {
    const spawn = makeFakeSpawn();
    openInBrowser({ url, platform: 'darwin', spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    const call = spawn._calls[0];
    expect(call.cmd).toBe('open');
    expect(call.args).toEqual([url]);
    expect(call.opts).toEqual(expect.objectContaining({ detached: true, stdio: 'ignore' }));
  });

  test('linux: spawns `xdg-open` with the URL', () => {
    const spawn = makeFakeSpawn();
    openInBrowser({ url, platform: 'linux', spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    const call = spawn._calls[0];
    expect(call.cmd).toBe('xdg-open');
    expect(call.args).toEqual([url]);
    expect(call.opts).toEqual(expect.objectContaining({ detached: true, stdio: 'ignore' }));
  });

  test('win32: spawns `cmd /c start "" <url>`', () => {
    const spawn = makeFakeSpawn();
    openInBrowser({ url, platform: 'win32', spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    const call = spawn._calls[0];
    expect(call.cmd).toBe('cmd');
    expect(call.args).toEqual(['/c', 'start', '', url]);
    expect(call.opts).toEqual(expect.objectContaining({ detached: true, stdio: 'ignore' }));
  });

  test('unknown platform: does not throw, does not spawn, logs a warning', () => {
    const spawn = makeFakeSpawn();
    const warn = jest.fn();
    expect(() => openInBrowser({ url, platform: 'sunos', spawn, warn })).not.toThrow();
    expect(spawn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('noGui=true: does not spawn regardless of platform', () => {
    const spawn = makeFakeSpawn();
    openInBrowser({ url, platform: 'darwin', spawn, noGui: true });
    expect(spawn).not.toHaveBeenCalled();
  });

  test('returned child proc is unref-ed', () => {
    const spawn = makeFakeSpawn();
    openInBrowser({ url, platform: 'darwin', spawn });
    expect(spawn._procs[0].unref).toHaveBeenCalledTimes(1);
  });

  test('missing url: does not spawn, does not throw', () => {
    const spawn = makeFakeSpawn();
    expect(() => openInBrowser({ url: undefined, platform: 'darwin', spawn })).not.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('spawn throwing synchronously is swallowed (best-effort launch)', () => {
    const spawn = jest.fn(() => { throw new Error('ENOENT'); });
    const warn = jest.fn();
    expect(() => openInBrowser({ url, platform: 'darwin', spawn, warn })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
