'use strict';

// The ONE rotation policy. Both log artifacts — the daemon's raw stdio
// (.session/daemon.log) and the structured event stream (.logs/mauto.ndjson) —
// bind to this module, so "1 MiB, one generation, best effort" is a fact of the
// codebase rather than a claim two files each make separately.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { MAX_LOG_BYTES, rotateIfLarge } = require('../../../src/util/log-rotate');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-rotate-'));
}

describe('rotateIfLarge', () => {
  it('renames the log to .1 once it reaches the cap', () => {
    const logPath = path.join(workspace(), 'a.log');
    fs.writeFileSync(logPath, 'x'.repeat(10));

    rotateIfLarge(logPath, { maxBytes: 10 });

    expect(fs.existsSync(logPath)).toBe(false);
    expect(fs.readFileSync(`${logPath}.1`, 'utf8')).toBe('x'.repeat(10));
  });

  it('leaves a log below the cap alone', () => {
    const logPath = path.join(workspace(), 'a.log');
    fs.writeFileSync(logPath, 'x'.repeat(9));

    rotateIfLarge(logPath, { maxBytes: 10 });

    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
    expect(fs.readFileSync(logPath, 'utf8')).toBe('x'.repeat(9));
  });

  it('clobbers an existing .1 — a single generation is the intended bound', () => {
    const logPath = path.join(workspace(), 'a.log');
    fs.writeFileSync(`${logPath}.1`, 'older');
    fs.writeFileSync(logPath, 'x'.repeat(10));

    rotateIfLarge(logPath, { maxBytes: 10 });

    expect(fs.readFileSync(`${logPath}.1`, 'utf8')).toBe('x'.repeat(10));
  });

  it('does nothing when the log does not exist yet', () => {
    const logPath = path.join(workspace(), 'missing.log');
    expect(() => rotateIfLarge(logPath, { maxBytes: 10 })).not.toThrow();
    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
  });

  it('swallows a rename failure — an oversized log beats no log', () => {
    // A concurrent writer that already rotated, or an unwritable directory.
    // Rotation is a disk guard; losing it must never cost the caller its log.
    const boom = {
      statSync: () => ({ size: 999 }),
      renameSync() {
        throw new Error('EACCES');
      },
    };
    expect(() => rotateIfLarge('/anywhere.log', { maxBytes: 10, fs: boom })).not.toThrow();
  });

  it('defaults to the shared 1 MiB cap', () => {
    expect(MAX_LOG_BYTES).toBe(1024 * 1024);

    const logPath = path.join(workspace(), 'a.log');
    fs.writeFileSync(logPath, 'x'.repeat(MAX_LOG_BYTES));

    rotateIfLarge(logPath);

    expect(fs.statSync(`${logPath}.1`).size).toBe(MAX_LOG_BYTES);
  });
});

describe('the two log artifacts share this one implementation', () => {
  // The duplication this module removes was not hypothetical: file.js's header
  // claimed "ONE rotation policy" while forking the code, and the fork had
  // subtly different failure semantics (a rename failure there aborted the
  // append, losing the very line being written).
  it('session-log re-exports the shared cap rather than defining its own', () => {
    const { MAX_LOG_BYTES: fromSessionLog } = require('../../../src/device/session-log');
    expect(fromSessionLog).toBe(MAX_LOG_BYTES);
  });
});
