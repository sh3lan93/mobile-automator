#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Mode-aware constants
// ---------------------------------------------------------------------------

const PLACEHOLDERS_AWARE = [
  'project_name',
  'platform_details',
  'build_system',
  'build_command',
  'app_package',
  'environments',
  'automation_extras',
  'architecture',
  'business_domain',
  'business_critical_paths',
  'loading_indicators',
  'protected_directories',
  'additional_resources',
];

const PLACEHOLDERS_AGNOSTIC = [
  'project_name',
  'business_domain',
  'business_critical_paths',
  'loading_indicators',
  'protected_directories',
  'additional_resources',
];

function placeholderNamesForMode(mode) {
  if (mode === 'platform-aware') return PLACEHOLDERS_AWARE.slice();
  if (mode === 'platform-agnostic') return PLACEHOLDERS_AGNOSTIC.slice();
  throw new Error(`Unknown mode: ${mode}`);
}

function skillTemplatesForMode(mode) {
  return [
    {
      src: `mobile-automator-generator/${mode === 'platform-aware' ? 'aware' : 'agnostic'}/SKILL.md`,
      dest: '.gemini/skills/mobile-automator-generator/SKILL.md',
    },
    {
      src: `mobile-automator-executor/${mode === 'platform-aware' ? 'aware' : 'agnostic'}/SKILL.md`,
      dest: '.gemini/skills/mobile-automator-executor/SKILL.md',
    },
  ];
}

/** Schema and reference files — copied verbatim (byte-perfect). */
const SCHEMA_COPIES = [
  {
    src: 'mobile-automator-generator/references/scenario_schema.json',
    dest: '.gemini/skills/mobile-automator-generator/references/scenario_schema.json',
  },
  {
    src: 'mobile-automator-executor/references/result_schema.json',
    dest: '.gemini/skills/mobile-automator-executor/references/result_schema.json',
  },
  {
    src: 'references/mobile-mcp-tools.md',
    dest: '.gemini/skills/references/mobile-mcp-tools.md',
  },
  {
    src: 'references/platform-resolutions.md',
    dest: '.gemini/skills/references/platform-resolutions.md',
  },
];

/** Destination directories to create. */
const DEST_DIRS = [
  '.gemini/skills/mobile-automator-generator/references',
  '.gemini/skills/mobile-automator-executor/references',
  '.gemini/skills/references',
];

// ---------------------------------------------------------------------------
// Argument parsing & mode resolution
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { mode: null, dryRun: false };
  for (const a of argv) {
    if (a.startsWith('--mode=')) out.mode = a.slice('--mode='.length);
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

function resolveMode(projectRoot, flagMode) {
  if (flagMode) {
    // Normalize shorthand aliases
    const normalised =
      flagMode === 'aware' ? 'platform-aware'
      : flagMode === 'agnostic' ? 'platform-agnostic'
      : flagMode;
    if (normalised !== 'platform-aware' && normalised !== 'platform-agnostic') {
      throw new Error(`Invalid --mode value: ${flagMode}`);
    }
    return normalised;
  }
  // Try setup_state.json
  const stateFile = path.join(projectRoot, 'mobile-automator', 'setup_state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state.selected_mode) return state.selected_mode;
    } catch { /* fall through */ }
  }
  // Try config.json
  const configFile = path.join(projectRoot, 'mobile-automator', 'config.json');
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (config.mode) return config.mode;
    } catch { /* fall through */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Build the {{app_package}} value from the app section of setup state.
 * Rules:
 *   - Android only  → `<pkg>`
 *   - iOS only      → `<bundle>`
 *   - Both          → Android: `<pkg>` / iOS: `<bundle>`
 *   - Neither       → N/A
 */
function buildAppPackage(app) {
  if (!app) return 'N/A';

  const android = app.android_package || app.android_package_base || null;
  const ios = app.ios_bundle_id || app.ios_bundle_id_base || null;

  if (android && ios) return `Android: \`${android}\` / iOS: \`${ios}\``;
  if (android) return `\`${android}\``;
  if (ios) return `\`${ios}\``;
  return 'N/A';
}

/**
 * Build the placeholder → value map from setup state (aware mode, 13 placeholders).
 * Any undefined/null value defaults to '' with a warning.
 */
function buildPlaceholderMap(state) {
  const k = state.knowledge || {};
  const envs = Array.isArray(state.environments)
    ? state.environments.join(', ')
    : String(state.environments || '');

  const raw = {
    '{{project_name}}': k.project_name,
    '{{platform_details}}': k.platform_details,
    '{{build_system}}': k.build_system,
    '{{build_command}}': k.build_command,
    '{{app_package}}': buildAppPackage(state.app),
    '{{environments}}': envs,
    '{{automation_extras}}': k.automation_extras,
    '{{architecture}}': k.architecture,
    '{{business_domain}}': k.business_domain,
    '{{business_critical_paths}}': k.business_critical_paths,
    '{{loading_indicators}}': k.loading_indicators,
    '{{protected_directories}}': k.protected_directories,
    '{{additional_resources}}': k.additional_resources,
  };

  const map = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) {
      console.warn(`  ⚠ Warning: ${key} resolved to empty (missing in setup state)`);
      map[key] = '';
    } else {
      map[key] = String(value);
    }
  }
  return map;
}

