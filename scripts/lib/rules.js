// Shared helpers for discovering and validating rule folders.
// Used by validate.js, test.js and deploy.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

export const RULES_DIR = path.join(repoRoot, 'rules');
const SCHEMA_DIR = path.join(repoRoot, 'schemas');

/**
 * Compile the data-prep and test-case schemas once and return the validators.
 * @returns {{ validateDataPrep: import('ajv').ValidateFunction, validateTestCase: import('ajv').ValidateFunction }}
 */
export function compileSchemas() {
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  const dataPrepSchema = readJson(path.join(SCHEMA_DIR, 'data-prep.schema.json'));
  const testCaseSchema = readJson(path.join(SCHEMA_DIR, 'test-case.schema.json'));
  return {
    validateDataPrep: ajv.compile(dataPrepSchema),
    validateTestCase: ajv.compile(testCaseSchema),
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * Discover rule folders. With no arguments, every immediate subfolder of rules/
 * that contains a data-prep.yaml is returned. Otherwise each provided path is
 * resolved (relative to the current working directory) and must be a rule folder.
 * @param {string[]} args CLI arguments (rule folder paths), possibly empty.
 * @returns {string[]} absolute rule folder paths.
 */
export function discoverRuleFolders(args) {
  if (args.length > 0) {
    return args.map((arg) => {
      const resolved = path.resolve(arg);
      if (!isRuleFolder(resolved)) {
        throw new Error(`Not a rule folder (no data-prep.yaml): ${arg}`);
      }
      return resolved;
    });
  }

  if (!fs.existsSync(RULES_DIR)) {
    return [];
  }
  return fs
    .readdirSync(RULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(RULES_DIR, entry.name))
    .filter(isRuleFolder)
    .sort();
}

function isRuleFolder(dir) {
  return fs.existsSync(path.join(dir, 'data-prep.yaml')) && fs.statSync(dir).isDirectory();
}

/** Read and parse data-prep.yaml from a rule folder. */
export function readDataPrep(ruleFolder) {
  const file = path.join(ruleFolder, 'data-prep.yaml');
  const raw = fs.readFileSync(file, 'utf-8');
  return { raw, config: parseYaml(raw) };
}

/** List tests/*.yaml files in a rule folder, sorted by name. */
export function listTestFiles(ruleFolder) {
  const testsDir = path.join(ruleFolder, 'tests');
  if (!fs.existsSync(testsDir)) {
    return [];
  }
  return fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map((name) => path.join(testsDir, name));
}

/**
 * Validate a single rule folder against the schemas.
 * @returns {string[]} a list of human-readable error strings (empty if valid).
 */
export function validateRuleFolder(ruleFolder, schemas) {
  const errors = [];
  const relRoot = path.relative(process.cwd(), ruleFolder) || ruleFolder;

  // data-prep.yaml
  let config;
  try {
    config = readDataPrep(ruleFolder).config;
  } catch (err) {
    return [`${relRoot}/data-prep.yaml: failed to parse YAML — ${err.message}`];
  }
  if (!schemas.validateDataPrep(config)) {
    errors.push(...formatAjvErrors(`${relRoot}/data-prep.yaml`, schemas.validateDataPrep.errors));
  }

  // smartFunctionFile must reference a file that exists
  if (config && typeof config.smartFunctionFile === 'string') {
    const sfPath = path.join(ruleFolder, config.smartFunctionFile);
    if (!fs.existsSync(sfPath)) {
      errors.push(`${relRoot}/data-prep.yaml: smartFunctionFile "${config.smartFunctionFile}" does not exist`);
    }
  }

  // test files
  for (const testFile of listTestFiles(ruleFolder)) {
    const relTest = path.relative(process.cwd(), testFile) || testFile;
    let testCase;
    try {
      testCase = parseYaml(fs.readFileSync(testFile, 'utf-8'));
    } catch (err) {
      errors.push(`${relTest}: failed to parse YAML — ${err.message}`);
      continue;
    }
    if (!schemas.validateTestCase(testCase)) {
      errors.push(...formatAjvErrors(relTest, schemas.validateTestCase.errors));
    }
  }

  return errors;
}

function formatAjvErrors(filePath, ajvErrors) {
  return (ajvErrors ?? []).map((e) => {
    // Improve readability for the common topicPattern wildcard constraint.
    if (e.keyword === 'not' && e.instancePath === '/input/topicPattern') {
      return `${filePath}: /input/topicPattern must not contain "**" (use "*" as the wildcard)`;
    }
    const where = e.instancePath || '(root)';
    return `${filePath}: ${where} ${e.message}`;
  });
}
