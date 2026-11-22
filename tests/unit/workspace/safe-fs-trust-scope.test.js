'use strict';

// MAUTO_TRUST_WORKSPACE_OWNER=1 applies only inside the checkout (#363,
// decision A): a workspace or project leaf owned by another uid is accepted
// under it, a leaf outside the project never is (an --out target, a
// MAUTO_LOG_DIR outside the workspace, the per-user consent file). "Another
// owner" is simulated with an injected getuid, or an fs whose fstat reports a
// foreign uid where the caller injects no getuid (the log sink). Fixture:
// tests/helpers/safe-fs-fixture.js.

const fs = require('fs');
const path = require('path');

const {
  readWorkspaceFile,
  readProjectFile,
  readUserFile,
  openUserLeaf,
} = require('../../../src/workspace/safe-fs');
const consent = require('../../../src/observe/consent');
const sink = require('../../../src/observe/sinks/file');
const spool = require('../../../src/observe/spool');
const {
  makeSafeFsFixture,
  removeSafeFsFixture,
  expectUnsafe,
  foreignFs,
  REAL_UID,
} = require('../../helpers/safe-fs-fixture');

const { O_WRONLY } = fs.constants;
const OVERRIDE = { MAUTO_TRUST_WORKSPACE_OWNER: '1' };
const foreignUid = () => REAL_UID + 1;

let base;
let root;
let ws;
let outside;

beforeEach(() => {
  ({ base, root, ws, outside } = makeSafeFsFixture());
});

afterEach(() => {
  removeSafeFsFixture(base);
});

describe('inside the checkout the override applies', () => {
  it('a foreign workspace leaf reads under the override, and is refused without it', () => {
    const p = path.join(ws, 'a.json');
    fs.writeFileSync(p, 'ws');
    expect(readWorkspaceFile(root, p, {}, { getuid: foreignUid, env: OVERRIDE })).toBe('ws');
    expect(readUserFile(root, p, {}, { getuid: foreignUid, env: OVERRIDE })).toBe('ws');
    expectUnsafe(() => readUserFile(root, p, {}, { getuid: foreignUid, env: {} }), 'foreign_owner');
  });

  it('a foreign project leaf reads under the override, and is refused without it', () => {
    fs.mkdirSync(path.join(root, 'flows'));
    const p = path.join(root, 'flows', 'x.json');
    fs.writeFileSync(p, 'proj');
    expect(readProjectFile(root, p, {}, { getuid: foreignUid, env: OVERRIDE })).toBe('proj');
    expect(readUserFile(root, p, {}, { getuid: foreignUid, env: OVERRIDE })).toBe('proj');
    expectUnsafe(() => readUserFile(root, p, {}, { getuid: foreignUid, env: {} }), 'foreign_owner');
  });

  it('a log line appends to a foreign leaf in the workspace .logs under the override only', () => {
    const logs = path.join(ws, '.logs');
    fs.mkdirSync(logs);
    const target = path.join(logs, 'mauto.ndjson');
    fs.writeFileSync(target, '');
    const foreignLeaf = foreignFs(['fstatSync']);
    sink.write({ event: 'x' }, { projectRoot: root, env: {}, fs: foreignLeaf });
    expect(fs.readFileSync(target, 'utf8')).toBe('');
    sink.write({ event: 'x' }, { projectRoot: root, env: OVERRIDE, fs: foreignLeaf });
    expect(fs.readFileSync(target, 'utf8')).toContain('"event":"x"');
  });
});

describe('outside the project the override never applies', () => {
  it('openUserLeaf refuses a foreign leaf, and its hint does not offer the override', () => {
    const p = path.join(outside, 'report.json');
    fs.writeFileSync(p, 'x');
    const err = expectUnsafe(() => openUserLeaf(p, O_WRONLY, 0o666, { getuid: foreignUid, env: OVERRIDE }), 'foreign_owner');
    expect(err.scope).toBe('path');
    expect(err.hint).not.toContain('MAUTO_TRUST_WORKSPACE_OWNER');
    expect(err.message).toContain(`you are uid ${REAL_UID + 1}`);
  });

  it('a foreign consent file is no consent, override or not', () => {
    const xdg = path.join(outside, 'xdg');
    const env = { XDG_CONFIG_HOME: xdg };
    const projectRoot = root;
    consent.setLocalConsent(projectRoot, true, { env });
    expect(consent.hasLocalConsent(projectRoot, { env })).toBe(true);
    expect(consent.hasLocalConsent(projectRoot, { env, getuid: foreignUid })).toBe(false);
    expect(consent.hasLocalConsent(projectRoot, { env: { ...env, ...OVERRIDE }, getuid: foreignUid })).toBe(false);
  });

  it('a log line to a foreign leaf in a MAUTO_LOG_DIR outside the workspace is dropped, override or not', () => {
    const logs = path.join(outside, 'logs');
    fs.mkdirSync(logs);
    const target = path.join(logs, 'mauto.ndjson');
    fs.writeFileSync(target, '');
    const foreignLeaf = foreignFs(['fstatSync']);
    sink.write({ event: 'x' }, { projectRoot: root, env: { MAUTO_LOG_DIR: logs, ...OVERRIDE }, fs: foreignLeaf });
    expect(fs.readFileSync(target, 'utf8')).toBe('');
    // Control: the same leaf, ours, is written.
    sink.write({ event: 'x' }, { projectRoot: root, env: { MAUTO_LOG_DIR: logs, ...OVERRIDE } });
    expect(fs.readFileSync(target, 'utf8')).toContain('"event":"x"');
  });

  it('the telemetry spool outside the workspace is neither appended nor read for a foreign leaf', () => {
    const logs = path.join(outside, 'logs');
    fs.mkdirSync(logs);
    const env = { MAUTO_LOG_DIR: logs, ...OVERRIDE };
    const file = path.join(logs, 'telemetry.spool');
    fs.writeFileSync(file, '');
    spool.write({ event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env, getuid: foreignUid });
    expect(fs.readFileSync(file, 'utf8')).toBe('');
    spool.write({ event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env });
    expect(fs.readFileSync(file, 'utf8')).not.toBe('');
    expect(spool.readBatch('telemetry.spool', { projectRoot: root, env })).toHaveLength(1);
    expect(spool.readBatch('telemetry.spool', { projectRoot: root, env, getuid: foreignUid })).toEqual([]);
  });

  it('the workspace spool reads a foreign leaf under the override only', () => {
    fs.mkdirSync(path.join(ws, '.logs'));
    spool.write({ event: 'verb.end', verb: 'tap', ok: true }, { projectRoot: root, env: {} });
    expect(spool.readBatch('telemetry.spool', { projectRoot: root, env: {} })).toHaveLength(1);
    expect(spool.readBatch('telemetry.spool', { projectRoot: root, env: {}, getuid: foreignUid })).toEqual([]);
    expect(spool.readBatch('telemetry.spool', { projectRoot: root, env: OVERRIDE, getuid: foreignUid })).toHaveLength(1);
  });
});
