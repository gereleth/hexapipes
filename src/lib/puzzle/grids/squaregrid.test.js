import { describe, expect, it } from 'vitest';
import { SquareGrid } from './squaregrid';

describe('Test tile rotations', () => {
	const grid = new SquareGrid(3, 3, false);

	it('Rotate an end tile counter-clockwise', () => {
		let rotated = 1;
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(2);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(4);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(8);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(1);
	});

	it('Rotate an end tile clockwise', () => {
		let rotated = 1;
		rotated = grid.rotate(rotated, 1);
		expect(rotated).toBe(8);
		rotated = grid.rotate(rotated, 1);
		expect(rotated).toBe(4);
		rotated = grid.rotate(rotated, 1);
		expect(rotated).toBe(2);
		rotated = grid.rotate(rotated, 1);
		expect(rotated).toBe(1);
	});

	it('Rotate an end tile in multiples', () => {
		let rotated = 1;
		expect(grid.rotate(rotated, 1)).toBe(8);
		expect(grid.rotate(rotated, 2)).toBe(4);
		expect(grid.rotate(rotated, 3)).toBe(2);
		expect(grid.rotate(rotated, 4)).toBe(1);
		expect(grid.rotate(rotated, -1)).toBe(2);
		expect(grid.rotate(rotated, -2)).toBe(4);
		expect(grid.rotate(rotated, -3)).toBe(8);
		expect(grid.rotate(rotated, -4)).toBe(1);
	});

	it('Rotate a straight tile in multiples', () => {
		let rotated = 5;
		expect(grid.rotate(rotated, 1)).toBe(10);
		expect(grid.rotate(rotated, 2)).toBe(5);
		expect(grid.rotate(rotated, 3)).toBe(10);
		expect(grid.rotate(rotated, 4)).toBe(5);
		expect(grid.rotate(rotated, -1)).toBe(10);
		expect(grid.rotate(rotated, -2)).toBe(5);
		expect(grid.rotate(rotated, -3)).toBe(10);
		expect(grid.rotate(rotated, -4)).toBe(5);
	});
});

describe('Test get directions', () => {
	const grid = new SquareGrid(3, 3, false);

	it('Deadend tile', () => {
		let tile = 1;
		expect(grid.getDirections(tile, 0)).toEqual(expect.arrayContaining([1]));
		expect(grid.getDirections(tile, 1)).toEqual(expect.arrayContaining([8]));
		expect(grid.getDirections(tile, 2)).toEqual(expect.arrayContaining([4]));
		expect(grid.getDirections(tile, 3)).toEqual(expect.arrayContaining([2]));
		expect(grid.getDirections(tile, 4)).toEqual(expect.arrayContaining([1]));
	});

	it('Straight tile', () => {
		let tile = 5;
		expect(grid.getDirections(tile, 0)).toEqual(expect.arrayContaining([1, 4]));
		expect(grid.getDirections(tile, 1)).toEqual(expect.arrayContaining([2, 8]));
		expect(grid.getDirections(tile, 2)).toEqual(expect.arrayContaining([1, 4]));
		expect(grid.getDirections(tile, 3)).toEqual(expect.arrayContaining([2, 8]));
		expect(grid.getDirections(tile, 4)).toEqual(expect.arrayContaining([1, 4]));
	});

	it('Turn tile', () => {
		let tile = 3;
		expect(grid.getDirections(tile, 0)).toEqual(expect.arrayContaining([1, 2]));
		expect(grid.getDirections(tile, -1)).toEqual(expect.arrayContaining([2, 4]));
		expect(grid.getDirections(tile, -2)).toEqual(expect.arrayContaining([4, 8]));
		expect(grid.getDirections(tile, -3)).toEqual(expect.arrayContaining([1, 8]));
		expect(grid.getDirections(tile, -4)).toEqual(expect.arrayContaining([1, 2]));
	});

	it('T tile', () => {
		let tile = 7;
		expect(grid.getDirections(tile, 0)).toEqual(expect.arrayContaining([1, 2, 4]));
		expect(grid.getDirections(tile, -1)).toEqual(expect.arrayContaining([2, 4, 8]));
		expect(grid.getDirections(tile, -2)).toEqual(expect.arrayContaining([4, 8, 1]));
		expect(grid.getDirections(tile, -3)).toEqual(expect.arrayContaining([1, 8, 2]));
		expect(grid.getDirections(tile, -4)).toEqual(expect.arrayContaining([1, 2, 4]));
	});
});

describe('Test find neighbour', () => {
	it('Find neighbours in a regular puzzle', () => {
		const grid = new SquareGrid(4, 3, false);
		const expected = new Map([
			[0, [1, -1, -1, 4]],
			[1, [2, -1, 0, 5]],
			[3, [-1, -1, 2, 7]],
			[6, [7, 2, 5, 10]],
			[7, [-1, 3, 6, 11]],
			[11, [-1, 7, 10, -1]],
			[10, [11, 6, 9, -1]],
			[8, [9, 4, -1, -1]],
			[4, [5, 0, -1, 8]]
		]);
		for (let [index, neighbours] of expected.entries()) {
			const polygon = grid.polygon_at(index);
			for (let i = 0; i < polygon.directions.length; i++) {
				const neighbourExpected = neighbours[i];
				const direction = polygon.directions[i];
				const { neighbour, empty } = grid.find_neighbour(index, direction);
				expect(empty).toBe(neighbourExpected === -1);
				expect(neighbour).toBe(neighbourExpected);
			}
		}
	});

	it('Find neighbours in a wrap puzzle', () => {
		const grid = new SquareGrid(4, 3, true);
		const expected = new Map([
			[0, [1, 8, 3, 4]],
			[1, [2, 9, 0, 5]],
			[3, [0, 11, 2, 7]],
			[6, [7, 2, 5, 10]],
			[7, [4, 3, 6, 11]],
			[11, [8, 7, 10, 3]],
			[10, [11, 6, 9, 2]],
			[8, [9, 4, 11, 0]],
			[4, [5, 0, 7, 8]]
		]);
		for (let [index, neighbours] of expected.entries()) {
			const polygon = grid.polygon_at(index);
			for (let i = 0; i < polygon.directions.length; i++) {
				const neighbourExpected = neighbours[i];
				const direction = polygon.directions[i];
				const { neighbour, empty } = grid.find_neighbour(index, direction);
				expect(empty).toBe(false);
				expect(neighbour).toBe(neighbourExpected);
			}
		}
	});
});

// describe('Test making a cell empty', () => {
// 	const grid = new HexaGrid(3, 3, false);
// 	grid.makeEmpty(4);

// 	it('Reports an empty neighbour', () => {
// 		const { neighbour, empty } = grid.find_neighbour(3, 1);
// 		expect(neighbour).toBe(4);
// 		expect(empty).toBe(true);
// 	});

// 	it('Reports an non-empty neighbour', () => {
// 		const { neighbour, empty } = grid.find_neighbour(3, 2);
// 		expect(neighbour).toBe(1);
// 		expect(empty).toBe(false);
// 	});

// 	it('Reports an non-neighbour when going outside the grid', () => {
// 		const { neighbour, empty } = grid.find_neighbour(3, 8);
// 		expect(neighbour).toBe(-1);
// 		expect(empty).toBe(true);
// 	});
// });
