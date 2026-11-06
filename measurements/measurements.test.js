import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// vitest workers run at the project root; guard so a cwd surprise fails
// with a name, not a mystery
if (!existsSync('package.json') || !existsSync('measurements')) {
	throw new Error('measurements smoke test must run from the repo root');
}
const measurementsDir = 'measurements/';
const libDir = 'src/lib/';

/**
 * Import-resolution smoke test for the measurement scripts. They are
 * human-run decision tools outside src/, so no other check touches them:
 * prettier formats them, vitest ignores them, svelte-check scopes src/.
 * When a module moves or a branch-only engine disappears, they rot
 * silently - which is exactly what the KNOWN_UNRESOLVED allowlist below
 * records. The test parses import specifiers from source text and never
 * imports the scripts (importing would execute them).
 */

/**
 * Specifiers that do not resolve today, each with its reason. Exact-set
 * equality with the found failures: new rot goes red, and so does a stale
 * entry after its script is fixed or deleted - prune it then.
 */
const KNOWN_UNRESOLVED = {
	'#lib/puzzle/generator-layers.js': 'layers-branch engine, absent on this branch',
	'#lib/puzzle/solver-baseline': 'deliberately untracked frozen solver copy, per-machine'
};

/**
 * Resolves a #lib specifier through the package.json imports map
 * (`#lib/*` -> `./src/lib/*`), appending .js like node does for the
 * extension-less dynamic-import case
 * @param {string} specifier
 * @returns {boolean}
 */
function resolves(specifier) {
	if (!specifier.startsWith('#lib/')) {
		return true;
	}
	const base = `${libDir}${specifier.slice('#lib/'.length)}`;
	return existsSync(base) || existsSync(`${base}.js`);
}

describe('measurement scripts', () => {
	it('every #lib import resolves, apart from the known-unresolved allowlist', () => {
		const unresolved = new Set();
		for (const name of readdirSync(measurementsDir)) {
			if (!name.endsWith('.mjs')) {
				continue;
			}
			const source = readFileSync(`${measurementsDir}${name}`, 'utf8');
			for (const match of source.matchAll(/#lib\/[^'"\s)]+/g)) {
				if (!resolves(match[0])) {
					unresolved.add(match[0]);
				}
			}
		}
		expect([...unresolved].sort()).toEqual(Object.keys(KNOWN_UNRESOLVED).sort());
	});
});
