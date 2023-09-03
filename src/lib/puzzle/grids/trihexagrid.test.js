import { describe, expect, it } from 'vitest';
import { TrihexaGrid } from './trihexagrid';

describe('Test find neighbour', () => {
	it('Find neighbours in a regular puzzle', () => {
		const grid = new TrihexaGrid(7, 7, false);
		expect(grid.w).toBe(4);
		expect(grid.h).toBe(4);
		const expected = new Map([
			// up triangle odd row
			[2, [3, 0, 12]],
			// up triangle even row
			[17, [15, 12, 27]],
			// up triangle left edge
			[14, [12, -1, 24]],
			// up triangle right edge
			[11, [-1, 9, 21]],
			// hexagons
			[15, [19, 5, 16, 17, 28, 20]],
			[3, [4, -1, 1, 2, 16, 5]],
			// down triangle
			[16, [15, 3, 12]],
			[4, [6, -1, 3]]
		]);
		for (let [index, neighbours] of expected.entries()) {
			const polygon = grid.polygon_at(index);
			for (let i = 0; i < polygon.directions.length; i++) {
				const neighbourExpected = neighbours[i];
				const direction = polygon.directions[i];
				// console.log({ index, direction });
				const { neighbour, empty } = grid.find_neighbour(index, direction);
				const msg = `Index ${index}, direction ${direction} => neighbour ${neighbour} empty ${empty}`;
				expect(empty, msg).toBe(neighbourExpected === -1 || grid.emptyCells.has(neighbour));
				expect(neighbour, msg).toBe(neighbourExpected);
			}
		}
	});

	it('Find neighbours in a wrap puzzle', () => {
		const grid = new TrihexaGrid(7, 7, true);
		expect(grid.w).toBe(4);
		expect(grid.h).toBe(4);
		const expected = new Map([
			// up triangle left edge
			[14, [12, 21, 24]],
			// up triangle right edge
			[11, [0, 9, 21]],
			// hexagons
			[3, [4, 41, 1, 2, 16, 5]],
			// down triangle
			[4, [6, 39, 3]]
		]);
		for (let [index, neighbours] of expected.entries()) {
			const polygon = grid.polygon_at(index);
			for (let i = 0; i < polygon.directions.length; i++) {
				const neighbourExpected = neighbours[i];
				const direction = polygon.directions[i];
				// console.log({ index, direction });
				const { neighbour, empty } = grid.find_neighbour(index, direction);
				const msg = `Index ${index}, direction ${direction} => neighbour ${neighbour} empty ${empty}`;
				expect(empty, msg).toBe(neighbourExpected === -1 || grid.emptyCells.has(neighbour));
				expect(neighbour, msg).toBe(neighbourExpected);
			}
		}
	});
});
