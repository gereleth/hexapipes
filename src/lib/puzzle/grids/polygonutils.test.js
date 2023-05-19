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

describe('Test tile rotations', () => {
	const hexagon = new RegularPolygonTile(6, 0, 0.5);

	it('Rotate an end tile counter-clockwise', () => {
		let rotated = 1;
		rotated = hexagon.rotate(rotated, -1);
		expect(rotated).toBe(2);
		rotated = hexagon.rotate(rotated, -1);
		expect(rotated).toBe(4);
		rotated = hexagon.rotate(rotated, -1);
		expect(rotated).toBe(8);
		rotated = hexagon.rotate(rotated, -1);
		expect(rotated).toBe(16);
		rotated = hexagon.rotate(rotated, -1);
		expect(rotated).toBe(32);
		rotated = hexagon.rotate(rotated, -1);
		expect(rotated).toBe(1);
	});

	it('Rotate an end tile clockwise', () => {
		let rotated = 1;
		rotated = hexagon.rotate(rotated, 1);
		expect(rotated).toBe(32);
		rotated = hexagon.rotate(rotated, 1);
		expect(rotated).toBe(16);
		rotated = hexagon.rotate(rotated, 1);
		expect(rotated).toBe(8);
		rotated = hexagon.rotate(rotated, 1);
		expect(rotated).toBe(4);
		rotated = hexagon.rotate(rotated, 1);
		expect(rotated).toBe(2);
		rotated = hexagon.rotate(rotated, 1);
		expect(rotated).toBe(1);
	});

	it('Rotate an end tile in multiples', () => {
		let rotated = 1;
		expect(hexagon.rotate(rotated, 1)).toBe(32);
		expect(hexagon.rotate(rotated, 2)).toBe(16);
		expect(hexagon.rotate(rotated, 3)).toBe(8);
		expect(hexagon.rotate(rotated, 4)).toBe(4);
		expect(hexagon.rotate(rotated, 5)).toBe(2);
		expect(hexagon.rotate(rotated, 6)).toBe(1);
		expect(hexagon.rotate(rotated, -5)).toBe(32);
		expect(hexagon.rotate(rotated, -4)).toBe(16);
		expect(hexagon.rotate(rotated, -3)).toBe(8);
		expect(hexagon.rotate(rotated, -2)).toBe(4);
		expect(hexagon.rotate(rotated, -1)).toBe(2);
		expect(hexagon.rotate(rotated, -6)).toBe(1);
	});

	it('Rotate a straight tile in multiples', () => {
		let rotated = 9;
		expect(hexagon.rotate(rotated, 1)).toBe(36);
		expect(hexagon.rotate(rotated, 2)).toBe(18);
		expect(hexagon.rotate(rotated, 3)).toBe(9);
		expect(hexagon.rotate(rotated, 4)).toBe(36);
		expect(hexagon.rotate(rotated, 5)).toBe(18);
		expect(hexagon.rotate(rotated, 6)).toBe(9);
		expect(hexagon.rotate(rotated, -5)).toBe(36);
		expect(hexagon.rotate(rotated, -4)).toBe(18);
		expect(hexagon.rotate(rotated, -3)).toBe(9);
		expect(hexagon.rotate(rotated, -2)).toBe(36);
		expect(hexagon.rotate(rotated, -1)).toBe(18);
		expect(hexagon.rotate(rotated, -6)).toBe(9);
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

describe('Test square tile types', () => {
	const square = new RegularPolygonTile(4, 0, 0.5);

	it('Has correct tiles count', () => {
		expect(square.tileTypes.size).toBe(15);
	});

	it('Has correct types count', () => {
		const types = new Set([...square.tileTypes.values()].map((x) => x.str));
		expect(types.size).toBe(5);
	});

	it('Deadend tile', () => {
		for (let tile of [1, 2, 4, 8]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('1000');
			expect(type?.isDeadend).toBe(true);
			expect(type?.isFullyConnected).toBe(false);
			expect(type?.isStraight).toBe(false);
			expect(type?.hasNoAdjacentConnections).toBe(true);
			expect(type?.hasNoAdjacentWalls).toBe(false);
			expect(type?.hasOnlyAdjacentConnections).toBe(false);
		}
	});

	it('Turn tile', () => {
		for (let tile of [3, 6, 9, 12]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('1100');
			expect(type?.isDeadend).toBe(false);
			expect(type?.isFullyConnected).toBe(false);
			expect(type?.isStraight).toBe(false);
			expect(type?.hasNoAdjacentConnections).toBe(false);
			expect(type?.hasNoAdjacentWalls).toBe(false);
			expect(type?.hasOnlyAdjacentConnections).toBe(true);
		}
	});

	it('Straight tile', () => {
		for (let tile of [5, 10]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('1010');
			expect(type?.isDeadend).toBe(false);
			expect(type?.isFullyConnected).toBe(false);
			expect(type?.isStraight).toBe(true);
			expect(type?.hasNoAdjacentConnections).toBe(true);
			expect(type?.hasNoAdjacentWalls).toBe(true);
			expect(type?.hasOnlyAdjacentConnections).toBe(false);
		}
	});

	it('T tile', () => {
		for (let tile of [14, 13, 11, 7]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('1110');
			expect(type?.isDeadend).toBe(false);
			expect(type?.isFullyConnected).toBe(false);
			expect(type?.isStraight).toBe(false);
			expect(type?.hasNoAdjacentConnections).toBe(false);
			expect(type?.hasNoAdjacentWalls).toBe(true);
			expect(type?.hasOnlyAdjacentConnections).toBe(true);
		}
	});

	it('+ tile', () => {
		for (let tile of [15]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('1111');
			expect(type?.isDeadend).toBe(false);
			expect(type?.isFullyConnected).toBe(true);
			expect(type?.isStraight).toBe(false);
			expect(type?.hasNoAdjacentConnections).toBe(false);
			expect(type?.hasNoAdjacentWalls).toBe(true);
			expect(type?.hasOnlyAdjacentConnections).toBe(true);
		}
	});
});

describe('Test triangle tile types', () => {
	const square = new RegularPolygonTile(3, 0, 0.5, [1, 4, 8]);

	it('Has correct tiles count', () => {
		expect(square.tileTypes.size).toBe(7);
	});

	it('Has correct types count', () => {
		const types = new Set([...square.tileTypes.values()].map((x) => x.str));
		expect(types.size).toBe(3);
	});

	it('Deadend tile', () => {
		for (let tile of [1, 4, 8]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('100');
			expect(type?.isDeadend).toBe(true);
			expect(type?.isFullyConnected).toBe(false);
			expect(type?.isStraight).toBe(false);
			expect(type?.hasNoAdjacentConnections).toBe(true);
			expect(type?.hasNoAdjacentWalls).toBe(false);
			expect(type?.hasOnlyAdjacentConnections).toBe(false);
		}
	});

	it('Turn tile', () => {
		for (let tile of [5, 9, 12]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('110');
			expect(type?.isDeadend).toBe(false);
			expect(type?.isFullyConnected).toBe(false);
			expect(type?.isStraight).toBe(false);
			expect(type?.hasNoAdjacentConnections).toBe(false);
			expect(type?.hasNoAdjacentWalls).toBe(true);
			expect(type?.hasOnlyAdjacentConnections).toBe(true);
		}
	});

	it('Fully connected tile', () => {
		for (let tile of [13]) {
			const type = square.tileTypes.get(tile);
			expect(type).toBeDefined();
			expect(type?.str).toBe('111');
			expect(type?.isDeadend).toBe(false);
			expect(type?.isFullyConnected).toBe(true);
			expect(type?.isStraight).toBe(false);
			expect(type?.hasNoAdjacentConnections).toBe(false);
			expect(type?.hasNoAdjacentWalls).toBe(true);
			expect(type?.hasOnlyAdjacentConnections).toBe(true);
		}
	});
});
