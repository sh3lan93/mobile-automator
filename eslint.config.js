'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    // Nested worktrees (.claude/, .worktrees/) hold stale copies of this repo,
    // the Flutter fixture is not our JS, and site/ + coverage/ are generated.
    // sample-app/scripts/ is the one piece of the fixture that is our JS.
    // `sample-app/*` (not `sample-app/**`): a `**` ignore also matches
    // scripts/'s own subdirectories, and a negation cannot re-include a file
    // whose parent directory is ignored, so scripts/ was silently skipped.
    ignores: [
      '**/node_modules/**',
      'sample-app/*',
      '!sample-app/scripts/',
      '.claude/**',
      '.worktrees/**',
      'coverage/**',
      'site/**',
      'docs/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      // 'smart' still allows `x == null`, the idiomatic null-or-undefined check.
      eqeqeq: ['error', 'smart'],
      'no-shadow': 'error',
      // `_`-prefixed args mark a required-but-unused position (callbacks,
      // handler signatures). Unused catch bindings are left alone for now.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-implicit-globals': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ['sample-app/scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
  {
    // Type-aware async rules: the point of #164. They need TypeScript's
    // Promise inference, so they run against tsconfig.eslint.json (allowJs,
    // checkJs off: we want the types, not type errors). Tests stay out:
    // fakes and `expect(...).rejects` would drown the signal in noise.
    files: ['src/**/*.js', 'bin/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // projectService only discovers files named tsconfig.json, and we
        // deliberately have none at the root, so name the lint-only config.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
        // The TS parser ignores sourceType 'commonjs'; without this it scopes
        // every file as a script and no-implicit-globals flags each top-level
        // function.
        ecmaFeatures: { globalReturn: true },
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // `void promise` is the explicit opt-out for intentional fire-and-forget.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // Catches async callbacks handed to emitters (socket.on, server.on)
      // whose rejection nobody observes.
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // Typed variant replaces core (also covers async generators); keeping
      // both would double-report every finding.
      'require-await': 'off',
      '@typescript-eslint/require-await': 'error',
    },
  },
];
