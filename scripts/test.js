#!/usr/bin/env node

/**
 * Run data preparation rule tests against a live Cumulocity platform.
 *
 * Usage:
 *   node scripts/run-platform-tests.js rules/weather-measurements
 *
 * Credentials (environment variables):
 *   C8Y_BASEURL   - Cumulocity base URL (e.g. https://mytenant.cumulocity.com)
 *   C8Y_TOKEN     - Bearer token (recommended — short-lived, no password on disk)
 *   C8Y_USER      - Username with DATA_PREPARATION_RULES_ADMIN role (basic auth)
 *   C8Y_PASSWORD  - Password (basic auth — prefer C8Y_TOKEN instead)
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = one or more tests failed or errored
 *   2 = configuration/connection error
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const ts = require('typescript');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getConfig() {
  loadEnvFile();

  const baseUrl = process.env.C8Y_BASEURL;
  if (!baseUrl) {
    console.error('Error: C8Y_BASEURL environment variable is required.');
    console.error('Set it directly or create a .env file. See README for details.');
    process.exit(2);
  }

  const token = process.env.C8Y_TOKEN;
  const user = process.env.C8Y_USER;
  const password = process.env.C8Y_PASSWORD;

  if (!token && (!user || !password)) {
    console.error('Error: Either C8Y_TOKEN or both C8Y_USER and C8Y_PASSWORD are required.');
    process.exit(2);
  }

  const authHeader = token
    ? `Bearer ${token}`
    : `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

  return { baseUrl: baseUrl.replace(/\/+$/, ''), authHeader };
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function parseYamlField(yamlContent, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm');
  const match = yamlContent.match(regex);
  return match ? match[1].trim() : null;
}

function loadRule(ruleDir) {
  const resolved = path.resolve(ruleDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`Error: Rule directory not found: ${resolved}`);
    process.exit(2);
  }

  const configPath = path.resolve(resolved, 'data-prep.yaml');
  if (!fs.existsSync(configPath)) {
    console.error(`Error: data-prep.yaml not found in ${resolved}`);
    process.exit(2);
  }

  const yamlContent = fs.readFileSync(configPath, 'utf-8');
  const smartFunctionFile = parseYamlField(yamlContent, 'smartFunctionFile');
  if (!smartFunctionFile) {
    console.error('Error: data-prep.yaml must specify smartFunctionFile');
    process.exit(2);
  }

  const srcPath = path.resolve(resolved, smartFunctionFile);
  if (!fs.existsSync(srcPath)) {
    console.error(`Error: Smart function file not found: ${srcPath}`);
    process.exit(2);
  }

  const source = fs.readFileSync(srcPath, 'utf-8');

  // Transpile TypeScript to JavaScript for the platform
  if (smartFunctionFile.endsWith('.ts')) {
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: smartFunctionFile,
    });
    return result.outputText;
  }

  return source;
}

function loadTests(ruleDir) {
  const testsDir = path.resolve(ruleDir, 'tests');
  if (!fs.existsSync(testsDir) || !fs.statSync(testsDir).isDirectory()) {
    console.error(`Error: No tests/ directory found in ${path.resolve(ruleDir)}`);
    process.exit(2);
  }

  const files = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();
  if (files.length === 0) {
    console.error(`Error: No .yaml files found in ${testsDir}`);
    process.exit(2);
  }

  const tests = {};
  for (const file of files) {
    const testName = file.replace(/\.(yaml|yml)$/, '');
    const content = fs.readFileSync(path.resolve(testsDir, file), 'utf-8');
    tests[testName] = yaml.load(content);
  }

  // Validate structure and apply defaults
  for (const [name, test] of Object.entries(tests)) {
    if (!test || !Array.isArray(test.inputs) || test.inputs.length === 0) {
      console.error(`Error: Test "${name}" must have an "inputs" array with at least one entry.`);
      process.exit(2);
    }
    for (const input of test.inputs) {
      if (!input.topic) {
        console.error(`Error: Each test input must have a "topic" field (test: "${name}").`);
        process.exit(2);
      }
      // Apply defaults for optional fields
      input.payload = input.payload ?? '';
      input.payloadFormat = input.payloadFormat ?? 'json';
      input.clientID = input.clientID ?? '';
      input.time = input.time ?? new Date().toISOString();
      input.transportID = input.transportID ?? '';
    }
  }
  return tests;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function runTestsOnPlatform(config, jsCode, tests) {
  const url = `${config.baseUrl}/service/dataprep/v1/run-tests`;

  console.log(`Calling ${url} ...`);

  const body = JSON.stringify({
    jsCode,
    tests,
    config: {},
  });

  console.log('Request payload:');
  console.log(body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: config.authHeader,
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('Error: Request timed out after 30 seconds.');
    } else {
      console.error(`Error: Failed to connect to ${config.baseUrl}`);
      console.error(err.message);
    }
    process.exit(2);
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await response.text();

  console.log(`Response HTTP ${response.status}:`);
  console.log(responseBody);

  if (!response.ok) {
    let errorMsg;
    try {
      const parsed = JSON.parse(responseBody);
      errorMsg = parsed.message || parsed.error || responseBody;
    } catch {
      errorMsg = responseBody;
    }
    console.error(`Error: Platform returned HTTP ${response.status}`);
    console.error(errorMsg);
    process.exit(response.status === 401 || response.status === 403 ? 2 : 1);
  }

  try {
    return JSON.parse(responseBody);
  } catch {
    console.error('Error: Could not parse response from platform.');
    console.error(responseBody);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Result processing
// ---------------------------------------------------------------------------

function processResults(results) {
  let totalInputs = 0;
  let passed = 0;
  let failed = 0;

  for (const [testName, testResults] of Object.entries(results)) {
    console.log(`\n--- ${testName} ---`);

    if (!Array.isArray(testResults)) {
      console.log(`  ✗ Unexpected response format`);
      failed++;
      totalInputs++;
      continue;
    }

    for (let i = 0; i < testResults.length; i++) {
      totalInputs++;
      const result = testResults[i];

      if (result.error) {
        failed++;
        console.log(`  ✗ Input ${i + 1}: ERROR`);
        console.log(`    ${result.error.message}`);
        if (result.error.stack) {
          // Show just the first 3 lines of stack
          const stackLines = result.error.stack.split('\n').slice(0, 3);
          for (const line of stackLines) {
            console.log(`    ${line}`);
          }
        }
      } else if (result.outputs) {
        passed++;
        const outputCount = result.outputs.length;
        console.log(`  ✓ Input ${i + 1}: ${outputCount} output${outputCount !== 1 ? 's' : ''}`);
        for (const output of result.outputs) {
          console.log(`    → ${output.cumulocityType}: ${JSON.stringify(output.payload).slice(0, 120)}`);
        }
      } else {
        passed++;
        console.log(`  ✓ Input ${i + 1}: (no outputs)`);
      }

      // Show captured logs
      if (result.logs && result.logs.length > 0) {
        for (const log of result.logs) {
          console.log(`    [log] ${log}`);
        }
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed (${totalInputs} total)`);
  console.log(`========================================`);

  return failed === 0 ? 0 : 1;
}

/**
 * Discover rule directories with tests. If the given path contains a tests/
 * directory it is a single rule folder. Otherwise, treat it as a parent and
 * return all immediate subdirectories that contain a tests/ directory.
 */
