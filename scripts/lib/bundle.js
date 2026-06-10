// Shared esbuild bundling for rule sources, used by test.js and deploy.js.

import path from 'node:path';
import { build } from 'esbuild';

/**
 * Given the `smartFunctionFile` value from data-prep.yaml, derive the path to
 * the TypeScript source. The deployed archive references a `.js` file, but the
 * source in the repo is `.ts`.
 */
export function sourcePathFor(ruleFolder, smartFunctionFile) {
  const tsName = smartFunctionFile.endsWith('.js')
    ? smartFunctionFile.replace(/\.js$/, '.ts')
    : smartFunctionFile;
  return path.join(ruleFolder, tsName);
}

/** The `.js` filename used for the deployed archive entry. */
export function deployedJsName(smartFunctionFile) {
  return smartFunctionFile.endsWith('.ts')
    ? smartFunctionFile.replace(/\.ts$/, '.js')
    : smartFunctionFile;
}

/**
 * Bundle a TypeScript rule source into a single ES2023 module string.
 * @returns {Promise<{ jsCode: string, map: object }>} the bundled code and its sourcemap.
 */
export async function bundleRule(tsSourcePath) {
  const result = await build({
    entryPoints: [tsSourcePath],
    bundle: true,
    format: 'esm',
    target: 'es2023',
    write: false,
    // An output path is required for an external sourcemap even though nothing
    // is written to disk (write: false). esbuild only uses it to name outputs.
    outdir: 'dist',
    sourcemap: 'external',
    sourcesContent: true,
    logLevel: 'silent',
  });

  let jsCode = '';
  let map = null;
  for (const file of result.outputFiles) {
    if (file.path.endsWith('.map')) {
      map = JSON.parse(file.text);
    } else {
      jsCode = file.text;
    }
  }
  return { jsCode, map };
}
