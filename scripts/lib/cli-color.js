const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD_CYAN = '\x1b[1;36m';
const BOLD_GREEN = '\x1b[1;32m';
const BOLD_RED = '\x1b[1;31m';

function colorize(code, text) {
	return `${code}${text}${RESET}`;
}

export function red(text) {
	return colorize(RED, text);
}

export function green(text) {
	return colorize(GREEN, text);
}

export function yellow(text) {
	return colorize(YELLOW, text);
}

export function cyan(text) {
	return colorize(CYAN, text);
}

export function boldCyan(text) {
	return colorize(BOLD_CYAN, text);
}

export function boldGreen(text) {
	return colorize(BOLD_GREEN, text);
}

export function boldRed(text) {
	return colorize(BOLD_RED, text);
}

export function header(text) {
	const divider = '='.repeat(60);
	return boldCyan(`${divider}\n  ${text}\n${divider}\n`);
}
