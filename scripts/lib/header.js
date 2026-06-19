import kleur from 'kleur';

export function header(text) {
	const divider = '='.repeat(60);
	return kleur.bold().cyan(`${divider}\n  ${text}\n${divider}\n`);
}
