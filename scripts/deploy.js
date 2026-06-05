#!/usr/bin/env node

/**
 * Deploy a data preparation rule to a Cumulocity platform.
 *
 * Builds a tar.gz archive from the rule folder (data-prep.yaml, JS file, and
 * optional tests/*.yaml files), then deploys it via PUT /rules/{ruleName}/deployed.
 *
 * Usage:
 *   node scripts/deploy.js rules/weather-measurements
 *
 * Credentials (environment variables):
 *   C8Y_BASEURL   - Cumulocity base URL (e.g. https://mytenant.cumulocity.com)
 *   C8Y_TOKEN     - Bearer token (recommended)
 *   C8Y_USER      - Username with DATA_PREPARATION_RULES_ADMIN + DEPLOYMENTS_ADMIN roles (basic auth)
 *   C8Y_PASSWORD  - Password (basic auth — prefer C8Y_TOKEN instead)
 *
 * Exit codes:
 *   0 = uploaded successfully
 *   2 = configuration/connection error
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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
// Tar archive builder (POSIX ustar format)
// ---------------------------------------------------------------------------

/**
 * Build a tar archive from a list of {name, content} entries.
 * Returns a Buffer containing the raw tar data (not gzipped).
 */
function buildTar(entries) {
  const blocks = [];

  for (const entry of entries) {
    const content = Buffer.from(entry.content, 'utf-8');
    const header = createTarHeader(entry.name, content.length);
    blocks.push(header);
    blocks.push(content);

    // Pad to 512-byte boundary
    const remainder = content.length % 512;
    if (remainder > 0) {
      blocks.push(Buffer.alloc(512 - remainder));
    }
  }

  // End-of-archive marker: two 512-byte zero blocks
  blocks.push(Buffer.alloc(1024));

  return Buffer.concat(blocks);
}

/**
 * Create a POSIX tar header for a regular file.
 */
function createTarHeader(filename, size) {
  const header = Buffer.alloc(512);

  // name (0, 100)
  header.write(filename, 0, Math.min(filename.length, 100), 'utf-8');

  // mode (100, 8)
  header.write('0000644\0', 100, 8, 'utf-8');

  // uid (108, 8)
  header.write('0000000\0', 108, 8, 'utf-8');

  // gid (116, 8)
  header.write('0000000\0', 116, 8, 'utf-8');

  // size (124, 12) - octal, space-terminated
  header.write(size.toString(8).padStart(11, '0') + ' ', 124, 12, 'utf-8');

  // mtime (136, 12)
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, '0') + ' ', 136, 12, 'utf-8');

  // checksum placeholder (148, 8) - spaces for calculation
  header.write('        ', 148, 8, 'utf-8');

  // typeflag (156, 1) - '0' for regular file
  header.write('0', 156, 1, 'utf-8');

  // magic (257, 6)
  header.write('ustar\0', 257, 6, 'utf-8');

  // version (263, 2)
  header.write('00', 263, 2, 'utf-8');

  // Calculate and write checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');

  return header;
}

// ---------------------------------------------------------------------------
// YAML parser (minimal — only what we need)
// ---------------------------------------------------------------------------

/**
 * Parse a string field from a YAML file.
 * This is a minimal parser that avoids adding a YAML dependency.
 */
function parseYamlField(yamlContent, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm');
  const match = yamlContent.match(regex);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

// ---------------------------------------------------------------------------
// TypeScript transpilation
// ---------------------------------------------------------------------------

/**
 * Transpile TypeScript source to JavaScript for deployment to the platform.
 */
function transpileTypeScript(source, filename) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2021,
    },
    fileName: filename,
  });
  return result.outputText;
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

