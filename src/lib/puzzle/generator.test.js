import { describe, expect, it } from 'vitest';
import { Generator, computeCellObviousTiles } from './generator.js';
import { HexaGrid } from './grids/hexagrid.js';
import { SquareGrid } from './grids/squaregrid.js';
import { Solver } from './solver.js';
import { SnubSquareGrid } from './grids/snubsquaregrid.js';

describe('Test Prims pregeneration', () => {
	const branchingAmount = 1;

	it('Pregenerates a solvable puzzle 5x5', () => {
		const grid = new HexaGrid(5, 5, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 5x5 wrap', () => {
		const grid = new HexaGrid(5, 5, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6', () => {
		const grid = new HexaGrid(4, 6, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6 wrap', () => {
		const grid = new HexaGrid(4, 6, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});
});

describe('Test Recursive Backtracking pregeneration', () => {
	const branchingAmount = 0;

	it('Pregenerates a solvable puzzle 5x5', () => {
		const grid = new HexaGrid(5, 5, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 5x5 wrap', () => {
		const grid = new HexaGrid(5, 5, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6', () => {
		const grid = new HexaGrid(4, 6, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6 wrap', () => {
		const grid = new HexaGrid(4, 6, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});
});

describe('Test Growing Tree pregeneration', () => {
	const branchingAmount = 0.5;

	it('Pregenerates a solvable puzzle 5x5', () => {
		const grid = new HexaGrid(5, 5, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 5x5 wrap', () => {
		const grid = new HexaGrid(5, 5, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6', () => {
		const grid = new HexaGrid(4, 6, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6 wrap', () => {
		const grid = new HexaGrid(4, 6, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_growingtree(branchingAmount);
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});
});

describe('Test Growing Tree pregeneration with avoid obvious tiles', () => {
	it('Pregenerates a solvable puzzle every time', () => {
		// test with a larger number of attempts to be really sure
		for (let i = 0; i < 100; i++) {
			const width = 2 + Math.floor(Math.random() * 7);
			const height = 2 + Math.floor(Math.random() * 7);
			const grid = new HexaGrid(width, height, false);
			const gen = new Generator(grid);
			const tiles = gen.pregenerate_growingtree(Math.random(), 1, Math.random());
			const hasEmptyTiles = tiles.some((t) => t === 0);
			expect(hasEmptyTiles).toBe(false);
			const solver = new Solver(tiles, grid);
			const { solvable } = solver.markAmbiguousTiles();
			expect(solvable).toBe(true);
		}
	});
});

describe('Test solution uniqueness', () => {
	/**
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number} [numAttempts=100]
	 */
	function verifyUnique(grid, numAttempts = 100) {
		for (let i = 0; i < numAttempts; i++) {
			const gen = new Generator(grid);
			const tiles = gen.generate();
			const solver = new Solver(tiles, grid);
			for (let _ of solver.solve(true)) {
			}
			expect(solver.solutions.length).toBe(1);
		}
	}

	it(
		'Generates a 20x20 hexagonal puzzle with a unique solution every time',
		() => {
			const grid = new HexaGrid(20, 20, false);
			verifyUnique(grid);
		},
		15 * 1000
	);

	it(
		'Generates a 20x20 hexagonal wrap puzzle with a unique solution every time',
		() => {
			const grid = new HexaGrid(20, 20, true);
			verifyUnique(grid);
		},
		15 * 1000
	);

	it('Generates a 20x20 square puzzle with a unique solution every time', () => {
		const grid = new SquareGrid(20, 20, false);
		verifyUnique(grid);
	});

	it('Generates a 20x20 square wrap puzzle with a unique solution every time', () => {
		const grid = new SquareGrid(20, 20, true);
		verifyUnique(grid);
	});

	// it('Generates a 10x10 snub square puzzle with a unique solution every time', () => {
	// 	const grid = new SnubSquareGrid(10, 10, false);
	// 	verifyUnique(grid);
	// });

	// it('Generates a 10x10 snub square wrap puzzle with a unique solution every time', () => {
	// 	const grid = new SnubSquareGrid(10, 10, true);
	// 	verifyUnique(grid);
	// });
});

describe('Test the avoid-obvious precompute', () => {
	it('Marks the orientations forced by border walls as forbidden', () => {
		const grid = new SquareGrid(3, 3, false);
		grid.makeEmpty(8);
		const forbidden = computeCellObviousTiles(grid, new Set([0, 1, 4, 7]));
		// corner: N+W walls leave the deadend class (E, S) and the E+S bend -
		// the bend's shape class has a single survivor
		expect(forbidden.get(0)).toEqual(new Set([9]));
		// edge: N wall leaves deadends (E, W, S), bends (E+S, W+S), the E+W
		// straight and the E+W+S triple - the straight and triple are singletons
		expect(forbidden.get(1)).toEqual(new Set([5, 13]));
		// center tile has no border walls, no entry
		expect(forbidden.has(4)).toBe(false);
		// empty cell 8 leaves deadends (N, W) and a single bend N+W
		expect(forbidden.get(7)).toEqual(new Set([6]));
	});
});
