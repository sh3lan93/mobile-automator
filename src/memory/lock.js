'use strict';

const fs = require('fs');
const path = require('path');

// Advisory lock for the shared memory markdown files. The files are appended
// across every run and verb, so a naive read-modify-write races: two processes
// both read the old bytes and one append is silently lost. atomic-rename only
// protects readers from torn reads, NOT writers from lost updates — hence this
// explicit lock. We use O_CREAT|O_EXCL ('wx') as the mutex and break a lock
// whose holder crashed (mtime older than STALE_MS).

const STALE_MS = 10_000; // a held lock older than this is presumed abandoned
const RETRY_MS = 50; // wait between acquire attempts
const MAX_WAIT_MS = 5_000; // give up after this and throw

// Synchronous sleep with no busy-spin (Atomics.wait blocks the thread).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(lockPath, { now = Date.now, sleep = sleepSync } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = now() + MAX_WAIT_MS;
  const backoffOrThrow = () => {
    if (now() >= deadline) {
      throw new Error(`could not acquire memory lock at ${lockPath} within ${MAX_WAIT_MS}ms`);
    }
    sleep(RETRY_MS);
  };
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Someone holds it. Break it if it looks abandoned.
      try {
        const st = fs.statSync(lockPath);
        if (now() - st.mtimeMs > STALE_MS) {
          fs.unlinkSync(lockPath);
          continue; // retry immediately
        }
      } catch (statErr) {
        if (statErr.code !== 'ENOENT') {
          // Not the benign vanished-lock case — apply the bounded backoff so
          // a persistent stat/unlink failure (EACCES/EPERM/EBUSY, ...) times
          // out instead of busy-looping the CPU forever.
          backoffOrThrow();
        }
        continue; // ENOENT: lock vanished between open and stat — retry now;
        // any other error already backed off above before retrying.
      }
      backoffOrThrow();
    }
  }
}

function release(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (_) {
    /* already gone — fine */
  }
}

function withLock(lockPath, fn) {
  acquire(lockPath);
  try {
    return fn();
  } finally {
    release(lockPath);
  }
}

module.exports = { acquire, release, withLock, STALE_MS, RETRY_MS, MAX_WAIT_MS, sleepSync };
