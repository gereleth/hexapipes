import { describe, expect, it } from 'vitest';
import { HexaGrid } from './hexagrid';

describe('Test tile rotations', () => {
	const grid = new HexaGrid(3, 3, false);

	it('Rotate an end tile counter-clockwise', () => {
		let rotated = 1;
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(2);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(4);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(8);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(16);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(32);
		rotated = grid.rotate(rotated, -1);
		expect(rotated).toBe(1);
	});

	it('Rotate an end tile clockwise', () => {
		let rotated = 1;
		rotated = grid.rotate(rotated, 1);
		expect(rotated).toBe(32);
		rotated = grid.rotate(rotated, 1);
		expect(rotated).toBe(16);
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
		expect(grid.rotate(rotated, 1)).toBe(32);
		expect(grid.rotate(rotated, 2)).toBe(16);
		expect(grid.rotate(rotated, 3)).toBe(8);
		expect(grid.rotate(rotated, 4)).toBe(4);
		expect(grid.rotate(rotated, 5)).toBe(2);
		expect(grid.rotate(rotated, 6)).toBe(1);
		expect(grid.rotate(rotated, -5)).toBe(32);
		expect(grid.rotate(rotated, -4)).toBe(16);
		expect(grid.rotate(rotated, -3)).toBe(8);
		expect(grid.rotate(rotated, -2)).toBe(4);
		expect(grid.rotate(rotated, -1)).toBe(2);
		expect(grid.rotate(rotated, -6)).toBe(1);
	});

	it('Rotate a straight tile in multiples', () => {
		let rotated = 9;
		expect(grid.rotate(rotated, 1)).toBe(36);
		expect(grid.rotate(rotated, 2)).toBe(18);
		expect(grid.rotate(rotated, 3)).toBe(9);
		expect(grid.rotate(rotated, 4)).toBe(36);
		expect(grid.rotate(rotated, 5)).toBe(18);
		expect(grid.rotate(rotated, 6)).toBe(9);
		expect(grid.rotate(rotated, -5)).toBe(36);
		expect(grid.rotate(rotated, -4)).toBe(18);
		expect(grid.rotate(rotated, -3)).toBe(9);
		expect(grid.rotate(rotated, -2)).toBe(36);
		expect(grid.rotate(rotated, -1)).toBe(18);
		expect(grid.rotate(rotated, -6)).toBe(9);
	});
});