function discoverRuleDirs(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`Error: Directory not found: ${resolved}`);
    process.exit(2);
  }

  // Single rule folder
  if (fs.existsSync(path.resolve(resolved, 'tests'))) {
    return [resolved];
  }

  // Parent directory — find sub-folders containing tests/
  const dirs = fs.readdirSync(resolved)
    .filter(name => {
      const sub = path.resolve(resolved, name);
      return fs.statSync(sub).isDirectory() && fs.existsSync(path.resolve(sub, 'tests'));
    })
    .sort()
    .map(name => path.resolve(resolved, name));

  if (dirs.length === 0) {
    console.error(`Error: No rule folders (containing tests/) found in ${resolved}`);
    process.exit(2);
  }

  return dirs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node scripts/run-platform-tests.js [rule-folder]

Arguments:
  rule-folder  Path to a rule directory (e.g. rules/weather-measurements)
               or a parent directory to test all rules (e.g. rules/).
               Defaults to 'rules/' if omitted.

Environment variables:
  C8Y_BASEURL    Cumulocity base URL (e.g. https://mytenant.cumulocity.com)
  C8Y_TOKEN      Bearer token (recommended)
  C8Y_USER       Username with DATA_PREPARATION_RULES_ADMIN role (basic auth)
  C8Y_PASSWORD   Password (basic auth — prefer C8Y_TOKEN)
    `.trim());
    process.exit(0);
  }

  const target = args[0] || 'rules';
  const ruleDirs = discoverRuleDirs(target);

  const config = getConfig();
  let totalFailed = 0;
  let totalRulesFailed = 0;

  for (const ruleDir of ruleDirs) {
    const ruleName = path.basename(ruleDir);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing rule: ${ruleName}`);
    console.log(`${'='.repeat(60)}`);

    try {
      const jsCode = loadRule(ruleDir);
      const tests = loadTests(ruleDir);

      const testCount = Object.keys(tests).length;
      const inputCount = Object.values(tests).reduce((sum, t) => sum + t.inputs.length, 0);
      console.log(`Running ${testCount} test${testCount !== 1 ? 's' : ''} (${inputCount} input${inputCount !== 1 ? 's' : ''}) against ${config.baseUrl}...`);

      const results = await runTestsOnPlatform(config, jsCode, tests);
      const exitCode = processResults(results);
      if (exitCode !== 0) {
        totalFailed++;
      }
    } catch (err) {
      console.error(`Error testing ${ruleName}: ${err.message}`);
      totalRulesFailed++;
    }
  }

  if (ruleDirs.length > 1) {
    console.log(`\n${'='.repeat(60)}`);
    if (totalRulesFailed > 0) {
      console.error(`${totalRulesFailed} of ${ruleDirs.length} rule(s) failed to test.`);
      process.exit(1);
    }
    if (totalFailed > 0) {
      console.error(`${totalFailed} of ${ruleDirs.length} rule(s) had test failures.`);
      process.exit(1);
    }
    console.log(`All ${ruleDirs.length} rules passed testing.`);
  }
  process.exit(0);
}

main();
