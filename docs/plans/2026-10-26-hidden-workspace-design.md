# Hidden workspace directory — design

Branch `sh3lan93/making-the-directory-hidden` · Target version `0.37.0` · No tracking issue yet

## Intent

`mauto setup` creates the workspace as `.mobile-automator/` instead of
`mobile-automator/`. The workspace is tool-owned state, and tool-owned state at
a project root conventionally lives in a dot-directory — `.claude/`, `.github/`,
`.vscode/`. A bare `mobile-automator/` folder next to `src/` and `lib/` reads as
application code and confuses the engineer opening the project.

This is a rename only. Nothing inside the workspace changes.

## Goals

- Every workspace path the CLI reads or writes resolves under
  `<projectRoot>/.mobile-automator/`.
- The directory name is defined in exactly one place in `src/`, so this rename
  is the last one that has to hunt for literals.
- Guides, skills, schemas' descriptions, user-facing docs, tests and fixtures
  all say `.mobile-automator/`.
- A project that still has the old `mobile-automator/` folder gets told exactly
  what to do.

## Non-goals

- **No migration code.** The owner is the only user today; nothing moves the
  folder automatically. The owner runs the rename once by hand.
- **No change to git tracking.** The directory is hidden, not ignored. It stays
  committed like `.github/`. The workspace's own `.gitignore` (written by
  `src/setup/scaffold.js`: `.session/`, `.logs/`, `screenshots/`) is unchanged,
  and no new ignore entries are added anywhere.
- **No rename of anything else called "mobile-automator":** the npm package,
  the `mobile-automator` bin alias, the GitHub repo, the docs site URL, the
  `mobile-automator-*` skill names, MCP server entries.
- No change to the workspace's internal layout (`config.json`, `scenarios/`,
  `screenshots/`, `results/`, `memory/`, `.session/`, `.logs/`) or to any schema
  structure.
- No new verb (e.g. a scenario lister). See "Hidden-directory risk" below.

## Anti-goals (would make this a failure even if it "works")

- A search-and-replace that rewrites URLs (`github.com/sh3lan93/mobile-automator`,
  `sh3lan93.github.io/mobile-automator/`, npm links) or package/skill names.
- Rewriting history: `CHANGELOG.md` and `docs/changelog.md` entries for past
  releases, and everything under `docs/plans/`, keep the old name.
- A missed literal that makes some verb silently create or read a second,
  un-dotted `mobile-automator/` tree.

## Constraints

