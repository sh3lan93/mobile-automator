const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const ajv = new Ajv({ spec: 'draft7', strict: false, allowUnionTypes: true });
addFormats(ajv);

let errors = 0;

function findJsonFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(fullPath);
  }
  return files;
}

function rule(title) { console.log(`${title}\n`); }
function band(msg) {
  console.log('────────────────────────────────────────');
  console.log(`  ${msg}`);
  console.log('────────────────────────────────────────\n');
}

// 1. Schema files are valid JSON
rule('Checking JSON validity of schema files...');
const schemaFiles = findJsonFiles('templates');
if (schemaFiles.length === 0) console.log('⚠️  No schema files found in templates/');
for (const file of schemaFiles) {
  try { JSON.parse(fs.readFileSync(file, 'utf8')); console.log(`✅ Valid JSON: ${file}`); }
  catch (e) { console.log(`❌ Invalid JSON: ${file}\n   Error: ${e.message}`); errors++; }
}
console.log('');
if (errors > 0) { band(`❌ ${errors} schema file(s) have invalid JSON`); process.exit(1); }
band('✅ All schema files are valid JSON');

// 2. Schema files are valid Draft-07
rule('Validating that schema files are valid JSON Schema Draft-07...');
for (const file of schemaFiles) {
  try { ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8'))); console.log(`✅ Valid JSON Schema: ${file}`); }
  catch (e) { console.log(`❌ Invalid JSON Schema: ${file}\n   Error: ${e.message}`); errors++; }
}
console.log('');
if (errors > 0) { band(`❌ ${errors} schema(s) failed Draft-07 validation`); process.exit(1); }
band('✅ All schemas are valid JSON Schema Draft-07');

// Locate schemas dynamically
function findSchema(name) {
  const hits = findJsonFiles('templates').filter(f => f.endsWith(name));
  if (hits.length === 0) { console.log(`⚠️  No ${name} found`); band(''); process.exit(1); }
  return JSON.parse(fs.readFileSync(hits[0], 'utf8'));
}
const scenarioValidate = ajv.compile(findSchema('scenario_schema.json'));
const resultValidate = ajv.compile(findSchema('result_schema.json'));

function validateDir(dir, validate, label) {
  const files = findJsonFiles(dir);
  if (files.length === 0) { console.log(`⚠️  No ${label} files found in ${dir} (skipping)`); return; }
  for (const filePath of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (validate(doc)) console.log(`✅ Valid: ${filePath}`);
      else { console.log(`❌ Invalid: ${filePath}\n   Errors: ${JSON.stringify(validate.errors)}`); errors++; }
    } catch (e) { console.log(`❌ Invalid: ${filePath}\n   Error: ${e.message}`); errors++; }
  }
}

// 3. Prototype scenarios vs scenario schema
rule('Validating prototype scenarios against scenario_schema.json...');
validateDir('prototypes', scenarioValidate, 'prototype scenario');
console.log('');

// 4. Committed sample-app corpus vs scenario + result schemas
rule('Validating sample-app committed corpus...');
validateDir('sample-app/mobile-automator/scenarios', scenarioValidate, 'sample-app scenario');
validateDir('sample-app/mobile-automator/results', resultValidate, 'sample-app result');
console.log('');

// Final verdict
if (errors > 0) { band(`❌ ${errors} file(s) failed schema validation`); process.exit(1); }
band('✅ All scenarios and results conform to their schemas');
process.exit(0);
