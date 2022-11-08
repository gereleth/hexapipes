import { describe, expect, it } from 'vitest';
import { Generator } from './generator';
import { HexaGrid } from './hexagrid';
import { Solver } from './solver';

describe('Test Prims pregeneration', () => {
	it('Pregenerates a solvable puzzle 5x5', () => {
		const grid = new HexaGrid(5, 5, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_prims();
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 5x5 wrap', () => {
		const grid = new HexaGrid(5, 5, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_prims();
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6', () => {
		const grid = new HexaGrid(4, 6, false);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_prims();
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});

	it('Pregenerates a solvable puzzle 4x6 wrap', () => {
		const grid = new HexaGrid(4, 6, true);
		const gen = new Generator(grid);
		const tiles = gen.pregenerate_prims();
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
	});
});

describe('Test solution uniqueness', () => {
	it('Generates a 20x20 wrap puzzle with a unique solution every time', () => {
		const grid = new HexaGrid(20, 20, true);
		// test with a larger number of attempts to be really sure
		for (let i = 0; i < 100; i++) {
			const gen = new Generator(grid);
			const tiles = gen.generate();
			const solver = new Solver(tiles, grid);
			for (let _ of solver.solve()) {
			}
			expect(solver.solutions.length).toBe(1);
		}
	});
});
