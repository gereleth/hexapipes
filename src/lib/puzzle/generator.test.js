import { describe, expect, it } from 'vitest';
import { Generator } from './generator';
import { HexaGrid } from './grids/hexagrid';
import { SquareGrid } from './grids/squaregrid';
import { Solver } from './solver';
import { SnubSquareGrid } from './grids/snubsquaregrid';

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

	it('Generates a 20x20 hexagonal puzzle with a unique solution every time', () => {
		const grid = new HexaGrid(20, 20, false);
		verifyUnique(grid);
	});

	it('Generates a 20x20 hexagonal wrap puzzle with a unique solution every time', () => {
		const grid = new HexaGrid(20, 20, true);
		verifyUnique(grid);
	});

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
