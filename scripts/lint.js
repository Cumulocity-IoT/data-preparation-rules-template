#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { boldGreen, red, header } from './lib/cli-color.js';

function main() {
	process.stdout.write(header('Running ESLint'));

	const result = spawnSync('eslint', ['rules/'], {
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});

	if (result.error) {
		console.error(red(`\n✗ Failed to run ESLint: ${result.error.message}\n`));
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	console.log(boldGreen('\n✓ ESLint passed.\n'));
	process.exit(0);
}

main();
