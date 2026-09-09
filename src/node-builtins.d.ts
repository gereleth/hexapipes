/**
 * Minimal ambient typings for node built-ins used by research test files,
 * so that `npm run check` stays clean without adding @types/node
 */
declare module 'node:fs' {
	export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
	export function writeFileSync(path: string, data: string): void;
}
