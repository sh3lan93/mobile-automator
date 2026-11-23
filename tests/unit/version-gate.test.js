'use strict';

// #369: the version gate must refuse a package.json version that is not
// greater than the highest release tag, at PR time and again at tag time.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { decide, main } = require('../../scripts/version-gate');

const SCRIPT = path.resolve(__dirname, '../../scripts/version-gate.js');

describe('decide', () => {
  test('the incident: 0.40.13 after v0.40.14 shipped is behind', () => {
    expect(decide('0.40.13', ['v0.40.12', 'v0.40.14'])).toEqual({ decision: 'behind', highest: 'v0.40.14' });
  });

  test('a version that already has a tag is tagged, even when it is the highest', () => {
    expect(decide('0.40.14', ['v0.40.12', 'v0.40.14'])).toEqual({ decision: 'tagged', highest: 'v0.40.14' });
    expect(decide('0.40.12', ['v0.40.12', 'v0.40.14']).decision).toBe('tagged');
  });

  test.each([
    ['0.40.10', ['v0.40.9'], 'ahead', 'v0.40.9'],
    ['0.41.0', ['v0.41.0-rc.3', 'v0.40.19'], 'ahead', 'v0.41.0-rc.3'],
    ['0.41.0-rc.0', ['v0.40.19'], 'ahead', 'v0.40.19'],
    ['0.41.0-rc.10', ['v0.41.0-rc.2'], 'ahead', 'v0.41.0-rc.2'],
    ['0.41.0-rc.1', ['v0.41.0'], 'behind', 'v0.41.0'],
    ['0.41.0-rc.2', ['v0.41.0-rc.10'], 'behind', 'v0.41.0-rc.10'],
  ])('%s against %j is %s (highest %s)', (version, tags, decision, highest) => {
    expect(decide(version, tags)).toEqual({ decision, highest });
  });

  test('picks the highest by precedence, not by list or string order', () => {
    const tags = ['v0.40.9', 'v0.40.10', 'v0.40.2'];
    expect(decide('0.40.3', tags)).toEqual({ decision: 'behind', highest: 'v0.40.10' });
  });

  // Not tagged by name, but equal in precedence (leading zeros parse): shipping
  // it would publish a version npm already has, so it is behind, not ahead.
  test('a tag equal in precedence but spelled differently is behind', () => {
    expect(decide('0.40.14', ['v0.40.014'])).toEqual({ decision: 'behind', highest: 'v0.40.014' });
  });

  test('ignores tags that are not v + a parseable version', () => {
    const tags = ['v9.9.9-', 'latest', '99.0.0', 'v1.2', 'release-1', 'v0.40.1'];
    expect(decide('0.40.2', tags)).toEqual({ decision: 'ahead', highest: 'v0.40.1' });
  });

  test('no tags at all is ahead, with no highest', () => {
    expect(decide('0.1.0', [])).toEqual({ decision: 'ahead', highest: null });
    expect(decide('0.1.0', ['junk'])).toEqual({ decision: 'ahead', highest: null });
  });
});

