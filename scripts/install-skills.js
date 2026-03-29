#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 13 setup-time placeholders. Only these are replaced in SKILL.md files.
 *  Runtime placeholders like {{capture_to}} and {{variable_name}} are preserved. */
const SETUP_PLACEHOLDERS = [
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

/** SKILL.md templates — copied with placeholder replacement. */
const SKILL_TEMPLATES = [
  {
    src: 'mobile-automator-generator/SKILL.md',
    dest: '.gemini/skills/mobile-automator-generator/SKILL.md',
  },
  {
    src: 'mobile-automator-executor/SKILL.md',
    dest: '.gemini/skills/mobile-automator-executor/SKILL.md',
  },
];

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
];

/** Destination directories to create. */
const DEST_DIRS = [
  '.gemini/skills/mobile-automator-generator/references',
  '.gemini/skills/mobile-automator-executor/references',
  '.gemini/skills/references',
];

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
 * Build the placeholder → value map from setup state.
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
 * Check if any of the 13 setup placeholders remain unreplaced.
 */
function findUnreplacedSetupPlaceholders(content) {
  const remaining = [];
  for (const name of SETUP_PLACEHOLDERS) {
    if (content.includes(`{{${name}}}`)) {
      remaining.push(`{{${name}}}`);
    }
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const projectRoot = process.cwd();
  const extensionPath = path.resolve(__dirname, '..');
  const templatesPath = path.join(extensionPath, 'templates');
  const stateFile = path.join(projectRoot, 'mobile-automator', 'setup_state.json');

  console.log(`Project root: ${projectRoot}`);
  console.log(`Extension path: ${extensionPath}`);
  console.log(`Templates path: ${templatesPath}\n`);

  // --- 1. Validate setup state ---
  if (!fs.existsSync(stateFile)) {
    console.error(`ERROR: Setup state file not found: ${stateFile}`);
    console.error('Please complete setup sections 1-5 first.');
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
    console.error('Please complete section 5.0 (Project Knowledge) first.');
    process.exit(1);
  }

  // --- 2. Verify all source templates exist ---
  const allEntries = [...SKILL_TEMPLATES, ...SCHEMA_COPIES];
  for (const entry of allEntries) {
    const fullPath = path.join(templatesPath, entry.src);
    if (!fs.existsSync(fullPath)) {
      console.error(`ERROR: Template not found: ${fullPath}`);
      console.error(
        'Please ensure the mobile-automator extension is properly installed.'
      );
      process.exit(1);
    }
  }
  console.log(`✓ All ${allEntries.length} source templates verified\n`);

  // --- 3. Create destination directories ---
  for (const dir of DEST_DIRS) {
    fs.mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  console.log('✓ Skill directories created\n');

  // --- 4. Build placeholder map ---
  const placeholderMap = buildPlaceholderMap(state);

  console.log('Placeholder values:');
  for (const [key, value] of Object.entries(placeholderMap)) {
    const display =
      value.length > 60 ? value.substring(0, 60) + '...' : value;
    console.log(`  ${key} → ${display || '(empty)'}`);
  }
  console.log('');

  // --- 5. Copy + replace SKILL.md templates ---
  for (const skill of SKILL_TEMPLATES) {
    const srcPath = path.join(templatesPath, skill.src);
    const destPath = path.join(projectRoot, skill.dest);

    const template = fs.readFileSync(srcPath, 'utf8');
    const populated = replacePlaceholders(template, placeholderMap);

    const unreplaced = findUnreplacedSetupPlaceholders(populated);
    if (unreplaced.length > 0) {
      console.error(
        `ERROR: Unreplaced setup placeholders in ${skill.src}: ${unreplaced.join(', ')}`
      );
      process.exit(1);
    }

    fs.writeFileSync(destPath, populated, 'utf8');
    console.log(`✓ Installed ${skill.dest}`);
  }

  // --- 6. Copy schema/reference files verbatim ---
  for (const schema of SCHEMA_COPIES) {
    const srcPath = path.join(templatesPath, schema.src);
    const destPath = path.join(projectRoot, schema.dest);

    fs.copyFileSync(srcPath, destPath);
    console.log(`✓ Copied ${schema.dest}`);
  }

  // --- 7. Verify installation ---
  console.log('\nVerification:');
  let hasErrors = false;

  const skillDestPaths = new Set(SKILL_TEMPLATES.map((s) => s.dest));

  for (const entry of allEntries) {
    const fullPath = path.join(projectRoot, entry.dest);
    if (!fs.existsSync(fullPath)) {
      console.error(`  ✗ MISSING: ${entry.dest}`);
      hasErrors = true;
    } else {
      const stats = fs.statSync(fullPath);
      if (stats.size === 0) {
        console.error(`  ✗ EMPTY: ${entry.dest} (0 bytes)`);
        hasErrors = true;
      } else {
        console.log(`  ✓ ${entry.dest} (${stats.size} bytes)`);
        if (skillDestPaths.has(entry.dest)) {
          const writtenContent = fs.readFileSync(fullPath, 'utf8');
          const unreplaced = findUnreplacedSetupPlaceholders(writtenContent);
          if (unreplaced.length > 0) {
            console.error(
              `  ✗ UNREPLACED PLACEHOLDERS in ${entry.dest}: ${unreplaced.join(', ')}`
            );
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

main();
