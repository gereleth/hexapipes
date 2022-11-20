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
			for (let _ of solver.solve(true)) {
			}
			expect(solver.solutions.length).toBe(1);
		}
	});
});

describe('Test steps distribution', () => {
	it('Checks difficulty distribution in generated 5x5 wraps', () => {
		const grid = new HexaGrid(5, 5, true);
		const counts = new Map();
		const examples = new Map();
		for (let i = 0; i < 1000; i++) {
			const gen = new Generator(grid);
			const tiles = gen.generate();
			const solver = new Solver(tiles, grid);
			let steps = 0;
			for (let _ of solver.solve(true)) {
				steps += 1;
			}
			counts.set(steps, (counts.get(steps) || 0) + 1);
			if (!examples.has(steps)) {
				examples.set(steps, tiles);
			}
		}
		const fs = require('fs');
		const filename = `generator_stats/${grid.width}x${grid.height}${
			grid.wrap ? 'wrap' : ''
		}_steps.json`;
		const data = {
			steps: [...counts.entries()].sort((a, b) => a[0] - b[0]),
			examples: [...examples.entries()].sort((a, b) => a[0] - b[0])
		};
		fs.writeFile(filename, JSON.stringify(data, undefined, '\t'), function (err) {
			if (err) {
				console.log(err);
			} else {
				console.log('file saved');
			}
		});
	});

	// it('Checks difficulty distribution in generated 5x5 wraps', () => {
	// 	for (let width of [3, 5, 7, 10]) {
	// 		const counts = new Map();
	// 		for (let i = 0; i < 1000; i++) {
	// 			const grid = new HexaGrid(width, width, false);
	// 			const gen = new Generator(grid);
	// 			const tiles = gen.generate();
	// 			const solver = new Solver(tiles, grid);
	// 			let steps = 0;
	// 			for (let _ of solver.solve()) {
	// 				steps += 1;
	// 			}
	// 			counts.set(steps, (counts.get(steps) || 0) + 1);
	// 		}

	// 		console.log({ width, count: counts.get(width * width) });
	// 	}
	// });
});
