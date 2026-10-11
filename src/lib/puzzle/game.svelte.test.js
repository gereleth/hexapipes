import { describe, expect, it } from 'vitest';
import { HexaGrid } from './grids/hexagrid';
import { PipesGame } from './game.svelte';

describe('Test initialize board', () => {
	const grid = new HexaGrid(3, 3, false);
	const tiles = [1, 3, 3, 11, 11, 5, 1, 1, 1];

	/** @type {import('./game.svelte').EdgeMark[]} */
	const edgeMarks = ['empty', 'empty', 'empty'];
	const progressItem = {
		color: 'white',
		rotation: 0,
		edgeMarks: edgeMarks,
		locked: false
	};

	it('Initializes without progress, no loops', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.initializeBoard();
		expect(game.initialized, 'sets initialized flag').toBe(true);
		game.tileStates.forEach((data, index) => {
			expect(data.rotations).toBe(0);
			expect(data.color).toBe('white');
			expect(data.locked).toBe(false);
			expect(data.tile).toBe(tiles[index]);
			expect(data.isPartOfLoop).toBe(false);
		});
		game.components.forEach((component, index) => {
			if (index === 3 || index === 4) {
				expect([...component.tiles]).toEqual(expect.arrayContaining([3, 4]));
			} else {
				expect([...component.tiles]).toEqual(expect.arrayContaining([index]));
			}
		});
	});

	it('Initializes without progress, with a loop', () => {
		let myTiles = [...tiles];
		myTiles[1] = 48;
		myTiles[4] = 44;
		const game = new PipesGame(grid, myTiles, undefined);
		game.initializeBoard();
		expect(game.initialized, 'sets initialized flag').toBe(true);
		game.tileStates.forEach((data, index) => {
			expect(data.rotations).toBe(0);
			expect(data.color).toBe('white');
			expect(data.locked).toBe(false);
			expect(data.tile).toBe(myTiles[index]);
			expect(data.isPartOfLoop).toBe([1, 3, 4].some((x) => x === index));
		});
		game.components.forEach((component, index) => {
			if ([1, 3, 4].some((x) => x === index)) {
				expect([...component.tiles]).toEqual(expect.arrayContaining([1, 3, 4]));
			} else {
				expect([...component.tiles]).toEqual(expect.arrayContaining([index]));
			}
		});
	});

	it('Initializes from saved progress, no loops', () => {
		const progress = {
			tiles: [
				Object.assign({}, progressItem, { rotations: 1, color: 'red', locked: true }),
				Object.assign({}, progressItem, { rotations: 2, color: 'red', locked: true }),
				Object.assign({}, progressItem, { rotations: -1, color: 'green' }),
				Object.assign({}, progressItem, { rotations: -1, color: 'red', locked: true }),
				Object.assign({}, progressItem, { rotations: -1, color: 'red' }),
				Object.assign({}, progressItem, { rotations: -2, color: 'blue' }),
				Object.assign({}, progressItem, { rotations: -1, color: 'red', locked: true }),
				Object.assign({}, progressItem, { rotations: -1, color: 'red' }),
				Object.assign({}, progressItem, { rotations: -1, color: 'blue' })
			]
		};
		const game = new PipesGame(grid, tiles, progress);
		game.initializeBoard();
		expect(game.initialized, 'sets initialized flag').toBe(true);
		game.tileStates.forEach((data, index) => {
			expect(data.rotations).toBe(progress.tiles[index].rotations);
			expect(data.color).toBe(progress.tiles[index].color);
			expect(data.locked).toBe(progress.tiles[index].locked);
			expect(data.tile).toBe(tiles[index]);
			expect(data.isPartOfLoop).toBe(false);
		});
		game.components.forEach((component, index) => {
			if ([5, 8].some((x) => x === index)) {
				expect([...component.tiles]).toEqual(expect.arrayContaining([5, 8]));
			} else if (index === 2) {
				expect([...component.tiles]).toEqual(expect.arrayContaining([2]));
			} else {
				expect([...component.tiles]).toEqual(expect.arrayContaining([0, 1, 3, 4, 6, 7]));
			}
		});
	});

	it('Initializes from saved progress, with a loop', () => {
		const progress = {
			tiles: [
				Object.assign({}, progressItem, { rotations: 0, color: '0' }),
				Object.assign({}, progressItem, { rotations: 2, color: 'red' }),
				Object.assign({}, progressItem, { rotations: 0, color: '2' }),
				Object.assign({}, progressItem, { rotations: 0, color: 'red' }),
				Object.assign({}, progressItem, { rotations: -2, color: 'red' }),
				Object.assign({}, progressItem, { rotations: 0, color: '5' }),
				Object.assign({}, progressItem, { rotations: 0, color: '6' }),
				Object.assign({}, progressItem, { rotations: 0, color: '7' }),
				Object.assign({}, progressItem, { rotations: 0, color: '8' })
			]
		};
		const game = new PipesGame(grid, tiles, progress);
		game.initializeBoard();
		expect(game.initialized, 'sets initialized flag').toBe(true);
		game.tileStates.forEach((data, index) => {
			expect(data.rotations).toBe(progress.tiles[index].rotations);
			expect(data.color).toBe(progress.tiles[index].color);
			expect(data.locked).toBe(progress.tiles[index].locked);
			expect(data.tile).toBe(tiles[index]);
			expect(data.isPartOfLoop).toBe([1, 3, 4].some((x) => x === index));
		});
		game.components.forEach((component, index) => {
			if ([1, 3, 4].some((x) => x === index)) {
				expect([...component.tiles]).toEqual(expect.arrayContaining([1, 3, 4]));
			} else {
				expect([...component.tiles]).toEqual(expect.arrayContaining([index]));
			}
		});
	});
});

// Characterization pins for the current mask-targeting setTileOrientation.
// These pins get rewritten when the setter switches to rotation counts
// (see agent-doc/solver-rotation-plan.md).
describe('Test setTileOrientation mask targeting', () => {
	// open-ended puzzle, never solved - rotateTile keeps working throughout
	const grid = new HexaGrid(3, 3, false);
	const tiles = [1, 3, 3, 11, 11, 5, 1, 1, 1];

	it('Rotates from a non-zero current rotation to the target mask', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.rotateTile(0, 1);
		// tile 0 is a deadend (1); its state is 32 now, target 4 is 3 rotations ahead
		game.setTileOrientation(0, 4);
		expect(game.tileStates[0].rotations).toBe(4);
	});

	it('Rotates to another orientation in the orbit', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.rotateTile(0, 2);
		// state is 16 now, target 1 is 4 rotations ahead
		game.setTileOrientation(0, 1);
		expect(game.tileStates[0].rotations).toBe(6);
	});

	it('Is a no-op when already at the target mask', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.setTileOrientation(0, 1);
		expect(game.tileStates[0].rotations).toBe(0);
	});

	it('Throws when the target mask is unreachable', () => {
		const game = new PipesGame(grid, tiles, undefined);
		// 3 is a sharp turn, not in the deadend's orbit
		expect(() => game.setTileOrientation(0, 3)).toThrowError('No way to rotate tile');
	});

	it('Does a full turn on animate when already at the target mask', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.setTileOrientation(0, 1, true);
		expect(game.tileStates[0].rotations).toBe(6);
	});
});
