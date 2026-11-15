const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  nextVersion,
  mergeChangelog,
  mergePackageJson,
  HandMerge,
  sync,
  main,
} = require('../../scripts/sync-branch');

const changelog = (...sections) =>
  `# Changelog\n\nIntro.\n\n---\n\n${sections.map(([v, body]) => `## [${v}]\n\n${body}\n\n---\n\n`).join('')}`;

describe('nextVersion', () => {
  const none = () => false;

  test('keeps the branch version when it is ahead of base and untagged', () => {
    expect(nextVersion({ ancestor: '0.37.0', ours: '0.38.0', theirs: '0.37.1', isTagged: none })).toBe('0.38.0');
  });

  test('re-applies a patch bump on top of a base that took the same version', () => {
    expect(nextVersion({ ancestor: '0.37.0', ours: '0.37.1', theirs: '0.37.1', isTagged: none })).toBe('0.37.2');
  });

  test('re-applies a minor bump on top of a base that moved past it', () => {
    expect(nextVersion({ ancestor: '0.37.0', ours: '0.38.0', theirs: '0.38.1', isTagged: none })).toBe('0.39.0');
  });

  test('skips a version that is already tagged', () => {
    const isTagged = (v) => v === '0.37.2';
    expect(nextVersion({ ancestor: '0.37.0', ours: '0.37.1', theirs: '0.37.1', isTagged })).toBe('0.37.3');
  });

  test('a kept version that is already tagged is renumbered', () => {
    const isTagged = (v) => v === '0.38.0';
    expect(nextVersion({ ancestor: '0.37.0', ours: '0.38.0', theirs: '0.37.1', isTagged })).toBe('0.39.0');
  });

  test('a branch that never bumped follows the base', () => {
    expect(nextVersion({ ancestor: '0.37.0', ours: '0.37.0', theirs: '0.37.4', isTagged: none })).toBe('0.37.4');
  });

  test('keeps an rc that is ahead of the base', () => {
    expect(nextVersion({ ancestor: '0.37.0', ours: '0.38.0-rc.2', theirs: '0.37.1', isTagged: none })).toBe('0.38.0-rc.2');
  });

  test('refuses to invent a number for an rc the base overtook', () => {
    expect(() => nextVersion({ ancestor: '0.37.0', ours: '0.38.0-rc.2', theirs: '0.38.0', isTagged: none })).toThrow(HandMerge);
  });
});

describe('mergeChangelog', () => {
  const ancestor = changelog(['0.37.0', 'old']);

  test('renumbers the branch section and puts it above the base sections', () => {
    const ours = changelog(['0.37.1', '- mine'], ['0.37.0', 'old']);
    const theirs = changelog(['0.37.1', '- landed'], ['0.37.0', 'old']);
    expect(mergeChangelog({ ancestor, ours, theirs, oursVersion: '0.37.1', newVersion: '0.37.2' })).toBe(
      changelog(['0.37.2', '- mine'], ['0.37.1', '- landed'], ['0.37.0', 'old']),
    );
  });

  test('rewrites the version inside the renumbered section, not elsewhere', () => {
    const ours = changelog(['0.37.1', 'npm i -g mobile-automator@0.37.1'], ['0.37.0', 'old']);
    const theirs = changelog(['0.37.1', 'see 0.37.1'], ['0.37.0', 'old']);
    const out = mergeChangelog({ ancestor, ours, theirs, oursVersion: '0.37.1', newVersion: '0.37.2' });
    expect(out).toContain('mobile-automator@0.37.2');
    expect(out).toContain('see 0.37.1');
  });

  test('keeps sections that share sub-headings intact', () => {
    const ours = changelog(['0.38.0', '### Changed\n\n- mine'], ['0.37.0', 'old']);
    const theirs = changelog(['0.37.1', '### Changed\n\n- landed'], ['0.37.0', 'old']);
    expect(mergeChangelog({ ancestor, ours, theirs, oursVersion: '0.38.0', newVersion: '0.38.0' })).toBe(
      changelog(['0.38.0', '### Changed\n\n- mine'], ['0.37.1', '### Changed\n\n- landed'], ['0.37.0', 'old']),
    );
  });

  test('keeps an edit to an old section made on one side only', () => {
    const ours = changelog(['0.37.1', '- mine'], ['0.37.0', 'corrected']);
    const theirs = changelog(['0.37.0', 'old']);
    expect(mergeChangelog({ ancestor, ours, theirs, oursVersion: '0.37.1', newVersion: '0.37.1' })).toBe(
      changelog(['0.37.1', '- mine'], ['0.37.0', 'corrected']),
    );
  });

  test('hands back an old section both sides rewrote', () => {
    const ours = changelog(['0.37.0', 'mine']);
    const theirs = changelog(['0.37.0', 'landed']);
    expect(() => mergeChangelog({ ancestor, ours, theirs, oursVersion: '0.37.0', newVersion: '0.37.0' })).toThrow(HandMerge);
  });

  test('hands back an [Unreleased] section on both sides', () => {
    const ours = changelog(['Unreleased', 'mine'], ['0.37.0', 'old']);
    const theirs = changelog(['Unreleased', 'landed'], ['0.37.0', 'old']);
    expect(() => mergeChangelog({ ancestor, ours, theirs, oursVersion: '0.37.0', newVersion: '0.37.0' })).toThrow(HandMerge);
  });
});

