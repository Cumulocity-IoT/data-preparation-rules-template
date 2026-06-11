#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { discoverRuleFolders } from './lib/rules.js';
import { boldGreen, red, header } from './lib/cli-color.js';

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
		console.error(red(`Error: ${err.message}`));
		process.exit(1);
	}

	console.log(header(`Running type check ${ruleLabel(ruleFolders)}`));

	const result = spawnSync('tsc', ['--noEmit'], {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});

	if (result.error) {
		console.error(red(`✗ Failed to run tsc: ${result.error.message}\n`));
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	console.log(boldGreen('✓ Type check passed.\n'));
	process.exit(0);
}

main();
