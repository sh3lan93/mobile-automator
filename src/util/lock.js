'use strict';

const nodeFs = require('fs');

const { createWorkspaceFile, UnsafePathError } = require('../workspace/safe-fs');

// Advisory lock for shared read-modify-write files. The memory files are
// appended across every run and verb, and the result files are written by
// one-shot CLI processes, so a naive read-modify-write races: two processes
// both read the old bytes and one write is silently lost. atomic-rename only
// protects readers from torn reads, NOT writers from lost updates — hence this
// explicit lock. We use O_CREAT|O_EXCL as the mutex and break a lock whose
// holder crashed (mtime older than STALE_MS).
//
// The lock path sits in a checked-in workspace, so whatever is there may have
// been planted (#345). The entry is inspected with lstat, never stat: a
// symlink, FIFO or other non-regular entry at the lock path is not a lock any
// mauto process made, so it is unlinked (the link itself, never its target)
// and the acquire retries at once. When that unlink fails ENOENT, a concurrent
// process already removed the entry, so the acquire retries at once as well.
// When it fails otherwise (a directory: EPERM
// on macOS, EISDIR on Linux) the acquire throws UnsafePathError(not_regular)
// straight away: waiting cannot fix it, and the verb fails environment instead
// of stalling to the deadline. A regular stale lock whose unlink fails still
// backs off, as contention or permissions on a real lock can clear. O_EXCL
// never follows a link, and O_NOFOLLOW is added on top. The
// project root is required: the lock file is always created by safe-fs's
// createWorkspaceFile, which walks its directory (symlink-free, owned by us,
// created when missing) on every attempt, so there is no unconfined path to
// fall back to. Every retry path, including a lock that vanishes between open
// and lstat, is bounded by MAX_WAIT_MS: a dangling symlink used to make open
// fail EEXIST and stat fail ENOENT forever.

// STALE_MS bounds how long a held lock may sit before another acquirer treats
// it as abandoned. It is judged from the lockfile's creation mtime and is NOT
// refreshed while held — safe here because every memory/result write is a
// sub-second read-modify-write inside a one-shot verb, far below this window.
// Revisit if a future caller ever holds the lock across a long-running
// operation.
const STALE_MS = 10_000; // a held lock older than this is presumed abandoned
const RETRY_MS = 50; // wait between acquire attempts
const MAX_WAIT_MS = 5_000; // give up after this and throw

// Synchronous sleep with no busy-spin (Atomics.wait blocks the thread).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(projectRoot, lockPath, { now = Date.now, sleep = sleepSync, fs = nodeFs } = {}) {
  if (typeof projectRoot !== 'string' || typeof lockPath !== 'string') {
    throw new TypeError('acquire(projectRoot, lockPath) needs the project root and the lock path');
  }
  const deadline = now() + MAX_WAIT_MS;
  const throwIfExpired = () => {
    if (now() >= deadline) {
      throw new Error(`could not acquire lock at ${lockPath} within ${MAX_WAIT_MS}ms`);
    }
  };
  const backoffOrThrow = () => {
    throwIfExpired();
    sleep(RETRY_MS);
  };
  for (;;) {
    let fd;
    try {
      fd = createWorkspaceFile(projectRoot, lockPath, {}, { fs });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Something is there. Break it if it is not a live lock of ours.
      let st;
      try {
        st = fs.lstatSync(lockPath);
      } catch (_statErr) {
        // ENOENT (it vanished between open and lstat) or a persistent
        // lstat failure (EACCES, ...): either way, a bounded backoff.
        backoffOrThrow();
        continue;
      }
      if (!st.isFile() || now() - st.mtimeMs > STALE_MS) {
        try {
          fs.unlinkSync(lockPath);
        } catch (unlinkErr) {
          if (unlinkErr.code === 'ENOENT') {
            // A concurrent process already removed it: retry at once.
            throwIfExpired();
            continue;
          }
          if (!st.isFile()) throw new UnsafePathError(lockPath, 'not_regular');
          backoffOrThrow();
          continue;
        }
        throwIfExpired(); // retry immediately, but never past the deadline
        continue;
      }
      backoffOrThrow();
      continue;
    }
    try {
      fs.writeSync(fd, String(process.pid));
    } finally {
      fs.closeSync(fd);
    }
    return;
  }
}

function release(lockPath) {
  try {
    nodeFs.unlinkSync(lockPath);
  } catch (_) {
    /* already gone — fine */
  }
}

function withLock(projectRoot, lockPath, fn) {
  acquire(projectRoot, lockPath);
  try {
    return fn();
  } finally {
    release(lockPath);
  }
}

module.exports = { acquire, release, withLock, STALE_MS, RETRY_MS, MAX_WAIT_MS, sleepSync };
