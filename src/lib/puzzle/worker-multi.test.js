import { describe, expect, it } from 'vitest';
import { Solver } from '#lib/puzzle/solver/solver.js';
import { SquareGrid } from '#lib/puzzle/grids/squaregrid.js';
import { MOVE_KIND, applyForestEvent } from '#lib/puzzle/generator/generator-forest.js';

/**
 * Worker contract tests: the generate and debug commands of
 * worker-multi.js, which consumes the forest engine's MultiGenerator
 * surface exactly (see the spec's interface contract)
 */

/**
 * Captures everything the worker posts while handling messages. The worker
 * module registers its handler on import; tests in one file share the
 * module cache, so the handler survives between calls
 * @param {any[]} events - messages to feed the worker's onmessage
 * @returns {Promise<any[]>} posted messages, in order
 */
async function runWorker(events) {
	/** @type {any[]} */
	const messages = [];
	/** @type {any} */
	const globalAny = globalThis;
	globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
	await import('#lib/puzzle/worker-multi.js');
	for (const event of events) {
		globalAny.onmessage(event);
	}
	return messages;
}

describe('Test multipipes generation worker', () => {
	it('Answers a generate command with generated tiles', async () => {
		const grid = new SquareGrid(4, 4, false);
		const messages = await runWorker([
			{
				data: {
					command: 'generate',
					grid: grid.export(),
					options: {
						sharingAmount: 0.35,
						branchingAmount: 0.5,
						avoidObvious: 0,
						avoidStraights: 0.5,
						treeCount: 3,
						solutionsNumber: 'unique'
					}
				}
			}
		]);
		const generated = messages.find((message) => message.msg === 'generated');
		expect(generated?.tiles?.length).toBe(grid.total);
		// the board is scrambled: solve it back to verify uniqueness
		const tiles = /** @type {Number[][]} */ (generated?.tiles);
		const solver = new Solver(tiles, grid);
		expect(solver.markAmbiguousTiles().unique).toBe(true);
	});

	it('Answers an unknown solutionsNumber with an error message', async () => {
		const grid = new SquareGrid(3, 3, false);
		const messages = await runWorker([
			{
				data: {
					command: 'generate',
					grid: grid.export(),
					options: {
						branchingAmount: 0.5,
						avoidObvious: 0,
						solutionsNumber: /** @type {any} */ ('bogus')
					}
				}
			}
		]);
		expect(messages.some((message) => message.msg === 'error')).toBe(true);
	});

	it('Rejects debug-step before debug-start', async () => {
		const messages = await runWorker([{ data: { command: 'debug-step' } }]);
		expect(messages.at(-1)?.msg).toBe('error');
	});

	it('Steps through debug iterations until done', async () => {
		const grid = new SquareGrid(4, 4, false);
		const messages = await runWorker([
			{
				data: {
					command: 'debug-start',
					grid: grid.export(),
					options: {
						sharingAmount: 0.35,
						branchingAmount: 0.5,
						avoidObvious: 0,
						maxAmbiguousTiles: 0
					}
				}
			}
		]);
		expect(messages.at(-1)?.msg).toBe('debug-ready');

		let iterations = 0;
		let sawUnique = false;
		/** @type {any} */
		const globalAny = globalThis;
		while (iterations < 500) {
			const producedFrom = messages.length;
			globalAny.onmessage({ data: { command: 'debug-step' } });
			const produced = messages.slice(producedFrom);
			expect(
				produced.some((message) => ['iteration', 'debug-done', 'error'].includes(message.msg))
			).toBe(true);
			const iteration = produced.find((message) => message.msg === 'iteration');
			if (iteration) {
				iterations += 1;
				expect(iteration.tiles?.length).toBe(grid.total);
				expect(iteration.marked?.length).toBe(grid.total);
				sawUnique = sawUnique || iteration.unique === true;
			}
			if (produced.some((message) => message.msg === 'debug-done')) {
				break;
			}
		}
		expect(iterations).toBeGreaterThan(0);
		// the loop stops right after a unique iteration
		expect(sawUnique).toBe(true);
		expect(messages.at(-1)?.msg).toBe('debug-done');
	});

	it('Reports the true ambiguity count for the last debug board', async () => {
		const grid = new SquareGrid(4, 4, false);
		const messages = await runWorker([
			{
				data: {
					command: 'debug-start',
					grid: grid.export(),
					options: { branchingAmount: 0.5, avoidObvious: 0 }
				}
			},
			{ data: { command: 'debug-step' } },
			{ data: { command: 'debug-true-count' } }
		]);
		const iteration = messages.find((message) => message.msg === 'iteration');
		expect(iteration?.tiles?.length).toBe(grid.total);
		expect(messages.at(-1)?.msg).toBe('true-count');
		expect(messages.at(-1)?.numAmbiguous).toBeGreaterThanOrEqual(0);
	});

	it('Streams growth events on growth-start', async () => {
		const grid = new SquareGrid(3, 3, false);
		const messages = await runWorker([
			{
				data: {
					command: 'growth-start',
					grid: grid.export(),
					options: { branchingAmount: 0.5, avoidObvious: 0 }
				}
			}
		]);
		const moveMessages = messages.filter((message) => message.msg === 'growth-move');
		expect(moveMessages.length).toBeGreaterThan(0);
		const done = messages.find((message) => message.msg === 'growth-done');
		expect(done?.tiles?.length).toBe(grid.total);
		// the growth command runs the forest engine: every event is one
		// atomic edge move, replaying them reproduces the grown board exactly
		/** @type {Number[][]} */
		const board = Array.from({ length: grid.total }, () => []);
		for (const message of moveMessages) {
			applyForestEvent(grid, board, message.event);
		}
		expect(board).toStrictEqual(done?.tiles);
	});

	it('Passes the tree count knob through: one seed event for one tree', async () => {
		const grid = new SquareGrid(6, 6, false);
		const messages = await runWorker([
			{
				data: {
					command: 'growth-start',
					grid: grid.export(),
					options: { branchingAmount: 0.5, treeCount: 1 }
				}
			}
		]);
		const seeds = messages.filter(
			(message) =>
				message.msg === 'growth-move' &&
				message.event?.type === 'move' &&
				message.event?.kind === MOVE_KIND.SEED
		);
		expect(seeds.length).toBe(1);
	});

	it('Regrows from start tiles handed to growth-start', async () => {
		const grid = new SquareGrid(6, 2, false);
		// a four-cell path kept, everything else erased: the growth pass
		// opens with a reuse event for exactly those cells
		/** @type {(Number[]|null)[]} */
		const startTiles = Array.from({ length: grid.total }, () => null);
		startTiles[7] = [1];
		startTiles[8] = [5];
		startTiles[9] = [5];
		startTiles[10] = [4];
		const messages = await runWorker([
			{
				data: {
					command: 'growth-start',
					grid: grid.export(),
					options: { branchingAmount: 0.5, treeCount: 3 },
					startTiles
				}
			}
		]);
		expect(messages.some((message) => message.msg === 'error')).toBe(false);
		const reuse = messages.find(
			(message) => message.msg === 'growth-move' && message.event?.type === 'reuse'
		);
		expect(reuse?.event?.cells?.map((/** @type {any} */ entry) => entry.cell)).toEqual([
			7, 8, 9, 10
		]);
		const done = messages.find((message) => message.msg === 'growth-done');
		expect(done?.tiles?.length).toBe(grid.total);
	});
});
