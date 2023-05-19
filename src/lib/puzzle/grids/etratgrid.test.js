import { describe, expect, it } from 'vitest';
import { EtratGrid } from './etratgrid';

describe('Test find neighbour', () => {
	it('Find neighbours in a regular puzzle', () => {
		const grid = new EtratGrid(3, 6, false);
		const expected = new Map([
			// up triangle
			[12, [8, 5, 13]],
			// square
			[13, [16, 12, 10, 14]],
			// down triangle
			[14, [24, 13, 21]]
		]);
		for (let [index, neighbours] of expected.entries()) {
			const polygon = grid.polygon_at(index);
			for (let i = 0; i < polygon.directions.length; i++) {
				const neighbourExpected = neighbours[i];
				const direction = polygon.directions[i];
				const { neighbour, empty } = grid.find_neighbour(index, direction);
				const msg = `Index ${index}, direction ${direction} => neighbour ${neighbour} empty ${empty}`;
				expect(empty, msg).toBe(neighbourExpected === -1 || grid.emptyCells.has(neighbour));
				expect(neighbour, msg).toBe(neighbourExpected);
			}
		}
	});
});

describe('Test rotate triangular tile', () => {
	it('Down triangle, angle tile ', () => {
		const grid = new EtratGrid(3, 6, true);
		const tile = 3;
		const index = 2;
		const expected = [3, 5, 6, 3, 5];
		let rotations = 0;
		for (let orientation of expected) {
			const result = grid.rotate(tile, rotations, index);
			expect(result).toEqual(orientation);
			rotations += 1;
		}
	});

	it('Up triangle, angle tile ', () => {
		const grid = new EtratGrid(3, 3, true);
		const tile = 5;
		const index = 0;
		const expected = [5, 9, 12, 5, 9];
		let rotations = 0;
		for (let orientation of expected) {
			const result = grid.rotate(tile, rotations, index);
			expect(result).toEqual(orientation);
			rotations += 1;
		}
	});
});