/**
 * Build the placeholder → value map from setup state (agnostic mode, 6 placeholders).
 */
function buildAgnosticPlaceholderMap(state) {
  const k = state.knowledge || {};
  const raw = {
    '{{project_name}}': k.project_name,
    '{{business_domain}}': k.business_domain,
    '{{business_critical_paths}}': k.business_critical_paths,
    '{{loading_indicators}}': k.loading_indicators,
    '{{protected_directories}}': k.protected_directories,
    '{{additional_resources}}': k.additional_resources,
  };
  const map = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) {
      console.warn(`  ⚠ Warning: ${key} resolved to empty (missing in setup state)`);
      map[key] = '';
    } else {
      map[key] = String(value);
    }
  }
  return map;
}

/**
 * Replace placeholders using split/join (safe for special characters).
 */
function replacePlaceholders(content, map) {
  let result = content;
  for (const [placeholder, value] of Object.entries(map)) {
    result = result.split(placeholder).join(value);
  }
  return result;
}

/**
 * Check if any of the setup placeholders for the given mode remain unreplaced.
 */
function findUnreplacedSetupPlaceholders(content, mode) {
  const names = placeholderNamesForMode(mode);
  return names.filter(n => content.includes(`{{${n}}}`)).map(n => `{{${n}}}`);
}

function archiveExistingSkills(projectRoot, oldMode) {
  const skillsRoot = path.join(projectRoot, '.gemini', 'skills');
  const archiveRoot = path.join(skillsRoot, '.archive');
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
  const roles = ['mobile-automator-generator', 'mobile-automator-executor'];

  for (const role of roles) {
    const src = path.join(skillsRoot, role);
    if (!fs.existsSync(src)) continue;
    const baseName = role.replace('mobile-automator-', '');
    let dest = path.join(archiveRoot, `${baseName}-${oldMode}-${ts}`);
    let suffix = 2;
    while (fs.existsSync(dest)) {
      dest = path.join(archiveRoot, `${baseName}-${oldMode}-${ts}-${suffix++}`);
    }
    fs.mkdirSync(archiveRoot, { recursive: true });
    fs.renameSync(src, dest);
    console.log(`✓ Archived ${role} → ${dest}`);
  }
}

function backupConfig(projectRoot, oldMode) {
  const configPath = path.join(projectRoot, 'mobile-automator', 'config.json');
  if (!fs.existsSync(configPath)) return;
  let bak = path.join(projectRoot, 'mobile-automator', `config.json.${oldMode}.bak`);
  let suffix = 2;
  while (fs.existsSync(bak)) {
    bak = path.join(projectRoot, 'mobile-automator', `config.json.${oldMode}.bak.${suffix++}`);
  }
  fs.copyFileSync(configPath, bak);
  console.log(`✓ Backed up config → ${bak}`);
}

