import { describe, expect, it } from 'vitest';
import { TrihexaGrid } from './trihexagrid';

describe('Test find neighbour', () => {
	it('Find neighbours in a regular puzzle', () => {
		// 7x7 is 4x4 in (hexagon + 2 triangles) units
		const grid = new TrihexaGrid(7, 7, false);
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

	it('Find neighbours in an even-sized wrap puzzle', () => {
		const grid = new TrihexaGrid(7, 7, true);
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

	it('Find neighbours in an odd-sized wrap puzzle', () => {
		const grid = new TrihexaGrid(5, 5, true);
		const expected = new Map([
			// up triangles
			[11, [9, 15, 18]], // left edge
			[8, [0, 6, 15]], // right edge
			[20, [21, 18, 3]], // bottom edge
			// hexagons
			[0, [1, 26, 7, 8, 10, 2]],
			[6, [7, 23, 4, 5, 16, 8]],
			[15, [10, 8, 16, 17, 25, 11]],
			[18, [19, 11, 25, 26, 1, 20]],
			[24, [25, 17, 22, 23, 7, 26]],
			// down triangles
			[1, [3, 18, 0]], // top edge
			[10, [9, 0, 15]], // left edge
			[7, [0, 24, 6]] // top-right corner
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
