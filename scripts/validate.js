#!/usr/bin/env node

// Offline validation of all rule folders against the JSON Schemas.
//
// Usage:
//   node scripts/validate.js                 # validate every rule under rules/
//   node scripts/validate.js rules/my-rule   # validate specific rule folder(s)
//
// Exits non-zero if any validation error is found.

import { compileSchemas, discoverRuleFolders, validateRuleFolder } from './lib/rules.js';
import { boldGreen, red, boldRed, yellow, header } from './lib/cli-color.js';

function main() {
  console.log(header('Running schema validation'));
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  let ruleFolders;
  try {
    ruleFolders = discoverRuleFolders(args);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (ruleFolders.length === 0) {
    console.log(yellow('No rules found under rules/. Nothing to validate.'));
    process.exit(0);
  }

  const schemas = compileSchemas();
  const allErrors = [];

  for (const folder of ruleFolders) {
    const errors = validateRuleFolder(folder, schemas);
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    console.error(boldRed(`✗ Validation failed with ${allErrors.length} error(s):\n`));
    for (const error of allErrors) {
      console.error(red(`  ${error}`));
    }
    console.error();
    process.exit(1);
  }

  console.log(boldGreen(`✓ All ${ruleFolders.length} rule(s) passed schema validation.\n`));
  process.exit(0);
}

main();
