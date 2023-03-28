import { describe, expect, it } from 'vitest';
import { RegularPolygonTile } from './polygonutils';

describe('Test square tile rotations', () => {
	const square = new RegularPolygonTile(4, 0, 0.5);

	it('Rotate an end tile counter-clockwise', () => {
		let rotated = 1;
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(2);
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(4);
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(8);
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(1);
	});

	it('Rotate an end tile clockwise', () => {
		let rotated = 1;
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(8);
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(4);
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(2);
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(1);
	});

	it('Rotate an end tile in multiples', () => {
		let rotated = 1;
		expect(square.rotate(rotated, 1)).toBe(8);
		expect(square.rotate(rotated, 2)).toBe(4);
		expect(square.rotate(rotated, 3)).toBe(2);
		expect(square.rotate(rotated, 4)).toBe(1);
		expect(square.rotate(rotated, -1)).toBe(2);
		expect(square.rotate(rotated, -2)).toBe(4);
		expect(square.rotate(rotated, -3)).toBe(8);
		expect(square.rotate(rotated, -4)).toBe(1);
	});

	it('Rotate a straight tile in multiples', () => {
		let rotated = 5;
		expect(square.rotate(rotated, 1)).toBe(10);
		expect(square.rotate(rotated, 2)).toBe(5);
		expect(square.rotate(rotated, 3)).toBe(10);
		expect(square.rotate(rotated, 4)).toBe(5);
		expect(square.rotate(rotated, -1)).toBe(10);
		expect(square.rotate(rotated, -2)).toBe(5);
		expect(square.rotate(rotated, -3)).toBe(10);
		expect(square.rotate(rotated, -4)).toBe(5);
	});
});

describe('Test octagrid square tile rotations', () => {
	const square = new RegularPolygonTile(4, Math.PI / 4, 0.5, [2, 8, 32, 128]);

	it('Rotate an end tile counter-clockwise', () => {
		let rotated = 2;
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(8);
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(32);
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(128);
		rotated = square.rotate(rotated, -1);
		expect(rotated).toBe(2);
	});

	it('Rotate an end tile clockwise', () => {
		let rotated = 2;
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(128);
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(32);
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(8);
		rotated = square.rotate(rotated, 1);
		expect(rotated).toBe(2);
	});

	it('Rotate an end tile in multiples', () => {
		let rotated = 2;
		expect(square.rotate(rotated, 1)).toBe(128);
		expect(square.rotate(rotated, 2)).toBe(32);
		expect(square.rotate(rotated, 3)).toBe(8);
		expect(square.rotate(rotated, 4)).toBe(2);
		expect(square.rotate(rotated, -1)).toBe(8);
		expect(square.rotate(rotated, -2)).toBe(32);
		expect(square.rotate(rotated, -3)).toBe(128);
		expect(square.rotate(rotated, -4)).toBe(2);
	});

	it('Rotate a straight tile in multiples', () => {
		let rotated = 34;
		expect(square.rotate(rotated, 1)).toBe(136);
		expect(square.rotate(rotated, 2)).toBe(34);
		expect(square.rotate(rotated, 3)).toBe(136);
		expect(square.rotate(rotated, 4)).toBe(34);
		expect(square.rotate(rotated, -1)).toBe(136);
		expect(square.rotate(rotated, -2)).toBe(34);
		expect(square.rotate(rotated, -3)).toBe(136);
		expect(square.rotate(rotated, -4)).toBe(34);
	});
});

describe('Test square tile get directions', () => {
	const square = new RegularPolygonTile(4, 0, 0.5);

	it('Straight tile', () => {
		const tile = 5;
		expect(square.get_directions(tile, 0)).toEqual(expect.arrayContaining([1, 4]));
		expect(square.get_directions(tile, -1)).toEqual(expect.arrayContaining([2, 8]));
		expect(square.get_directions(tile, -2)).toEqual(expect.arrayContaining([1, 4]));
		expect(square.get_directions(tile, 1)).toEqual(expect.arrayContaining([2, 8]));
		expect(square.get_directions(tile, 2)).toEqual(expect.arrayContaining([1, 4]));
	});

	it('Turn tile', () => {
		const tile = 3;
		expect(square.get_directions(tile, 0)).toEqual(expect.arrayContaining([1, 2]));
		expect(square.get_directions(tile, -1)).toEqual(expect.arrayContaining([2, 4]));
		expect(square.get_directions(tile, -2)).toEqual(expect.arrayContaining([4, 8]));
		expect(square.get_directions(tile, 1)).toEqual(expect.arrayContaining([8, 1]));
		expect(square.get_directions(tile, 2)).toEqual(expect.arrayContaining([4, 8]));
	});
});

describe('Test octagrid square tile get directions', () => {
	const square = new RegularPolygonTile(4, 0, 0.5, [2, 8, 32, 128]);

	it('Straight tile', () => {
		const tile = 34;
		expect(square.get_directions(tile, 0)).toEqual(expect.arrayContaining([2, 32]));
		expect(square.get_directions(tile, -1)).toEqual(expect.arrayContaining([8, 128]));
		expect(square.get_directions(tile, -2)).toEqual(expect.arrayContaining([2, 32]));
		expect(square.get_directions(tile, 1)).toEqual(expect.arrayContaining([8, 128]));
		expect(square.get_directions(tile, 2)).toEqual(expect.arrayContaining([2, 32]));
	});

	it('Turn tile', () => {
		const tile = 10;
		expect(square.get_directions(tile, 0)).toEqual(expect.arrayContaining([2, 8]));
		expect(square.get_directions(tile, -1)).toEqual(expect.arrayContaining([8, 32]));
		expect(square.get_directions(tile, -2)).toEqual(expect.arrayContaining([32, 128]));
		expect(square.get_directions(tile, 1)).toEqual(expect.arrayContaining([128, 2]));
		expect(square.get_directions(tile, 2)).toEqual(expect.arrayContaining([32, 128]));
	});
});
