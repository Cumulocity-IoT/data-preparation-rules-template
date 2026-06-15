#!/usr/bin/env node

// Run Data Preparation rule tests against a live Cumulocity platform via the
// POST /v1/run-tests endpoint.
//
// Usage:
//   npm run test                          # test every rule under rules/
//   npm run test -- rules/my-rule         # test a specific rule folder
//   npm run test -- --host <url> --header "Authorization: ..."
//
// Credentials are resolved by scripts/lib/auth.js (token/session first).
// Exit codes: 0 = all passed, 1 = a test failed, 2 = config/auth/connection error.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Diff } from 'diff';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { resolveAuth, isFatalAuthStatus } from './lib/auth.js';
import { discoverRuleFolders, readDataPrep, listTestFiles } from './lib/rules.js';
import { sourcePathFor, bundleRule } from './lib/bundle.js';
import { green, cyan, red, boldRed, yellow, boldCyan, boldGreen, header } from './lib/cli-color.js';

const RUN_TESTS_PATH = '/service/dataprep/v1/run-tests';

/** Parse CLI positionals, skipping the `--host`/`--header` value flags. */
function positionalArgs() {
  const argv = process.argv.slice(2);
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host' || arg === '--header') {
      i++; // skip the value
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

/** Stable JSON serialisation with sorted object keys, for output comparison. */
function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Load tests from a rule folder into { name -> { inputs, expectedOutput? } }. */
function loadTests(ruleFolder) {
  const tests = {};
  for (const file of listTestFiles(ruleFolder)) {
    const name = path.basename(file).replace(/\.(ya?ml)$/, '');
    tests[name] = parseYaml(fs.readFileSync(file, 'utf-8'));
  }
  return tests;
}

/** Map a `.js` line/column (1-based line, 0-based column) back to the .ts source. */
function mapStack(stack, traceMap) {
  if (!stack || !traceMap) return stack;
  return stack.replace(/:(\d+):(\d+)/g, (whole, line, col) => {
    const orig = originalPositionFor(traceMap, { line: Number(line), column: Number(col) });
    if (orig && orig.source && orig.line != null) {
      return `:${orig.line}:${orig.column} (${orig.source})`;
    }
    return whole;
  });
}

/** Token-level diff for canonical JSON strings — treats each JSON value/key as atomic. */
const jsonDiff = new Diff();
jsonDiff.tokenize = (str) =>
  str.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]|\s+/g) ?? [];

