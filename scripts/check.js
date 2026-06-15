#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverRuleFolders } from './lib/rules.js';
import kleur from 'kleur';
import { header } from './lib/header.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function ruleLabel(ruleFolders) {
	if (ruleFolders.length === 1) return `for ${path.basename(ruleFolders[0])}`;
	return `for ${ruleFolders.length} rules`;
}

function main() {
	const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
	let ruleFolders;
	try {
		ruleFolders = discoverRuleFolders(args);
	} catch (err) {
		console.error(kleur.red(`Error: ${err.message}`));
		process.exit(1);
	}

	const specificRules = args.length > 0;
	console.log(header(`Running type check ${specificRules ? ruleLabel(ruleFolders) : 'for all rules'}`));

	// When specific rules are requested, generate a temporary tsconfig that extends
	// the base but restricts `include` to only the specified rule folders.
	let tscArgs = ['--noEmit'];
	let tmpConfigPath = null;

	if (specificRules) {
		const include = ruleFolders.map(
			(f) => path.relative(repoRoot, f).replace(/\\/g, '/') + '/**/*.ts',
		);
		tmpConfigPath = path.join(repoRoot, '.tsconfig-check-tmp.json');
		writeFileSync(tmpConfigPath, JSON.stringify({ extends: './tsconfig.json', include }));
		tscArgs = ['--project', tmpConfigPath];
	}

	let result;
	try {
		result = spawnSync('tsc', tscArgs, {
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});
	} finally {
		if (tmpConfigPath) {
			try { unlinkSync(tmpConfigPath); } catch { /* ignore */ }
		}
	}

	if (result.error) {
		console.error(kleur.red(`✗ Failed to run tsc: ${result.error.message}\n`));
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	console.log(kleur.bold().green('✓ Type check passed.\n'));
	process.exit(0);
}

main();
