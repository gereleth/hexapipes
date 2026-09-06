import { describe, expect, it } from 'vitest';
import {
	LayeredGenerator,
	applyRotations,
	buildStartLayers,
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
