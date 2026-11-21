module.exports = {
  testEnvironment: 'node',
  // Scope discovery to THIS repo's tests. The repo hosts nested git worktrees
  // under .claude/worktrees/ (Claude Code convention) plus a node_modules
  // symlink into a sibling worktree; without anchoring, jest's glob recurses
  // into those checkouts and runs stale copies of tests from merged branches.
  // The worktree ignores are <rootDir>-anchored so they skip nested worktrees
  // when run from the main checkout, yet do NOT blank out a worktree's OWN
  // tests when jest runs from inside .claude/worktrees/<branch>/.
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/', '<rootDir>/.worktrees/'],
  // Points XDG_CONFIG_HOME at a temp dir for every test file, and fails a file
  // that changes the developer's real telemetry consent record (#348).
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/isolate-user-config.js'],
  verbose: true,
};
