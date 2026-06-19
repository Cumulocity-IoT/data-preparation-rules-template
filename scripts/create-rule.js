#!/usr/bin/env node

// Scaffold a new Data Preparation rule folder.
//
// Usage:
//   npm run create-rule -- <rule-name>
//   node scripts/create-rule.js <rule-name>

import fs from 'node:fs';
import path from 'node:path';
import { RULES_DIR } from './lib/rules.js';
import kleur from 'kleur';
import { header } from './lib/header.js';

// Characters forbidden in a rule name (matches the server-side RuleValidator).
const FORBIDDEN_CHARS = ['/', '\\', '*', '?', '"', "'", '`', '|', '%', '\0'];

function usage() {
  console.error(kleur.red('Usage: npm run create-rule -- <rule-name>'));
  console.error(kleur.red('       node scripts/create-rule.js <rule-name>\n'));
}

function validateName(name) {
  if (!name || name.trim().length === 0) {
    return 'rule name must not be empty';
  }
  if (name === '.' || name === '..') {
    return 'rule name must not be "." or ".."';
  }
  const found = FORBIDDEN_CHARS.filter((c) => name.includes(c));
  if (found.length > 0) {
    // Render forbidden characters unambiguously (show \0 as a label).
    const display = FORBIDDEN_CHARS.map((c) => (c === '\0' ? '\\0 (null)' : c)).join('  ');
    return `rule name must not contain any of the following characters:\n    ${display}`;
  }
  return null;
}

function main() {
  const name = process.argv[2];
  console.log(header(name ? `Creating rule: ${name}` : 'Creating rule'));

  if (!name) {
    console.error(kleur.bold().red('Error: Failed to create rule.'));
    usage();
    process.exit(1);
  }

  const error = validateName(name);
  if (error) {
    console.error(kleur.bold().red(`Error: ${error}\n`));
    process.exit(1);
  }

  const ruleDir = path.join(RULES_DIR, name);
  if (fs.existsSync(ruleDir)) {
    console.error(kleur.bold().red(`Error: rule folder already exists: rules/${name}\n`));
    process.exit(1);
  }

  fs.mkdirSync(path.join(ruleDir, 'tests'), { recursive: true });

  fs.writeFileSync(path.join(ruleDir, 'data-prep.yaml'), dataPrepYaml(name), 'utf-8');
  fs.writeFileSync(path.join(ruleDir, 'smartFunction.ts'), smartFunctionTs(), 'utf-8');
  fs.writeFileSync(path.join(ruleDir, 'tests', 'example.yaml'), exampleTestYaml(), 'utf-8');

  console.log(kleur.bold().green(`✓ Created rule "${name}":`))
  console.log(kleur.green(`    rules/${name}/data-prep.yaml`));
  console.log(kleur.green(`    rules/${name}/smartFunction.ts`));
  console.log(kleur.green(`    rules/${name}/tests/example.yaml`));
  console.log('\nNext steps:');
  console.log(`  1. Edit rules/${name}/smartFunction.ts to implement onMessage().`);
  console.log(`  2. Adjust the transport/topicPattern in rules/${name}/data-prep.yaml.`);
  console.log('  3. Run: npm run check && npm run lint && npm run validate');
  console.log(`  4. Run platform tests: npm run test -- rules/${name}`);
  console.log(`  5. Deploy: npm run deploy -- rules/${name}`);
}

function dataPrepYaml(name) {
  return `# Data Preparation rule configuration for "${name}".

description: "TODO: describe what this rule does"
disabled: false
tags:
  - example
smartFunctionFile: "smartFunction.ts"
input:
  transport: mqtt
  topicPattern: "devices/*/data"
  clientIDPattern: "*"
`;
}

function smartFunctionTs() {
  return `import type { DeviceMessage, DataPrepContext, CumulocityObject } from '@c8y/dataprep-types';

/**
 * Transforms an incoming device message into Cumulocity objects.
 *
 * Runs in a restricted runtime: no fetch, timers, or Node.js/browser APIs.
 * Available globals: console, TextDecoder, TextEncoder.
 */
export function onMessage(msg: DeviceMessage, context: DataPrepContext): (CumulocityObject | DeviceMessage)[] {
  const text = new TextDecoder().decode(msg.payload);
  const data = JSON.parse(text);

  // TODO: build and return your Cumulocity objects, for example a Measurement.
  console.log('Received payload:', data);

  return [];
}
`;
}

function exampleTestYaml() {
  return `inputs:
  - payload: '{"value": 42}'
    payloadFormat: json
    topic: "devices/device01/data"
    clientID: "device01"
    time: "2026-01-01T12:00:00.000Z"
`;
}

main();
