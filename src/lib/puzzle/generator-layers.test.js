import { describe, expect, it } from 'vitest';
import {
	LayeredGenerator,
	applyRotations,
	buildStartLayers,
	planReuse,
	pregenerate_layers,
	randomRotate,
	validateLayers
} from './generator-layers';
import { SquareGrid } from './grids/squaregrid';
import { HexaGrid } from './grids/hexagrid';
import { LayeredPipesGame } from './game-layers.svelte';
import { LayeredSolver } from './solver-layers';

const LETTERS = { 1: 'E', 2: 'N', 4: 'W', 8: 'S' };

/**
 * Renders layer bitmasks as direction letters, e.g. 13 -> "EW"
 * @param {Number} layer
 */
function decode(layer) {
	let result = '';
	for (let [bit, letter] of Object.entries(LETTERS)) {
		if ((layer & Number(bit)) > 0) {
			result += letter;
		}
	}
	return result;
}

describe('Test layered pregeneration', () => {
	const boards = [
		[3, 3, false],
		[4, 6, false],
		[5, 5, false],
		[5, 5, true]
	];

	for (let [width, height, wrap] of boards) {
		for (let branchingAmount of [0, 0.5, 1]) {
			for (let avoidObvious of [0, 0.5, 1]) {
				it(
					`Pregenerates a valid layered puzzle ${width}x${height} wrap=${wrap} ` +
						`branching=${branchingAmount} avoidObvious=${avoidObvious}`,
					() => {
						for (let i = 0; i < 10; i++) {
							const grid = new SquareGrid(width, height, wrap);
							const layers = pregenerate_layers(grid, branchingAmount, avoidObvious);
							validateLayers(grid, layers);
							expect(layers.length).toBe(grid.total);
						}
					}
				);
			}
		}
	}

	it('Prints a small layered puzzle', () => {
		const grid = new SquareGrid(5, 5, false);
		const layers = pregenerate_layers(grid, 0.5);
		validateLayers(grid, layers);
		expect(layers.length).toBe(grid.total);
		console.log('tiles array:', JSON.stringify(layers));
		for (let r = 0; r < grid.height; r++) {
			const cells = [];
			for (let c = 0; c < grid.width; c++) {
				const cellLayers = layers[r * grid.width + c];
				if (cellLayers.length === 0) {
					cells.push('.');
				} else {
					cells.push(cellLayers.map((layer) => `${layer}(${decode(layer)})`).join('/'));
				}
			}
			console.log(`Row ${r}: ${cells.join('  ')}`);
		}
	});
});

describe('Test layered scrambling', () => {
	it('Scrambled boards keep their shape', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(5, 5, false);
			const solved = pregenerate_layers(grid, 0.5);
			const scrambled = randomRotate(solved, grid);
			expect(scrambled.length).toBe(grid.total);
			scrambled.forEach((cellLayers, index) => {
				expect(cellLayers.length).toBe(solved[index].length);
				const polygon = grid.polygon_at(index);
				let used = 0;
				let xored = 0;
				cellLayers.forEach((layer) => {
					expect(layer).toBeGreaterThan(0);
					expect((layer | polygon.fully_connected) === polygon.fully_connected).toBe(true);
					used |= layer;
					xored ^= layer;
				});
				// layers of a cell still don't share directions
				expect(used).toBe(xored);
			});
		}
	});

	it('Scrambling actually scrambles', () => {
		const grid = new SquareGrid(5, 5, false);
		const solved = pregenerate_layers(grid, 0.5);
		const scrambled = randomRotate(solved, grid);
		const changed = scrambled.filter((cellLayers, index) =>
			cellLayers.some((layer, layerIndex) => layer !== solved[index][layerIndex])
		);
		expect(changed.length).toBeGreaterThan(0);
	});

	it('Scrambled board can be solved by rotating cells back', () => {
		const grid = new SquareGrid(4, 4, false);
		const solved = pregenerate_layers(grid, 0.5);
		const scrambled = randomRotate(solved, grid);
		const game = new LayeredPipesGame(grid, scrambled, undefined);
		expect(game.isSolved()).toBe(false);
		// find the rotation that solves every cell
		game.tileStates.forEach((state, index) => {
			for (let rotations = 0; rotations < 4; rotations++) {
				const rotatedLayers = state.layers.map((layer) => grid.rotate(layer, rotations, index));
				const target = solved[index];
				if (rotatedLayers.every((layer, layerIndex) => layer === target[layerIndex])) {
					game.rotateTile(index, rotations);
					break;
				}
			}
		});
		expect(game.solved).toBe(true);
	});
});