describe('mergePackageJson', () => {
  const pkg = (version, extra = {}) => `${JSON.stringify({ name: 'x', version, ...extra }, null, 2)}\n`;

  test('sets the version when only versions differ', () => {
    expect(JSON.parse(mergePackageJson({
      ancestor: pkg('1.0.0'), ours: pkg('1.0.1'), theirs: pkg('1.0.1'), newVersion: '1.0.2',
    })).version).toBe('1.0.2');
  });

  test('keeps a dependency added on one side', () => {
    const out = JSON.parse(mergePackageJson({
      ancestor: pkg('1.0.0'), ours: pkg('1.0.1', { dependencies: { a: '1' } }), theirs: pkg('1.0.1'), newVersion: '1.0.2',
    }));
    expect(out).toEqual({ name: 'x', version: '1.0.2', dependencies: { a: '1' } });
  });

  test('hands back real changes on both sides', () => {
    expect(() => mergePackageJson({
      ancestor: pkg('1.0.0'),
      ours: pkg('1.0.1', { dependencies: { a: '1' } }),
      theirs: pkg('1.0.1', { dependencies: { b: '1' } }),
      newVersion: '1.0.2',
    })).toThrow(HandMerge);
  });
});

describe('sync over real git repositories', () => {
  let dir;
  let quiet;

  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (file, text) => fs.writeFileSync(path.join(dir, file), text);
  const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
  const pkg = (version) => `${JSON.stringify({ name: 'x', version }, null, 2)}\n`;
  const lock = (version) => `${JSON.stringify({ name: 'x', version, packages: { '': { version } } }, null, 2)}\n`;

  // Stands in for `npm install --package-lock-only`: rewrites the lockfile from
  // package.json, which is the only effect the sync depends on.
  const npm = ({ cwd }) => {
    const { version } = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(cwd, 'package-lock.json'), lock(version));
  };

  const release = (version, entries) => {
    write('package.json', pkg(version));
    write('package-lock.json', lock(version));
    write('CHANGELOG.md', changelog(...entries));
  };
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-branch-'));
    quiet = { log: () => {}, error: () => {} };
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    release('0.37.0', [['0.37.0', 'old']]);
    write('src.txt', 'a\n');
    commit('base');
    git('tag', 'v0.37.0');
    git('checkout', '-q', '-b', 'feature');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const landOnMain = (fn) => {
    git('checkout', '-q', 'main');
    fn();
    commit('landed');
    git('checkout', '-q', 'feature');
  };

  const bothBumpTo0371 = () => {
    release('0.37.1', [['0.37.1', '- mine'], ['0.37.0', 'old']]);
    commit('mine');
    landOnMain(() => release('0.37.1', [['0.37.1', '- landed'], ['0.37.0', 'old']]));
  };

  const run = (over = {}) => sync({ cwd: dir, base: 'main', fetch: false, npm, ...quiet, ...over });

  test('same-version bumps: renumbers all three files and commits the merge', () => {
    bothBumpTo0371();
    expect(run()).toMatchObject({ status: 'synced', version: '0.37.2' });

    expect(JSON.parse(read('package.json')).version).toBe('0.37.2');
    expect(JSON.parse(read('package-lock.json')).version).toBe('0.37.2');
    expect(read('CHANGELOG.md')).toBe(
      changelog(['0.37.2', '- mine'], ['0.37.1', '- landed'], ['0.37.0', 'old']),
    );
    expect(git('status', '--porcelain')).toBe('');
    expect(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);
  });

  test('different bumps conflict in all three files and still resolve', () => {
    release('0.38.0', [['0.38.0', '### Changed\n\n- mine'], ['0.37.0', 'old']]);
    commit('mine');
    landOnMain(() => release('0.37.1', [['0.37.1', '### Changed\n\n- landed'], ['0.37.0', 'old']]));

    expect(run()).toMatchObject({ status: 'synced', version: '0.38.0' });
    expect(read('CHANGELOG.md')).toBe(changelog(
      ['0.38.0', '### Changed\n\n- mine'],
      ['0.37.1', '### Changed\n\n- landed'],
      ['0.37.0', 'old'],
    ));
  });

  test('a real conflict is left for a human, with the bookkeeping already resolved', () => {
    bothBumpTo0371();
    write('src.txt', 'mine\n');
    commit('mine src');
    landOnMain(() => write('src.txt', 'landed\n'));

    expect(run()).toMatchObject({ status: 'conflicts', remaining: ['src.txt'], version: '0.37.2' });
    expect(git('diff', '--name-only', '--diff-filter=U')).toBe('src.txt');
    expect(JSON.parse(read('package.json')).version).toBe('0.37.2');
    expect(read('CHANGELOG.md')).not.toContain('<<<<<<<');
    git('rev-parse', '--verify', 'MERGE_HEAD');
  });

  test('a branch with no bump adopts the base version without renumbering', () => {
    write('src.txt', 'mine\n');
    commit('mine');
    landOnMain(() => release('0.37.1', [['0.37.1', '- landed'], ['0.37.0', 'old']]));

    expect(run()).toMatchObject({ status: 'synced', version: '0.37.1' });
    expect(read('CHANGELOG.md')).toBe(changelog(['0.37.1', '- landed'], ['0.37.0', 'old']));
    expect(read('src.txt')).toBe('mine\n');
  });

  test('already up to date is a no-op', () => {
    const before = git('rev-parse', 'HEAD');
    expect(run()).toMatchObject({ status: 'up-to-date' });
    expect(git('rev-parse', 'HEAD')).toBe(before);
  });

  test('refuses a dirty tree before touching anything', () => {
    bothBumpTo0371();
    write('src.txt', 'uncommitted\n');
    const before = git('rev-parse', 'HEAD');
    expect(() => run()).toThrow(/uncommitted/);
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(read('src.txt')).toBe('uncommitted\n');
  });

  test('refuses to run on the base branch', () => {
    git('checkout', '-q', 'main');
    expect(() => run()).toThrow(/branch/);
  });

  test('main() exits 1 when a real conflict leaves the merge open', () => {
    write('src.txt', 'mine\n');
    commit('mine src');
    landOnMain(() => write('src.txt', 'landed\n'));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(main(['--base', 'main', '--no-fetch'], { npm, ...quiet })).toBe(1);
    } finally {
      process.chdir(cwd);
    }
  });

  test('main() maps outcomes to exit codes', () => {
    bothBumpTo0371();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(main(['--base', 'main', '--no-fetch'], { npm, ...quiet })).toBe(0);
      expect(main(['--nonsense'], { npm, ...quiet })).toBe(2);
    } finally {
      process.chdir(cwd);
    }
  });
});