async function runTests(baseUrl, authorizationHeader, body) {
  const url = `${baseUrl}${RUN_TESTS_PATH}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorizationHeader,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text };
}

/** Evaluate one rule's results. Returns the number of failed test inputs. */
function reportResults(results, tests, traceMap) {
  let failures = 0;

  for (const [testName, perInput] of Object.entries(results)) {
    const expectedOutput = tests[testName]?.expectedOutput;

    if (!Array.isArray(perInput)) {
      // e.g. a top-level timeout error object
      console.log(red(`  ✗ ${testName}: unexpected response - ${JSON.stringify(perInput)}`));
      failures++;
      continue;
    }

    for (let i = 0; i < perInput.length; i++) {
      const result = perInput[i];
      const label = perInput.length > 1 ? `${testName}[input ${i + 1}]` : testName;

      if (result.error) {
        failures++;
        const message = result.error.message || result.error;
        console.log(red(`  ✗ ${label}: ERROR - ${message}`));
        if (result.error.stack) {
          console.log(indent(mapStack(result.error.stack, traceMap).trimEnd()));
        }
      } else {
        const outputs = result.outputs || [];
        // Compare to expectedOutput only for the first input of the test.
        if (expectedOutput !== undefined && i === 0) {
          const actualCanon = canonical(outputs);
          const expectedCanon = canonical(expectedOutput);
          if (actualCanon !== expectedCanon) {
            failures++;
            console.log(red(`  ✗ ${label}: output did not match expectedOutput`));
            const diff = jsonDiff.diff(expectedCanon, actualCanon);
            const expectedHighlighted = diff
              .filter((part) => !part.added)
              .map((part) => (part.removed ? red(part.value) : part.value))
              .join('');
            const actualHighlighted = diff
              .filter((part) => !part.removed)
              .map((part) => (part.added ? green(part.value) : part.value))
              .join('');
            console.log(indent(`expected: ${expectedHighlighted}`));
            console.log(indent(`actual:   ${actualHighlighted}`));
          } else {
            console.log(green(`  ✓ ${label}: ${outputs.length} output(s), matches expectedOutput`));
          }
        } else {
          console.log(green(`  ✓ ${label}: ${outputs.length} output(s)`));
        }
      }

      if (Array.isArray(result.logs) && result.logs.length > 0) {
        for (const log of result.logs) {
          console.log(indent(`[log] ${log}`));
        }
      }
    }
  }

  return failures;
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
}

async function main() {
  let ruleFolders;
  try {
    ruleFolders = discoverRuleFolders(positionalArgs());
  } catch (err) {
    console.error(boldRed(`Error: ${err.message}\n`));
    process.exit(2);
  }

  process.stdout.write(header(`Running tests for ${ruleFolders.length} rule${ruleFolders.length !== 1 ? 's' : ''}`));

  if (ruleFolders.length === 0) {
    console.log(yellow('\nNo rules found under rules/. Nothing to test.\n'));
    process.exit(0);
  }

  let auth;
  try {
    auth = resolveAuth();
  } catch (err) {
    console.error(boldRed(`\nError: ${err.message}\n`));
    process.exit(2);
  }

  let totalFailures = 0;
  let firstRequest = true;

  for (const ruleFolder of ruleFolders) {
    const ruleName = path.basename(ruleFolder);
    console.log(`\n${boldCyan(`=== Testing rule: ${ruleName} ===`)}`);

    const { config } = readDataPrep(ruleFolder);
    const tsPath = sourcePathFor(ruleFolder, config.smartFunctionFile);
    if (!fs.existsSync(tsPath)) {
      console.error(red(`  ✗ smart function source not found: ${tsPath}`));
      totalFailures++;
      continue;
    }

    let jsCode;
    let map;
    try {
      ({ jsCode, map } = await bundleRule(tsPath));
    } catch (err) {
      console.error(red(`  ✗ failed to bundle ${tsPath}: ${err.message}`));
      totalFailures++;
      continue;
    }
    const traceMap = map ? new TraceMap(map) : null;

    const tests = loadTests(ruleFolder);
    if (Object.keys(tests).length === 0) {
      console.log(yellow('  (no tests/ files — skipping)'));
      continue;
    }

    // The run-tests endpoint requires transportID on every input item.
    // Use the explicit transportID from data-prep.yaml if set; otherwise
    // fall back to the transport type (e.g. "mqtt"), matching platform behaviour.
    const transportID = config.input.transportID ?? config.input.transport;
    const requestTests = {};
    for (const [name, def] of Object.entries(tests)) {
      if (!def || !Array.isArray(def.inputs) || def.inputs.length === 0) {
        console.error(red(`  ✗ invalid test definition "${name}" (missing non-empty "inputs" array)`));
        totalFailures++;
        continue;
      }
      requestTests[name] = {
        inputs: def.inputs.map((input) => ({ transportID, ...input })),
      };
    }

    const body = {
      tests: requestTests,
      jsCode,
      config: {
        source: config.input,
        description: config.description,
        tags: config.tags,
        disabled: config.disabled,
      },
    };

    let response;
    let text;
    try {
      ({ response, text } = await runTests(auth.baseUrl, auth.authorizationHeader, body));
    } catch (err) {
      if (firstRequest) {
        console.error(boldRed(`Error: failed to reach ${auth.baseUrl}: ${err.message}\n`));
        process.exit(2);
      }
      console.error(red(`Error: failed to reach ${auth.baseUrl}: ${err.message}`));
      totalFailures++;
      continue;
    }
    firstRequest = false;

    if (isFatalAuthStatus(response.status)) {
      console.error(boldRed(`Error: authentication failed (HTTP ${response.status}). Check your credentials.\n`));
      process.exit(2);
    }
    if (!response.ok) {
      console.error(red(`  ✗ platform returned HTTP ${response.status}: ${text}`));
      totalFailures++;
      continue;
    }

    let results;
    try {
      results = JSON.parse(text);
    } catch {
      console.error(red(`  ✗ could not parse platform response: ${text}`));
      totalFailures++;
      continue;
    }

    totalFailures += reportResults(results, tests, traceMap);
  }

  if (totalFailures > 0) {
    const noun = totalFailures === 1 ? 'failure' : 'failures';
    console.error(boldRed(`\n✗ ${totalFailures} test ${noun}.\n`));
    process.exit(1);
  }
  console.log(boldGreen('\n✓ All tests passed.\n'));
  process.exit(0);
}

main();