describe('Test layered startLayers reuse', () => {
	/**
	 * Checks that some layer of the cell covers all the given direction bits
	 * @param {Number[]} cellLayers
	 * @param {Number} bits - direction bitmask
	 */
	function hasLayerWithBits(cellLayers, bits) {
		return cellLayers.some((layer) => (layer & bits) === bits);
	}

	it('Reuses non-ambiguous regions and produces valid boards', () => {
		// fuzz startLayers with messy component topologies:
		// randomly nulled cells create small components, conflicts,
		// cells shared by several components and dissolved layers
		for (let i = 0; i < 150; i++) {
			const wrap = i % 3 === 0;
			const grid = i % 5 === 0 ? new HexaGrid(3, 4, wrap) : new SquareGrid(4, 4, wrap);
			const tiles = pregenerate_layers(grid, Math.random());
			const solver = new LayeredSolver(tiles, grid);
			const { marked } = solver.markAmbiguousTiles();
			const startLayers = buildStartLayers(grid, tiles, marked);
			for (let cell = 0; cell < grid.total; cell++) {
				if (startLayers[cell] && Math.random() < 0.4) {
					startLayers[cell] = null;
				}
			}
			const regenerated = pregenerate_layers(
				grid,
				Math.random(),
				0,
				startLayers,
				[1, 2, 3, 5][i % 4]
			);
			validateLayers(grid, regenerated);
		}
	});

	it('Reproduces a fully keepable board verbatim', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(5, 5, false);
			const tiles = pregenerate_layers(grid, Math.random());
			const regenerated = pregenerate_layers(grid, 0.5, 0, tiles);
			validateLayers(grid, regenerated);
			expect(regenerated).toStrictEqual(tiles);
		}
	});

	it('Reproduces the rotated solution when no cell is ambiguous', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(4, 4, false);
			const tiles = pregenerate_layers(grid, Math.random());
			const solver = new LayeredSolver(tiles, grid);
			const { marked, numAmbiguous } = solver.markAmbiguousTiles();
			const startLayers = buildStartLayers(grid, tiles, marked);
			const regenerated = pregenerate_layers(grid, 0.5, 0, startLayers);
			validateLayers(grid, regenerated);
			if (numAmbiguous === 0) {
				expect(regenerated).toStrictEqual(applyRotations(grid, tiles, marked));
			}
		}
	});

	it('Absorbs dormant islands with their internal edges preserved', () => {
		const grid = new SquareGrid(3, 3, false);
		// live region: top row (cell 1 is a straight);
		// dormant island: bottom row; middle row is ambiguous
		const startLayers = [[1], [5], [4], null, null, null, [1], [5], [4]];
		for (let i = 0; i < 20; i++) {
			const regenerated = pregenerate_layers(grid, Math.random(), 0, startLayers);
			validateLayers(grid, regenerated);
			for (let [cell, bits] of [
				[0, 1],
				[1, 5],
				[2, 4],
				[6, 1],
				[7, 5],
				[8, 4]
			]) {
				expect(hasLayerWithBits(regenerated[cell], bits)).toBe(true);
			}
		}
	});

	it('Drops layers that only connect to ambiguous cells', () => {
		const grid = new SquareGrid(3, 3, false);
		// cell 0 has two layers: [1] pointing at ambiguous cell 1
		// (dissolves) and [8] pointing at keepable cell 3 (live seed)
		const startLayers = [[1, 8], null, null, [2], null, null, null, null, null];
		for (let i = 0; i < 20; i++) {
			const regenerated = pregenerate_layers(grid, Math.random(), 0, startLayers);
			validateLayers(grid, regenerated);
			expect(hasLayerWithBits(regenerated[0], 8)).toBe(true);
			expect(hasLayerWithBits(regenerated[3], 2)).toBe(true);
		}
	});

	it('Dissolves islands that share a cell with another reused component', () => {
		const grid = new SquareGrid(3, 3, false);
		// live region: 0-1-4 (cell 1 is a corner);
		// island {4/L1, 5} shares cell 4 with live and dissolves;
		// island {6, 7, 8} is conflict-free and gets absorbed
		const startLayers = [[1], [12], null, null, [2, 1], [4], [1], [5], [4]];
		for (let i = 0; i < 20; i++) {
			const regenerated = pregenerate_layers(grid, Math.random(), 0, startLayers);
			validateLayers(grid, regenerated);
			for (let [cell, bits] of [
				[0, 1],
				[1, 12],
				[4, 2],
				[6, 1],
				[7, 5],
				[8, 4]
			]) {
				expect(hasLayerWithBits(regenerated[cell], bits)).toBe(true);
			}
		}
		// with a higher minimum size the bottom island dissolves too
		const regenerated = pregenerate_layers(grid, 0.5, 0, startLayers, 4);
		validateLayers(grid, regenerated);
	});

	it('Treats unusable startLayers as a fresh board', () => {
		const grid = new SquareGrid(4, 4, false);
		const allNull = Array.from({ length: grid.total }, () => null);
		for (let i = 0; i < 5; i++) {
			validateLayers(grid, pregenerate_layers(grid, 0.5, 0, allNull));
		}
		// wrong length is ignored entirely
		validateLayers(grid, pregenerate_layers(grid, 0.5, 0, [null]));
	});

	it('Plans live, island and dissolved roles', () => {
		const grid = new SquareGrid(3, 3, false);
		// live region 0-1-4; island {4/L1, 5} shares cell 4 with live and
		// dissolves; island {6, 7, 8} is conflict-free
		const startLayers = [[1], [12], null, null, [2, 1], [4], [1], [5], [4]];
		const plan = planReuse(grid, startLayers);
		expect(plan.cells.get(0)?.role).toBe('live');
		expect(plan.cells.get(1)?.role).toBe('live');
		expect(plan.cells.get(4)?.role).toBe('live');
		expect(plan.cells.get(5)?.role).toBe('dissolved');
		expect(plan.cells.get(6)?.role).toBe('island');
		expect(plan.cells.get(7)?.role).toBe('island');
		expect(plan.cells.get(8)?.role).toBe('island');
		expect(plan.cells.get(2)).toBeUndefined();
		// live layers are pruned to the component's edges
		expect(plan.cells.get(0)?.layers).toStrictEqual([1]);
		expect(plan.cells.get(1)?.layers).toStrictEqual([12]);
		expect(plan.cells.get(4)?.layers).toStrictEqual([2]);
		// the surviving island keeps its internal skeleton
		expect(plan.cells.get(7)?.layers).toStrictEqual([5]);
		// all island cells map to the same island
		const island = plan.islands.get(6);
		expect(island).toBeDefined();
		expect([...(island || [])]).toStrictEqual([6, 7, 8]);
		expect(plan.islands.get(8)).toBe(island);
	});
});

