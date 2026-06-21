'use strict';

const { openInBrowser } = require('../../../tools/recorder/src/server/browser-opener');

function makeFakeProc() {
  return { unref: jest.fn() };
}

describe('openInBrowser (server/browser-opener)', () => {
  const url = 'http://127.0.0.1:54321/';

  test('darwin spawns `open` with [url] and unrefs', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn().mockReturnValue(proc);
    const warn = jest.fn();
    openInBrowser({ url, platform: 'darwin', spawn, warn });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('open', [url], expect.objectContaining({ detached: true, stdio: 'ignore' }));
    expect(proc.unref).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('linux spawns `xdg-open` with [url]', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn().mockReturnValue(proc);
    const warn = jest.fn();
    openInBrowser({ url, platform: 'linux', spawn, warn });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('xdg-open', [url], expect.objectContaining({ detached: true, stdio: 'ignore' }));
    expect(warn).not.toHaveBeenCalled();
  });

  test('win32 spawns `cmd` with [/c, start, "", url]', () => {
    const proc = makeFakeProc();
    const spawn = jest.fn().mockReturnValue(proc);
    const warn = jest.fn();
    openInBrowser({ url, platform: 'win32', spawn, warn });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('cmd', ['/c', 'start', '', url], expect.objectContaining({ detached: true, stdio: 'ignore' }));
    expect(warn).not.toHaveBeenCalled();
  });

  test('unsupported platform does not spawn and warns', () => {
    const spawn = jest.fn();
    const warn = jest.fn();
    openInBrowser({ url, platform: 'sunos', spawn, warn });
    expect(spawn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('sunos');
  });

  test('noGui: true does not spawn', () => {
    const spawn = jest.fn();
    const warn = jest.fn();
    openInBrowser({ url, platform: 'darwin', noGui: true, spawn, warn });
    expect(spawn).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test('falsy url does not spawn', () => {
    const spawn = jest.fn();
    const warn = jest.fn();
    openInBrowser({ url: '', platform: 'darwin', spawn, warn });
    expect(spawn).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test('spawn throwing synchronously is swallowed and warns', () => {
    const spawn = jest.fn(() => { throw new Error('ENOENT'); });
    const warn = jest.fn();
    expect(() => openInBrowser({ url, platform: 'darwin', spawn, warn })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('ENOENT');
  });
});
