import { describe, expect, it } from 'vitest';
import { SnubSquareGrid } from './snubsquaregrid';

describe('Test find neighbour', () => {
	it('Find neighbours in a regular puzzle', () => {
		const grid = new SnubSquareGrid(7, 7, false);
		const expected = new Map([
			// square 0
			[24, [25, 11, 20, 28]],
			[25, [26, 9, 24]],
			[26, [30, 25, 27]],
			[27, [35, 26, 28, 43]],
			[28, [27, 24, 29]],
			[29, [28, 21, 42]]
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