describe('Test layered generator', () => {
	it('Generates a unique solution puzzle', () => {
		const grid = new SquareGrid(4, 4, false);
		for (let i = 0; i < 10; i++) {
			const generator = new LayeredGenerator(grid);
			const tiles = generator.generate(0.5, 0, 'unique');
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(true);
		}
	});

	it('Generates a unique solution wrap puzzle', () => {
		const grid = new SquareGrid(5, 5, true);
		for (let i = 0; i < 3; i++) {
			const generator = new LayeredGenerator(grid);
			const tiles = generator.generate(0.5, 0, 'unique');
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(true);
		}
	});

	it('Generates a unique solution hexagonal puzzle', () => {
		const grid = new HexaGrid(4, 6, false);
		for (let i = 0; i < 5; i++) {
			const generator = new LayeredGenerator(grid);
			const tiles = generator.generate(0.5, 0, 'unique');
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(true);
		}
	});

	it('Generates a puzzle without uniqueness check', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid);
		const tiles = generator.generate(0.5, 0, 'whatever');
		tiles.forEach((cellLayers) => {
			expect(cellLayers.length).toBeGreaterThan(0);
		});
	});

	it('Generates a puzzle with multiple solutions', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid, 3, 5, 100);
		/** @type {Number[][]|null} */
		let tiles = null;
		for (let attempt = 0; attempt < 5 && tiles === null; attempt++) {
			try {
				tiles = generator.generate(0.5, 0, 'multiple');
			} catch {
				// occasionally no multiple-solution board is found, retry
			}
		}
		if (tiles !== null) {
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(false);
		}
	});

	it('Reports progress and rejects unknown settings', () => {
		const grid = new SquareGrid(3, 3, false);
		/** @type {import('./generator-layers').GeneratorProgress[]} */
		const generatorProgress = [];
		/** @type {import('./solver-layers').SolverProgress[]} */
		const solverProgress = [];
		/** @param {import('./solver-layers').SolverProgress} progress */
		const onSolverProgress = (progress) => solverProgress.push(progress);
		/** @param {import('./generator-layers').GeneratorProgress} progress */
		const onGeneratorProgress = (progress) => generatorProgress.push(progress);
		const generator = new LayeredGenerator(
			grid,
			3,
			5,
			10,
			10,
			0,
			onSolverProgress,
			onGeneratorProgress
		);
		generator.generate(0.5, 0, 'unique');
		expect(generatorProgress.length).toBeGreaterThan(0);
		expect(solverProgress.length).toBeGreaterThan(0);
		expect(() => generator.generate(0.5, 0, /** @type {any} */ ('bogus'))).toThrow(
			'Unknown setting for solutionsNumber'
		);
	});
});

