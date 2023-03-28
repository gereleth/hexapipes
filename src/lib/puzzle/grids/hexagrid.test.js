import { describe, expect, it } from 'vitest';
import { HexaGrid } from './hexagrid';

describe('Test making a cell empty', () => {
	const grid = new HexaGrid(3, 3, false);
	grid.makeEmpty(4);

	it('Reports an empty neighbour', () => {
		const { neighbour, empty } = grid.find_neighbour(3, 1);
		expect(neighbour).toBe(4);
		expect(empty).toBe(true);
	});

	it('Reports an non-empty neighbour', () => {
		const { neighbour, empty } = grid.find_neighbour(3, 2);
		expect(neighbour).toBe(1);
		expect(empty).toBe(false);
	});

	it('Reports an non-neighbour when going outside the grid', () => {
		const { neighbour, empty } = grid.find_neighbour(3, 8);
		expect(neighbour).toBe(-1);
		expect(empty).toBe(true);
	});
});
