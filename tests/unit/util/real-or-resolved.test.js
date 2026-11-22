'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { realOrResolved } = require('../../../src/util/real-or-resolved');

describe('realOrResolved', () => {
  it('returns the realpath of an existing path reached through a link', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-ror-')));
    const real = path.join(dir, 'real');
    fs.mkdirSync(real);
    const link = path.join(dir, 'link');
    fs.symlinkSync(real, link);
    expect(realOrResolved(link)).toBe(real);
  });

  it('falls back to the absolute path when the path does not exist', () => {
    expect(realOrResolved('no/such/dir-mauto')).toBe(path.resolve('no/such/dir-mauto'));
  });
});
