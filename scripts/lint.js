#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { discoverRuleFolders } from './lib/rules.js';
import kleur from 'kleur';
import { header } from './lib/header.js';

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

	process.stdout.write(header(`Running ESLint ${ruleLabel(ruleFolders)}`));

	const targets = args.length > 0 ? ruleFolders : ['rules/'];
	const result = spawnSync('eslint', targets, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});

	if (result.error) {
		console.error(kleur.red(`\n✗ Failed to run ESLint: ${result.error.message}\n`));
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	console.log(kleur.bold().green('\n✓ ESLint passed.\n'));
	process.exit(0);
}

main();
