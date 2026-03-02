const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

// Initialize AJV with Draft-7 specification
const ajv = new Ajv({ spec: 'draft7', strict: false, allowUnionTypes: true });
addFormats(ajv);

let errors = 0;

/**
 * Helper function to recursively find all JSON files in a directory
 */
function findJsonFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

// 1. Validate all schema files are valid JSON
console.log('Checking JSON validity of schema files...\n');

const schemaFiles = findJsonFiles('templates');
if (schemaFiles.length === 0) {
  console.log('⚠️  No schema files found in templates/');
}

for (const file of schemaFiles) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`✅ Valid JSON: ${file}`);
  } catch (e) {
    console.log(`❌ Invalid JSON: ${file}`);
    console.log(`   Error: ${e.message}`);
    errors++;
  }
}

console.log('');
if (errors > 0) {
  console.log('────────────────────────────────────────');
  console.log(`  ❌ ${errors} schema file(s) have invalid JSON`);
  console.log('────────────────────────────────────────');
  process.exit(1);
} else {
  console.log('────────────────────────────────────────');
  console.log('  ✅ All schema files are valid JSON');
  console.log('────────────────────────────────────────\n');
}

// 2. Validate all schema files are valid JSON Schema Draft-07
console.log('Validating that schema files are valid JSON Schema Draft-07...\n');

for (const file of schemaFiles) {
  try {
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    ajv.compile(schema);
    console.log(`✅ Valid JSON Schema: ${file}`);
  } catch (e) {
    console.log(`❌ Invalid JSON Schema: ${file}`);
    console.log(`   Error: ${e.message}`);
    errors++;
  }
}

console.log('');
if (errors > 0) {
  console.log('────────────────────────────────────────');
  console.log(`  ❌ ${errors} schema(s) failed Draft-07 validation`);
  console.log('────────────────────────────────────────');
  process.exit(1);
} else {
  console.log('────────────────────────────────────────');
  console.log('  ✅ All schemas are valid JSON Schema Draft-07');
  console.log('────────────────────────────────────────\n');
}

// 3. Validate all prototype scenarios against schema v2
console.log('Validating prototype scenarios against scenario_schema_v2.json...\n');

// Find the schema v2 file dynamically
const schemaV2Files = findJsonFiles('templates').filter(f => f.includes('scenario_schema_v2'));
if (schemaV2Files.length === 0) {
  console.log('⚠️  No scenario_schema_v2.json found');
  console.log('────────────────────────────────────────');
  process.exit(1);
}

const schemaV2File = schemaV2Files[0];
const schemaV2 = JSON.parse(fs.readFileSync(schemaV2File, 'utf8'));
const validate = ajv.compile(schemaV2);

// Find all prototype scenario files
const prototypesDir = 'prototypes';
const prototypeFiles = fs.existsSync(prototypesDir)
  ? fs.readdirSync(prototypesDir).filter(f => f.endsWith('.json'))
  : [];

if (prototypeFiles.length === 0) {
  console.log('⚠️  No prototype scenario files found');
} else {
  for (const file of prototypeFiles) {
    const filePath = path.join(prototypesDir, file);
    try {
      const scenario = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (validate(scenario)) {
        console.log(`✅ Valid: ${file}`);
      } else {
        console.log(`❌ Invalid: ${file}`);
        console.log(`   Errors: ${JSON.stringify(validate.errors)}`);
        errors++;
      }
    } catch (e) {
      console.log(`❌ Invalid: ${file}`);
      console.log(`   Error: ${e.message}`);
      errors++;
    }
  }
}

console.log('');
if (errors > 0) {
  console.log('────────────────────────────────────────');
  console.log(`  ❌ ${errors} prototype(s) failed schema validation`);
  console.log('────────────────────────────────────────');
  process.exit(1);
} else {
  console.log('────────────────────────────────────────');
  console.log('  ✅ All prototype scenarios conform to schema v2');
  console.log('────────────────────────────────────────');
}
