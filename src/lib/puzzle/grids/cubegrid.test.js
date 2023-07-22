import { describe, expect, it } from 'vitest';
import { CubeGrid } from './cubegrid';

describe('Initializing with different field shapes', () => {
	it('Uses hexagonal shape if no tiles are provided', () => {
		const grid = new CubeGrid(5, 5, false);
		expect([...grid.hexagrid.emptyCells]).toEqual(expect.arrayContaining([0, 6]));
		expect([...grid.emptyCells]).toEqual(expect.arrayContaining([0, 1, 2, 18, 19, 20]));
	});

	it('Has no empty tiles if wrap', () => {
		const grid = new CubeGrid(5, 5, true);
		expect(grid.hexagrid.emptyCells.size).toBe(0);
		expect(grid.emptyCells.size).toBe(0);
	});

	it('Sets empty tiles according to provided tiles array', () => {
		const tiles = Array(27).fill(1);
		tiles[0] = 0;
		const grid = new CubeGrid(5, 5, false, tiles);
		expect([...grid.hexagrid.emptyCells]).toEqual(expect.arrayContaining([]));
		expect([...grid.emptyCells]).toEqual(expect.arrayContaining([0]));
	});

	it('Sets hexagons empty if corresponding cubes are empty', () => {
		const tiles = Array(27).fill(1);
		for (let i = 0; i < 7; i++) {
			tiles[i] = 0;
		}
		const grid = new CubeGrid(5, 5, false, tiles);
		expect([...grid.hexagrid.emptyCells]).toEqual(expect.arrayContaining([0, 1]));
		expect([...grid.emptyCells]).toEqual(expect.arrayContaining([0, 1, 2, 3, 4, 5, 6]));
	});
});

describe('Test making a cell empty', () => {
	const grid = new CubeGrid(5, 5, false);
	grid.makeEmpty(14);

	it('Reports an empty neighbour', () => {
		const { neighbour, empty } = grid.find_neighbour(9, 8);
		expect(neighbour).toBe(14);
		expect(empty).toBe(true);
	});

	it('Reports another empty neighbour', () => {
		const { neighbour, empty } = grid.find_neighbour(12, 2);
		expect(neighbour).toBe(14);
		expect(empty).toBe(true);
	});

	it('Reports a non-empty neighbour', () => {
		const { neighbour, empty } = grid.find_neighbour(9, 4);
		expect(neighbour).toBe(22);
		expect(empty).toBe(false);
	});

	it('Reports a non-neighbour when going outside the grid', () => {
		const { neighbour, empty } = grid.find_neighbour(18, 4);
		expect(neighbour).toBe(-1);
		expect(empty).toBe(true);
	});

	it('Reports a non-neighbour when going outside the grid', () => {
		const { neighbour, empty } = grid.find_neighbour(4, 4);
		expect(neighbour).toBe(-1);
		expect(empty).toBe(true);
	});

	it('Reports a non-neighbour when going outside the grid', () => {
		const { neighbour, empty } = grid.find_neighbour(4, 8);
		expect(neighbour).toBe(-1);
		expect(empty).toBe(true);
	});

	it('Reports a non-neighbour when going outside the grid', () => {
		const { neighbour, empty } = grid.find_neighbour(11, 4);
		expect(neighbour).toBe(-1);
		expect(empty).toBe(true);
	});

	it('Reports a non-neighbour when going outside the grid', () => {
		const { neighbour, empty } = grid.find_neighbour(24, 8);
		expect(neighbour).toBe(-1);
		expect(empty).toBe(true);
	});

	it('Does not return empty face in visible tiles', () => {
		const visible = grid
			.getVisibleTiles({ xmin: 0, ymin: 0, width: 5, height: 5 })
			.map((v) => v.index);
		expect(visible).not.toContain(14);
	});
});
