const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');

// Initialize AJV with Draft-7 specification
const ajv = new Ajv({ spec: 'draft7', strict: false, allowUnionTypes: true });
addFormats(ajv);

let errors = 0;

// 1. Validate schema files are valid JSON
console.log('Checking JSON validity of schema files...\n');

const schemaFiles = [
  'templates/mobile-automator-generator/references/scenario_schema_v2.json',
  'templates/mobile-automator-generator/references/scenario_schema.json',
  'templates/mobile-automator-executor/references/result_schema.json'
];

for (const file of schemaFiles) {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  Skipped (not found): ${file}`);
    continue;
  }

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

// 2. Validate JSON Schema Draft-07 syntax
console.log('Validating that schema files are valid JSON Schema Draft-07...\n');

const schemasToValidate = [
  'templates/mobile-automator-generator/references/scenario_schema_v2.json',
  'templates/mobile-automator-executor/references/result_schema.json'
];

for (const file of schemasToValidate) {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  Skipped (not found): ${file}`);
    continue;
  }

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

// 3. Validate prototype scenarios against schema v2
console.log('Validating prototype scenarios against scenario_schema_v2.json...\n');

const schemaV2File = 'templates/mobile-automator-generator/references/scenario_schema_v2.json';
const schemaV2 = JSON.parse(fs.readFileSync(schemaV2File, 'utf8'));
const validate = ajv.compile(schemaV2);

const prototypeFiles = fs.readdirSync('prototypes/').filter(f => f.match(/scenario-.*-ideal\.json$/));

if (prototypeFiles.length === 0) {
  console.log('⚠️  No prototype scenario files found');
} else {
  for (const file of prototypeFiles) {
    const filePath = `prototypes/${file}`;
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