function lintScenariosForAgnostic(scenariosDir) {
  if (!fs.existsSync(scenariosDir)) return [];
  const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.json'));
  const findings = [];

  for (const f of files) {
    const fullPath = path.join(scenariosDir, f);
    let scenario;
    try {
      scenario = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch {
      continue; // malformed JSON — out of scope for this lint
    }

    const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
    steps.forEach((step, idx) => {
      // press_button("BACK") on Android — suggest press_back
      if (step.action === 'press_button' && step.value === 'BACK') {
        findings.push({
          file: fullPath,
          line: idx + 1, // approximate; we don't parse JSON line-by-line
          finding: `press_button("BACK") (Android-only) at step "${step.id || idx}"`,
          suggestion: 'replace with action: "press_back" (semantic, portable across Android/iOS)',
        });
      }
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const projectRoot = process.cwd();
  const extensionPath = path.resolve(__dirname, '..');
  const templatesPath = path.join(extensionPath, 'templates');
  const argv = process.argv.slice(2);

  // Subcommand: migrate-helpers
  if (argv[0] === 'migrate-helpers') {
    const oldMode = (argv.find(a => a.startsWith('--old-mode=')) || '').split('=')[1];
    if (!oldMode) {
      console.error('ERROR: --old-mode=<mode> is required for migrate-helpers');
      process.exit(1);
    }
    // Phase 1: lint scenarios (read-only)
    const scenariosDir = path.join(projectRoot, 'mobile-automator', 'scenarios');
    const findings = lintScenariosForAgnostic(scenariosDir);
    if (findings.length > 0) {
      console.log(`\n⚠ Lint findings (${findings.length}) — informational, scenarios were NOT modified:`);
      for (const f of findings) {
        console.log(`  • ${f.file}: ${f.finding}\n    → ${f.suggestion}`);
      }
    } else {
      console.log('\n✓ Lint: no portability concerns found in existing scenarios.');
    }
    // Phase 2: backup config + archive skills
    backupConfig(projectRoot, oldMode);
    archiveExistingSkills(projectRoot, oldMode);
    console.log('\n✅ migrate-helpers complete. Run install-skills.js with the destination mode next.');
    process.exit(0);
  }

  const args = parseArgs(argv);

  let mode;
  try {
    mode = resolveMode(projectRoot, args.mode);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
  if (!mode) {
    console.error('ERROR: Cannot determine mode. Provide --mode=platform-aware or --mode=platform-agnostic, or run setup first.');
    process.exit(1);
  }
  console.log(`mode: ${mode}`);

  if (args.dryRun) {
    console.log('(dry-run) exiting before filesystem writes.');
    process.exit(0);
  }

  console.log(`Project root: ${projectRoot}`);
  console.log(`Extension path: ${extensionPath}`);
  console.log(`Templates path: ${templatesPath}\n`);

  const stateFile = path.join(projectRoot, 'mobile-automator', 'setup_state.json');
  if (!fs.existsSync(stateFile)) {
    console.error(`ERROR: Setup state file not found: ${stateFile}`);
    console.error('Please complete setup interview first.');
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse setup state: ${e.message}`);
    process.exit(1);
  }
  if (!state.knowledge) {
    console.error('ERROR: Setup state is missing the "knowledge" section.');
    process.exit(1);
  }

  const SKILL_TEMPLATES = skillTemplatesForMode(mode);
  const allEntries = [...SKILL_TEMPLATES, ...SCHEMA_COPIES];

  for (const entry of allEntries) {
    const fullPath = path.join(templatesPath, entry.src);
    if (!fs.existsSync(fullPath)) {
      console.error(`ERROR: Template not found: ${fullPath}`);
      process.exit(1);
    }
  }
  console.log(`✓ All ${allEntries.length} source templates verified\n`);

  for (const dir of DEST_DIRS) {
    fs.mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  console.log('✓ Skill directories created\n');

  const placeholderMap = mode === 'platform-aware'
    ? buildPlaceholderMap(state)
    : buildAgnosticPlaceholderMap(state);

  console.log('Placeholder values:');
  for (const [key, value] of Object.entries(placeholderMap)) {
    const display = value.length > 60 ? value.substring(0, 60) + '...' : value;
    console.log(`  ${key} → ${display || '(empty)'}`);
  }
  console.log('');

  for (const skill of SKILL_TEMPLATES) {
    const srcPath = path.join(templatesPath, skill.src);
    const destPath = path.join(projectRoot, skill.dest);

    const template = fs.readFileSync(srcPath, 'utf8');
    const populated = replacePlaceholders(template, placeholderMap);

    const unreplaced = findUnreplacedSetupPlaceholders(populated, mode);
    if (unreplaced.length > 0) {
      console.error(`ERROR: Unreplaced placeholders in ${skill.src}: ${unreplaced.join(', ')}`);
      process.exit(1);
    }

    fs.writeFileSync(destPath, populated, 'utf8');
    console.log(`✓ Installed ${skill.dest}`);
  }

  for (const schema of SCHEMA_COPIES) {
    const srcPath = path.join(templatesPath, schema.src);
    const destPath = path.join(projectRoot, schema.dest);
    fs.copyFileSync(srcPath, destPath);
    console.log(`✓ Copied ${schema.dest}`);
  }

  // Verification
  console.log('\nVerification:');
  let hasErrors = false;
  const skillDestPaths = new Set(SKILL_TEMPLATES.map(s => s.dest));
  for (const entry of allEntries) {
    const fullPath = path.join(projectRoot, entry.dest);
    if (!fs.existsSync(fullPath)) {
      console.error(`  ✗ MISSING: ${entry.dest}`);
      hasErrors = true;
    } else {
      const stats = fs.statSync(fullPath);
      if (stats.size === 0) {
        console.error(`  ✗ EMPTY: ${entry.dest}`);
        hasErrors = true;
      } else {
        console.log(`  ✓ ${entry.dest} (${stats.size} bytes)`);
        if (skillDestPaths.has(entry.dest)) {
          const writtenContent = fs.readFileSync(fullPath, 'utf8');
          const unreplaced = findUnreplacedSetupPlaceholders(writtenContent, mode);
          if (unreplaced.length > 0) {
            console.error(`  ✗ UNREPLACED: ${entry.dest}: ${unreplaced.join(', ')}`);
            hasErrors = true;
          }
        }
      }
    }
  }

  if (hasErrors) {
    console.error('\nERROR: Skill installation completed with errors.');
    process.exit(1);
  }
  console.log('\n✅ All skills installed and verified successfully.');
}

// Export helpers for unit tests; only run main when invoked directly.
module.exports = {
  parseArgs,
  resolveMode,
  placeholderNamesForMode,
  skillTemplatesForMode,
  buildAgnosticPlaceholderMap,
  archiveExistingSkills,
  backupConfig,
  lintScenariosForAgnostic,
};

if (require.main === module) main();
