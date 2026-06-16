module.exports = {
  testEnvironment: 'node',
  // Scope discovery to THIS repo's tests. The repo hosts nested git worktrees
  // under .claude/worktrees/ (Claude Code convention) plus a node_modules
  // symlink into a sibling worktree; without anchoring, jest's glob recurses
  // into those checkouts and runs stale copies of tests from merged branches.
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/\\.worktrees/'],
  verbose: true,
};