describe('main', () => {
  const TAGS = ['v0.40.12', 'v0.40.14'];

  function run(argv, { tags = TAGS, readTags } = {}) {
    const logs = [];
    const errors = [];
    const outputs = [];
    const code = main(argv, {
      readTags: readTags || (() => tags),
      log: (m) => logs.push(m),
      error: (m) => errors.push(m),
      writeOutput: (l) => outputs.push(l),
    });
    return { code, out: logs.join('\n'), err: errors.join('\n'), outputs };
  }

  describe('--mode pr', () => {
    test('behind fails, naming the highest tag and sync-branch.js', () => {
      const r = run(['0.40.13', '--mode', 'pr']);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/Version 0\.40\.13 is not greater than the highest release tag v0\.40\.14/);
      expect(r.err).toMatch(/node scripts\/sync-branch\.js/);
      expect(r.outputs).toEqual([]);
    });

    test('tagged fails, naming the tag', () => {
      const r = run(['0.40.14', '--mode', 'pr']);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/0\.40\.14 is already released \(tag 'v0\.40\.14' exists\)/);
      expect(r.err).toMatch(/not yet tagged/);
    });

    test('ahead passes', () => {
      const r = run(['0.40.15', '--mode', 'pr']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/✅/);
      expect(r.out).toMatch(/v0\.40\.14/);
      expect(r.err).toBe('');
      expect(r.outputs).toEqual([]);
    });
  });

  describe('--mode tag', () => {
    test('tagged skips: exit 0 and exists=true', () => {
      const r = run(['0.40.14', '--mode', 'tag']);
      expect(r.code).toBe(0);
      expect(r.outputs).toEqual(['exists=true']);
      expect(r.out).toMatch(/skipping/i);
    });

    test('ahead tags: exit 0 and exists=false', () => {
      const r = run(['0.40.15', '--mode', 'tag']);
      expect(r.code).toBe(0);
      expect(r.outputs).toEqual(['exists=false']);
    });

    test('behind fails before tagging, naming the highest tag and a stale branch', () => {
      const r = run(['0.40.13', '--mode', 'tag']);
      expect(r.code).toBe(1);
      expect(r.outputs).toEqual([]);
      expect(r.err).toMatch(/v0\.40\.14/);
      expect(r.err).toMatch(/Nothing was tagged/);
      expect(r.err).toMatch(/stale branch/);
      expect(r.err).toMatch(/sync-branch\.js/);
    });
  });

  test.each([
    [[]],
    [['--mode', 'pr']],
    [['0.40.15']],
    [['0.40.15', '--mode']],
    [['0.40.15', '--mode', 'ship']],
    [['v0.40.15', '--mode', 'pr']],
    [['0.40', '--mode', 'tag']],
    [['0.40.15', '--mode', 'pr', 'extra']],
  ])('bad usage %j exits 2 without reading tags', (argv) => {
    const readTags = jest.fn(() => TAGS);
    const r = run(argv, { readTags });
    expect(r.code).toBe(2);
    expect(r.err).not.toBe('');
    expect(readTags).not.toHaveBeenCalled();
  });

  test('a git failure exits 2 (fails closed), in either mode', () => {
    for (const mode of ['pr', 'tag']) {
      const r = run(['0.40.15', '--mode', mode], {
        readTags: () => {
          throw new Error('git tag failed: not a git repository');
        },
      });
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/not a git repository/);
      expect(r.outputs).toEqual([]);
    }
  });
});

describe('the CLI against a real git repo', () => {
  let repo;
  let outFile;

  const git = (...args) => {
    const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  };

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'version-gate-'));
    git('init', '-q');
    git('config', 'user.name', 'Version Gate Test');
    git('config', 'user.email', 'version-gate@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    for (const tag of ['v0.40.9', 'v0.40.12', 'v0.40.14', 'v0.41.0-rc.2', 'not-a-version']) git('tag', tag);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  beforeEach(() => {
    outFile = path.join(repo, '..', `${path.basename(repo)}-out-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(outFile, 'earlier=1\n');
  });

  afterEach(() => {
    fs.rmSync(outFile, { force: true });
  });

  function cli(args, env = {}) {
    const res = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: outFile, ...env },
    });
    return { code: res.status, stdout: res.stdout, stderr: res.stderr, output: fs.readFileSync(outFile, 'utf8') };
  }

  test('pr mode: behind fails naming the highest tag; ahead passes', () => {
    const behind = cli(['0.40.13', '--mode', 'pr']);
    expect(behind.code).toBe(1);
    expect(behind.stderr).toMatch(/highest release tag v0\.41\.0-rc\.2/);
    expect(cli(['0.41.0', '--mode', 'pr']).code).toBe(0);
    expect(cli(['0.40.14', '--mode', 'pr']).code).toBe(1);
  });

  test('tag mode: appends exists=true/false to GITHUB_OUTPUT, fails behind without writing', () => {
    const tagged = cli(['0.40.14', '--mode', 'tag']);
    expect(tagged.code).toBe(0);
    expect(tagged.output).toBe('earlier=1\nexists=true\n');

    fs.writeFileSync(outFile, '');
    const ahead = cli(['0.41.0', '--mode', 'tag']);
    expect(ahead.code).toBe(0);
    expect(ahead.output).toBe('exists=false\n');

    fs.writeFileSync(outFile, '');
    const behind = cli(['0.40.13', '--mode', 'tag']);
    expect(behind.code).toBe(1);
    expect(behind.output).toBe('');
  });

  test('tag mode without GITHUB_OUTPUT still decides (local run)', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '0.41.0', '--mode', 'tag'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' },
    });
    expect(res.status).toBe(0);
  });

  test('outside a git repo it exits 2', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'version-gate-nogit-'));
    try {
      const res = spawnSync(process.execPath, [SCRIPT, '0.41.0', '--mode', 'pr'], {
        cwd: bare,
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(bare) },
      });
      expect(res.status).toBe(2);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