async function deploy(ruleDir) {
  const rulePath = path.resolve(ruleDir);
  if (!fs.existsSync(rulePath) || !fs.statSync(rulePath).isDirectory()) {
    throw new Error(`Rule directory not found: ${rulePath}`);
  }

  // Rule name is the folder name
  const ruleName = path.basename(rulePath);

  const configPath = path.resolve(rulePath, 'data-prep.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`data-prep.yaml not found in ${rulePath}`);
  }

  const yamlContent = fs.readFileSync(configPath, 'utf-8');

  const smartFunctionFile = parseYamlField(yamlContent, 'smartFunctionFile');
  if (!smartFunctionFile) {
    throw new Error('data-prep.yaml must specify smartFunctionFile');
  }

  const srcPath = path.resolve(rulePath, smartFunctionFile);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Smart function file not found: ${srcPath}`);
  }

  const sourceContent = fs.readFileSync(srcPath, 'utf-8');

  // Transpile TypeScript to JavaScript for the platform
  const jsFilename = smartFunctionFile.replace(/\.ts$/, '.js');
  const jsContent = smartFunctionFile.endsWith('.ts')
    ? transpileTypeScript(sourceContent, smartFunctionFile)
    : sourceContent;

  // Rewrite the yaml to reference the .js output
  const deployYaml = yamlContent.replace(
    /^(smartFunctionFile:\s*).*$/m,
    `$1"${jsFilename}"`,
  );

  // Build the tar.gz archive
  const entries = [
    { name: 'data-prep.yaml', content: deployYaml },
    { name: jsFilename, content: jsContent },
  ];

  // Include tests/*.yaml files if present
  const testsDir = path.resolve(rulePath, 'tests');
  if (fs.existsSync(testsDir) && fs.statSync(testsDir).isDirectory()) {
    const testFiles = fs.readdirSync(testsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();
    for (const testFile of testFiles) {
      const testPath = path.resolve(testsDir, testFile);
      entries.push({ name: `tests/${testFile}`, content: fs.readFileSync(testPath, 'utf-8') });
    }
  }

  const fileList = entries.map(e => e.name).join(' + ');
  console.log(`Packaging rule '${ruleName}': ${fileList}`);

  const tarBuffer = buildTar(entries);
  const gzipBuffer = zlib.gzipSync(tarBuffer);

  // Deploy via PUT with raw gzip body
  const config = getConfig();
  const url = `${config.baseUrl}/service/dataprep/v1/rules/${encodeURIComponent(ruleName)}/deployed`;

  console.log(`Deploying to ${url} ...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/gzip',
        Authorization: config.authHeader,
      },
      body: gzipBuffer,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out after 30 seconds');
    }
    throw new Error(`Failed to connect to ${config.baseUrl}: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await response.text();

  if (!response.ok) {
    let detail = '';
    if (responseBody) {
      try {
        const parsed = JSON.parse(responseBody);
        detail = parsed.message || parsed.error || responseBody;
      } catch {
        detail = responseBody;
      }
    }
    throw new Error(`Platform returned HTTP ${response.status}: ${detail}`);
  }

  console.log(`Rule '${ruleName}' deployed successfully.`);
}

/**
 * Discover rule directories. If the given path contains a data-prep.yaml it is
 * a single rule folder. Otherwise, treat it as a parent and return all immediate
 * subdirectories that contain a data-prep.yaml.
 */
function discoverRuleDirs(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`Error: Directory not found: ${resolved}`);
    process.exit(2);
  }

  // Single rule folder
  if (fs.existsSync(path.resolve(resolved, 'data-prep.yaml'))) {
    return [resolved];
  }

  // Parent directory — find sub-folders containing data-prep.yaml
  const dirs = fs.readdirSync(resolved)
    .filter(name => {
      const sub = path.resolve(resolved, name);
      return fs.statSync(sub).isDirectory() && fs.existsSync(path.resolve(sub, 'data-prep.yaml'));
    })
    .sort()
    .map(name => path.resolve(resolved, name));

  if (dirs.length === 0) {
    console.error(`Error: No rule folders (containing data-prep.yaml) found in ${resolved}`);
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
Usage: node scripts/deploy.js [rule-folder]

Arguments:
  rule-folder  Path to a rule directory (e.g. rules/weather-measurements)
               or a parent directory to deploy all rules (e.g. rules/).
               Defaults to 'rules/' if omitted.

Environment variables:
  C8Y_BASEURL    Cumulocity base URL (e.g. https://mytenant.cumulocity.com)
  C8Y_TOKEN      Bearer token (recommended)
  C8Y_USER       Username with DATA_PREPARATION_RULES_ADMIN + DEPLOYMENTS_ADMIN roles
  C8Y_PASSWORD   Password (basic auth — prefer C8Y_TOKEN)
    `.trim());
    process.exit(0);
  }

  const target = args[0] || 'rules';
  const ruleDirs = discoverRuleDirs(target);

  let failed = 0;
  for (const ruleDir of ruleDirs) {
    try {
      await deploy(ruleDir);
    } catch (err) {
      console.error(`Error deploying ${path.basename(ruleDir)}: ${err.message}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} of ${ruleDirs.length} rule(s) failed to deploy.`);
    process.exit(1);
  }

  if (ruleDirs.length > 1) {
    console.log(`\nAll ${ruleDirs.length} rules deployed successfully.`);
  }
}

main();