- Locked invariants in `CLAUDE.md` hold, with one deliberate amendment: the
  backwards-compatibility bullet ("Preserve the `mobile-automator/` workspace
  layout") is updated to name `.mobile-automator/`. The owner approved breaking
  the old location because there are no other users.
- Release is a normal single-PR bump: `0.36.1` → **`0.37.0`** (breaking change
  under 0.x → minor). `[Unreleased]` in `CHANGELOG.md` is renamed to `[0.37.0]`
  in the same PR. Not an rc; 1.0.0 is a separate release under #267.
- Required CI checks and every lint guard must pass (see `CLAUDE.md` drift
  guards — `docs-corpus`, placeholder guards, `action-coverage`, etc.).

## Decided behavior

### 1. Single source for the directory name

`src/workspace/discover.js` already exports `WORKSPACE_DIRNAME`. Set it to
`'.mobile-automator'` and make it the only definition. These sites currently
hard-code `'mobile-automator'` and must import it instead:

| File | Site |
|---|---|
| `src/config/manager.js` | workspace dir join |
| `src/device/session-paths.js` | `sessionDir` |
| `src/memory/paths.js` | memory dir, `.session` dir |
| `src/observe/paths.js` | workspace dir, logs dir |
| `src/observe/failure-capture.js` | screenshots dir |
| `src/result/store.js` | results dir |
| `src/setup/scaffold.js` | `baseDir` |

Watch for require cycles (`discover.js` requires `../output/envelope`); if one
appears, move the constant to a tiny leaf module (e.g. `src/workspace/dirname.js`)
that `discover.js` re-exports. Builder's choice.

### 2. Guard against a second literal

New lint test in `tests/lint/` that fails when any file under `src/` or `bin/`
contains a `'mobile-automator'` / `"mobile-automator"` path-segment literal
outside the one definition — so a future verb cannot reintroduce the bare name.
It must not flag legitimate non-path uses (package name in `package.json`-reading
code, skill names `mobile-automator-*`, MCP server name, URLs). Exact matching
rule is the builder's call; it needs a positive and negative test.

### 3. Stale-folder hint

When discovery finds no `.mobile-automator/config.json` but a directory in the
walk contains `mobile-automator/config.json`, the `environment` failure from
`noWorkspaceFailure` says so:

- error names the found old path, e.g.
  `found legacy workspace <dir>/mobile-automator/ — the workspace is now .mobile-automator/`
- hint gives the fix: stop any daemon the old version left running with
  `pkill -f mauto-session-daemon`, then `mv mobile-automator .mobile-automator`
  in `<dir>`. *(Designer's call.)* The hint must **not** say `mauto session end`:
  it is printed by the new binary, whose `session end` looks under
  `.mobile-automator/.session/`, cannot see the old daemon's files or salt, and
  would report `already_stopped` while the old daemon keeps running.

Detection only — it never moves, reads or writes anything in the old folder.
The old name lives in exactly one named constant (e.g. `LEGACY_WORKSPACE_DIRNAME`)
in `discover.js`, which the guard in §2 allows. Without an old folder the
failure is unchanged apart from the new name.

`mauto setup` in a project root that has `mobile-automator/config.json` and no
`.mobile-automator/` fails with the same message instead of scaffolding a
second, empty workspace beside the old one. *(Designer's call — the owner did
not weigh in; it avoids a split workspace that would look like data loss.)*

Verbs that run without a workspace (`session start`, device verbs, `devices
use`, `guide`, `mcp`, `doctor`) are **not** gated on the legacy check. They can
create `<cwd>/.mobile-automator/.session/` in a legacy project, after which a
plain `mv mobile-automator .mobile-automator` would nest the old folder inside
the new one. Rather than widen the check to every verb for a one-user upgrade,
the hint and the CHANGELOG both say: do the rename before running any other
0.37.0 verb, and if `.mobile-automator/` already exists, delete it first (it
can only hold runtime state the new version just created). *(Designer's call.)*

### 4. Guides and skills

Every `mobile-automator/…` path in `src/guide/content/*.md` (aware, agnostic,
invariants) becomes `.mobile-automator/…`.

### 5. Hidden-directory risk

ripgrep-based agent search tools skip dot-directories by default. The guides
always name exact paths, which still work. The one place an agent enumerates
the directory itself is `execute`'s "run all → every scenario in
`mobile-automator/scenarios/`" (both `execute.aware.md` and
`execute.agnostic.md`). Add one plain sentence there telling the agent to list
`.mobile-automator/scenarios/` directly, because recursive search tools skip
hidden directories. No new verb.

### 6. Everything else that names the path

- `src/schemas/*.json` descriptions (config, result `.logs/`, scenario
  screenshots).
- Code comments in `src/`, `bin/` that describe the path (cosmetic, but they
  are how the next maintainer learns the layout).
- `src/cli.js` setup description string (`Scaffold the workspace (…)`).
- The `discover.js` comment explaining the `config.json` marker: the clone-name
  collision it cites no longer applies to a dotted name. Keep the marker (setup
  always writes `config.json`) and update the reasoning.
- This repo's `.gitignore` lines `mobile-automator/.session/`,
  `mobile-automator/.logs/`.
- User docs: `README.md`, `TROUBLESHOOTING.md`, `CONTRIBUTING.md`, `ROADMAP.md`,
  `docs/**` (excluding `docs/plans/**` and `docs/changelog.md` history),
  `sample-app/README.md`, `.github/ISSUE_TEMPLATE/*`.
- `CLAUDE.md`: file layout block, conventions, locked invariant.
- Tests and fixtures under `tests/` that assert the old path.

### 7. CHANGELOG

`[0.37.0]` entry under a breaking-change heading, stating the new location and
the manual upgrade:

```bash
mauto session end                  # with the OLD version, before upgrading
npm i -g mobile-automator@0.37.0
mv mobile-automator .mobile-automator
grep -rl 'mobile-automator/' .mobile-automator/scenarios   # stale stored paths
```

Order matters: `session end` must run on the old binary (the new one cannot
see the old daemon — see §3), and the `mv` must happen before any other 0.37.0
verb runs. If the session was not ended first, `pkill -f mauto-session-daemon`.

**Stored paths are not rewritten.** Scenario `reference_screenshot` values and
result screenshot fields written by earlier runs may carry a
`mobile-automator/…` prefix. They are data, not layout; the CHANGELOG points
the user at the `grep` above and leaves the fix to them (for the owner's own
test project, a one-line `sed`). Redefining `reference_screenshot` as
workspace-relative is out of scope. *(Designer's call.)*

## Known facts the builder can rely on

- The session socket already falls back to `os.tmpdir()` when the in-workspace
  path exceeds 100 bytes (`src/device/session-paths.js`); the extra character
  needs no special handling. `workspaceKey` hashes the project root, not the
  workspace dir, so tmpdir socket names are unchanged.
- `sample-app/` has no committed workspace; its E2E harness gets one from
  `mauto setup` at run time.
- About 100 tracked files mention `mobile-automator/`; a large share are URLs
  or history. Review each hit rather than bulk-replacing.

## Left to the builder

- Order of work, commit slicing, test list.
- Whether the constant moves to a leaf module.
- The guard's matching rule (§2), within its stated intent.
- Exact wording of the error, hint and guide sentence, within §3 and §5.
- Whether a tracking issue is opened for the PR (`Closes #N`) — if one is, it
  carries no milestone.
