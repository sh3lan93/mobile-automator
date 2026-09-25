'use strict';

// Drift guards for the closed vocabularies the telemetry wire validates
// against (src/observe/vocab.js), in the bidirectional idiom of
// tests/lint/mobile-mcp-tool-coverage.test.js.
//
// The wire validator (accepts() in src/observe/accepts.js, applied by
// telemetryPayload) is the real enforcement: a value outside its vocabulary is
// DROPPED. These guards exist so that a new event, verb or stop reason is
// NOTICED here, rather than silently vanishing from telemetry because nobody
// added it to a list.
//
//   missing  — the code produces a name the vocabulary lacks  -> silent metric loss
//   stale    — the vocabulary claims a name the code never produces -> a lie

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SRC = path.join(REPO, 'src');

const { EVENT_NAMES, VERB_NAMES, STOP_REASONS } = require('../../src/observe/vocab');

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// A name is stale only if it is absent from the code AND not allowlisted here.
// Every allowlist entry says why, so it cannot become a place to hide drift.
function diff(vocab, produced, allowUnproduced = []) {
  const missing = [...produced].filter((n) => !vocab.includes(n)).sort();
  const stale = vocab.filter((n) => !produced.has(n) && !allowUnproduced.includes(n)).sort();
  return { missing, stale };
}

describe('EVENT_NAMES', () => {
  // Best-effort by construction: every quoted dotted name on a line that has an
  // `event:` key. That covers the one-line form, and the ternary in
  // src/device/failure-probe.js (`event: n > 0 ? 'crash.detected' : 'crash.probe_clear'`)
  // because both literals sit on that line. Comment lines are skipped so prose
  // cannot satisfy or break the guard.
  function eventNamesInSrc() {
    const found = new Set();
    for (const file of jsFilesUnder(SRC)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (!/\bevent:/.test(line)) continue;
        let m;
        const re = /'([a-z_]+\.[a-z_]+)'/g;
        while ((m = re.exec(line)) !== null) found.add(m[1]);
      }
    }
    return found;
  }

  // Names a producer does not emit yet. Each needs a reason and a removal date.
  const UNPRODUCED = [
    // 'telemetry.flush' is emitted by src/observe/flush.js, which lands in a
    // later slice-5 task. tests/unit/observe/event.test.js already round-trips
    // it, so it is declared ahead of its producer. Delete this entry once the
    // producer exists and the source scan finds it.
    'telemetry.flush',
  ];

  it('knows every event name the source records', () => {
    expect(diff(EVENT_NAMES, eventNamesInSrc(), UNPRODUCED).missing).toEqual([]);
  });

  it('claims no event name the source never records', () => {
    expect(diff(EVENT_NAMES, eventNamesInSrc(), UNPRODUCED).stale).toEqual([]);
  });

  it('covers both arms of the failure-probe ternary', () => {
    expect(EVENT_NAMES).toContain('crash.detected');
    expect(EVENT_NAMES).toContain('crash.probe_clear');
  });

  it('scanned a non-trivial number of names, so a broken scan cannot pass vacuously', () => {
    expect(eventNamesInSrc().size).toBeGreaterThan(10);
  });
});

describe('VERB_NAMES', () => {
  // cli.js's preAction hook walks `actionCommand` up to the child of the root
  // and records THAT name, so the only values `resolvedVerb` can take are the
  // TOP-LEVEL command names — `config get` records `config`, never `get`.
  // Commander's implicit `help` command, `--help` and `-V` dispatch without
  // running any preAction hook (verified against commander 12), so a help
  // invocation records NO verb rather than the word `help`; it is therefore not
  // in the vocabulary. The `crash` command is registered only under
  // MAUTO_OBSERVE=1, so the program is built with the gate on to see it.
  function topLevelCommandNames() {
    const prior = process.env.MAUTO_OBSERVE;
    process.env.MAUTO_OBSERVE = '1';
    try {
      const { buildProgram } = require('../../src/cli');
      return new Set(buildProgram({}).commands.map((c) => c.name()));
    } finally {
      if (prior === undefined) delete process.env.MAUTO_OBSERVE;
      else process.env.MAUTO_OBSERVE = prior;
    }
  }

  it('knows every top-level command the program can resolve', () => {
    expect(diff(VERB_NAMES, topLevelCommandNames()).missing).toEqual([]);
  });

  it('claims no verb the program does not register', () => {
    expect(diff(VERB_NAMES, topLevelCommandNames()).stale).toEqual([]);
  });

  it('does not contain the implicit help command, which never reaches the preAction hook', () => {
    expect(VERB_NAMES).not.toContain('help');
  });
});

describe('STOP_REASONS', () => {
  const DAEMON_SRC = fs.readFileSync(path.join(SRC, 'device', 'session-daemon.js'), 'utf8');

  // `stop('idle')` call sites, plus the default parameter of the function itself.
  function stopReasonsInDaemon() {
    const found = new Set();
    let m;
    const call = /\bstop\(\s*'([a-z]+)'/g;
    while ((m = call.exec(DAEMON_SRC)) !== null) found.add(m[1]);
    const dflt = /function stop\(\s*reason\s*=\s*'([a-z]+)'/g;
    while ((m = dflt.exec(DAEMON_SRC)) !== null) found.add(m[1]);
    return found;
  }

  // 'crash' is part of the documented vocabulary (event.js `why`) for an
  // unhandled-failure stop the daemon does not produce yet. Allowed to be
  // unproduced so the vocabulary does not have to change when it lands.
  const UNPRODUCED = ['crash'];

  it('knows every reason the daemon stops for', () => {
    expect(diff(STOP_REASONS, stopReasonsInDaemon(), UNPRODUCED).missing).toEqual([]);
  });

  it('claims no reason the daemon never stops for', () => {
    expect(diff(STOP_REASONS, stopReasonsInDaemon(), UNPRODUCED).stale).toEqual([]);
  });

  it('includes the default reason', () => {
    expect(STOP_REASONS).toContain('explicit');
  });
});
