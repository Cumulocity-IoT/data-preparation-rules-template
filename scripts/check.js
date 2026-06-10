#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { boldGreen, red, header } from './lib/cli-color.js';

function main() {
	console.log(header('Running TypeScript check'));

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

	console.log(boldGreen('✓ TypeScript check passed.\n'));
	process.exit(0);
}

main();