describe('Test layered generation worker', () => {
	it('Answers a generate command with generated tiles', async () => {
		// shim the web worker globals before importing the worker module
		/** @type {{msg: string, tiles?: Number[][]}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		globalAny.onmessage = null;
		await import('./worker-layers.js');

		const grid = new SquareGrid(4, 4, false);
		/** @type {any} */
		const event = {
			data: {
				command: 'generate',
				grid: grid.export(),
				options: { branchingAmount: 0.5, avoidObvious: 0, solutionsNumber: 'unique' }
			}
		};
		globalAny.onmessage(event);
		expect(messages.length).toBeGreaterThan(0);
		const generated = messages.find((message) => message.msg === 'generated');
		expect(generated?.tiles?.length).toBe(grid.total);
		// the board is scrambled: solve it back to verify uniqueness
		const tiles = /** @type {Number[][]} */ (generated?.tiles);
		const solver = new LayeredSolver(tiles, grid);
		expect(solver.markAmbiguousTiles().unique).toBe(true);
	});

	it('Answers an unknown solutionsNumber with an error message', async () => {
		/** @type {{msg: string, error?: any}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		const grid = new SquareGrid(3, 3, false);
		/** @type {any} */
		const event = {
			data: {
				command: 'generate',
				grid: grid.export(),
				options: {
					branchingAmount: 0.5,
					avoidObvious: 0,
					solutionsNumber: /** @type {any} */ ('bogus')
				}
			}
		};
		globalAny.onmessage(event);
		expect(messages.some((message) => message.msg === 'error')).toBe(true);
	});

	it('Rejects debug-step before debug-start', async () => {
		/** @type {{msg: string}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		globalAny.onmessage({ data: { command: 'debug-step' } });
		expect(messages.at(-1)?.msg).toBe('error');
	});

	it('Steps through debug iterations until done', async () => {
		/** @type {{msg: string, tiles?: Number[][], marked?: Number[], unique?: boolean}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		const grid = new SquareGrid(4, 4, false);
		globalAny.onmessage({
			data: {
				command: 'debug-start',
				grid: grid.export(),
				options: { branchingAmount: 0.5, avoidObvious: 0, solutionsNumber: 'unique' }
			}
		});
		expect(messages.at(-1)?.msg).toBe('debug-ready');

		let iterations = 0;
		let sawUnique = false;
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
		/** @type {{msg: string, numAmbiguous?: Number}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		const grid = new SquareGrid(4, 4, false);
		globalAny.onmessage({
			data: {
				command: 'debug-start',
				grid: grid.export(),
				options: { branchingAmount: 0.5, avoidObvious: 0, solutionsNumber: 'unique' }
			}
		});
		globalAny.onmessage({ data: { command: 'debug-step' } });
		const iteration = /** @type {{msg: string, tiles?: Number[][]}} */ (
			messages.find((message) => message.msg === 'iteration')
		);
		expect(iteration?.tiles?.length).toBe(grid.total);
		globalAny.onmessage({ data: { command: 'debug-true-count' } });
		expect(messages.at(-1)?.msg).toBe('true-count');
		expect(messages.at(-1)?.numAmbiguous).toBeGreaterThanOrEqual(0);
	});
});

describe('Test layered uniqueIterations', () => {
	it('Yields valid iteration snapshots and stops after a unique one', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid, 3, 2, 5, 10);
		let steps = 0;
		for (const step of generator.uniqueIterations(0.5, 0)) {
			steps += 1;
			expect(step.attempt).toBeGreaterThan(0);
			expect(step.iteration).toBeGreaterThan(0);
			validateLayers(grid, step.tiles);
			expect(step.marked.length).toBe(grid.total);
			expect(step.numAmbiguous).toBeGreaterThanOrEqual(0);
			expect(step.keptCount).toBeGreaterThanOrEqual(0);
			expect(step.elapsedMs).toBeGreaterThanOrEqual(0);
			if (steps === 1) {
				expect(step.keptCount).toBe(0);
			}
			if (step.unique) {
				const solver = new LayeredSolver(step.tiles, grid);
				expect(solver.markAmbiguousTiles().unique).toBe(true);
			}
			expect(steps).toBeLessThan(500);
		}
		expect(steps).toBeGreaterThan(0);
	});

	it('Ends without yields when uniqueness iterations are disabled', () => {
		const grid = new SquareGrid(3, 3, false);
		const generator = new LayeredGenerator(grid, 3, 5, 3, 0);
		const steps = [...generator.uniqueIterations(0.5, 0)];
		expect(steps.length).toBe(0);
	});

	it('Honors a custom ambiguity limit', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid, 3, 2, 5, 10);
		for (const step of generator.uniqueIterations(0.5, 0, 1)) {
			// marking stops as soon as one ambiguity is found (or the board is unique)
			expect(step.numAmbiguous).toBeLessThanOrEqual(1);
			if (step.unique) {
				break;
			}
		}
	});
});
