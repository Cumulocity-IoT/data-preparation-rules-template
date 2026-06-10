#!/usr/bin/env node

// Build a tar.gz archive for each rule and deploy it to a live Cumulocity
// platform via PUT /v1/rules/<name>/deployed (Content-Type: application/gzip).
//
// Usage:
//   npm run deploy                          # deploy every rule under rules/
//   npm run deploy -- rules/my-rule         # deploy a specific rule folder
//   npm run deploy -- --host <url> --header "Authorization: ..."
//
// Schema validation runs first (offline); the network is not touched if any
// rule fails validation.
//
// Exit codes: 0 = all deployed, 1 = a deploy failed, 2 = config/auth/connection/validation error.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { resolveAuth, isFatalAuthStatus } from './lib/auth.js';
import {
  compileSchemas,
  discoverRuleFolders,
  readDataPrep,
  listTestFiles,
  validateRuleFolder,
} from './lib/rules.js';
import { sourcePathFor, bundleRule, deployedJsName } from './lib/bundle.js';

/** Parse CLI positionals, skipping the `--host`/`--header` value flags. */
function positionalArgs() {
  const argv = process.argv.slice(2);
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host' || arg === '--header') {
      i++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    positionals.push(arg);
  }
  return positionals;
}

/** Build a gzipped tar archive from in-memory entries. */
async function buildTarGz(entries) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataprep-deploy-'));
  try {
    const names = [];
    for (const entry of entries) {
      const dest = path.join(tmpDir, entry.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.content);
      names.push(entry.name);
    }
    const chunks = [];
    const stream = tar.create({ gzip: true, cwd: tmpDir, portable: true }, names);
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Assemble the archive entries for one rule. */
async function packageRule(ruleFolder) {
  const { raw, config } = readDataPrep(ruleFolder);
  const tsPath = sourcePathFor(ruleFolder, config.smartFunctionFile);
  if (!fs.existsSync(tsPath)) {
    throw new Error(`smart function source not found: ${tsPath}`);
  }

  const { jsCode } = await bundleRule(tsPath);
  const jsName = deployedJsName(config.smartFunctionFile);

  // The archive contains the bundled .js, so data-prep.yaml must reference it.
  const deployedYaml = raw.replace(
    /^(\s*smartFunctionFile:\s*).*$/m,
    `$1"${jsName}"`,
  );

  const entries = [
    { name: 'data-prep.yaml', content: deployedYaml },
    { name: jsName, content: jsCode },
  ];

  for (const testFile of listTestFiles(ruleFolder)) {
    entries.push({
      name: `tests/${path.basename(testFile)}`,
      content: fs.readFileSync(testFile, 'utf-8'),
    });
  }

  return entries;
}

async function deployRule(baseUrl, authorizationHeader, ruleName, archive) {
  const url = `${baseUrl}/service/dataprep/v1/rules/${encodeURIComponent(ruleName)}/deployed`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/gzip',
      Authorization: authorizationHeader,
    },
    body: archive,
  });
  const text = await response.text();
  return { response, text };
}

async function main() {
  let auth;
  try {
    auth = resolveAuth();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  let ruleFolders;
  try {
    ruleFolders = discoverRuleFolders(positionalArgs());
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  if (ruleFolders.length === 0) {
    console.log('No rules found under rules/. Nothing to deploy.');
    process.exit(0);
  }

  // Pre-flight: validate everything before touching the network.
  const schemas = compileSchemas();
  const validationErrors = [];
  for (const folder of ruleFolders) {
    validationErrors.push(...validateRuleFolder(folder, schemas));
  }
  if (validationErrors.length > 0) {
    console.error('✗ Validation failed; not deploying. Fix these errors first:\n');
    for (const error of validationErrors) {
      console.error(`  ${error}`);
    }
    process.exit(2);
  }

  let failures = 0;
  let firstRequest = true;

  for (const ruleFolder of ruleFolders) {
    const ruleName = path.basename(ruleFolder);
    console.log(`\n=== Deploying rule: ${ruleName} ===`);

    let archive;
    try {
      const entries = await packageRule(ruleFolder);
      console.log(`  packaged: ${entries.map((e) => e.name).join(', ')}`);
      archive = await buildTarGz(entries);
    } catch (err) {
      console.error(`  ✗ failed to package ${ruleName}: ${err.message}`);
      failures++;
      continue;
    }

    let response;
    let text;
    try {
      ({ response, text } = await deployRule(auth.baseUrl, auth.authorizationHeader, ruleName, archive));
    } catch (err) {
      console.error(`Error: failed to reach ${auth.baseUrl}: ${err.message}`);
      if (firstRequest) process.exit(2);
      failures++;
      continue;
    }
    firstRequest = false;

    if (isFatalAuthStatus(response.status)) {
      console.error(`Error: authentication failed (HTTP ${response.status}). Check your credentials.`);
      process.exit(2);
    }
    if (!response.ok) {
      console.error(`  ✗ HTTP ${response.status}: ${text}`);
      failures++;
      continue;
    }

    console.log(`  ✓ deployed`);
  }

  console.log(`\n${'='.repeat(40)}`);
  if (failures > 0) {
    console.error(`✗ ${failures} of ${ruleFolders.length} rule(s) failed to deploy.`);
    process.exit(1);
  }
  console.log(`✓ All ${ruleFolders.length} rule(s) deployed.`);
  process.exit(0);
}

main();
