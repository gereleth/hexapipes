import { describe, expect, it } from 'vitest';
import { HexaGrid } from './grids/hexagrid';
import { SquareGrid } from './grids/squaregrid';
import { Generator } from './generator';
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
			expect(data.colors[0]).toBe('white');
			expect(data.locked).toBe(false);
			expect(data.tile).toBe(tiles[index]);
			expect(data.isPartOfLoop[0]).toBe(false);
		});
		game.components.forEach((component, index) => {
			if (index === 3 || index === 4) {
				expect([...component.subcells]).toEqual(expect.arrayContaining([3, 4]));
			} else {
				expect([...component.subcells]).toEqual(expect.arrayContaining([index]));
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
			expect(data.colors[0]).toBe('white');
			expect(data.locked).toBe(false);
			expect(data.tile).toBe(myTiles[index]);
			expect(data.isPartOfLoop[0]).toBe([1, 3, 4].some((x) => x === index));
		});
		game.components.forEach((component, index) => {
			if ([1, 3, 4].some((x) => x === index)) {
				expect([...component.subcells]).toEqual(expect.arrayContaining([1, 3, 4]));
			} else {
				expect([...component.subcells]).toEqual(expect.arrayContaining([index]));
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
			expect(data.colors[0]).toBe(progress.tiles[index].color);
			expect(data.locked).toBe(progress.tiles[index].locked);
			expect(data.tile).toBe(tiles[index]);
			expect(data.isPartOfLoop[0]).toBe(false);
		});
		game.components.forEach((component, index) => {
			if ([5, 8].some((x) => x === index)) {
				expect([...component.subcells]).toEqual(expect.arrayContaining([5, 8]));
			} else if (index === 2) {
				expect([...component.subcells]).toEqual(expect.arrayContaining([2]));
			} else {
				expect([...component.subcells]).toEqual(expect.arrayContaining([0, 1, 3, 4, 6, 7]));
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
			expect(data.colors[0]).toBe(progress.tiles[index].color);
			expect(data.locked).toBe(progress.tiles[index].locked);
			expect(data.tile).toBe(tiles[index]);
			expect(data.isPartOfLoop[0]).toBe([1, 3, 4].some((x) => x === index));
		});
		game.components.forEach((component, index) => {
			if ([1, 3, 4].some((x) => x === index)) {
				expect([...component.subcells]).toEqual(expect.arrayContaining([1, 3, 4]));
			} else {
				expect([...component.subcells]).toEqual(expect.arrayContaining([index]));
			}
		});
	});
});

describe('Test setTileRotation rotation targeting', () => {
	// open-ended puzzle, never solved - rotateTile keeps working throughout
	const grid = new HexaGrid(3, 3, false);
	const tiles = [1, 3, 3, 11, 11, 5, 1, 1, 1];

	it('Reaches the target rotation from non-zero current rotations', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.rotateTile(0, 1);
		game.setTileRotation(0, 4);
		expect(game.tileStates[0].rotations).toBe(4);

		const game2 = new PipesGame(grid, tiles, undefined);
		game2.rotateTile(0, 7); // current rotation modulo 6 is 1
		game2.setTileRotation(0, 2);
		expect(game2.tileStates[0].rotations).toBe(8);
	});

	it('Reaches the target from negative accumulated rotations', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.rotateTile(0, -1); // current rotation modulo 6 is 5
		game.setTileRotation(0, 1);
		expect(game.tileStates[0].rotations).toBe(1);
	});

	it('Is a no-op when already at the target rotation', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.setTileRotation(0, 0);
		expect(game.tileStates[0].rotations).toBe(0);
	});

	it('Does a full turn on animate when already at the target rotation', () => {
		const game = new PipesGame(grid, tiles, undefined);
		game.setTileRotation(0, 0, true);
		expect(game.tileStates[0].rotations).toBe(6);
	});

	it('Skips empty tiles', () => {
		const emptyTiles = [3, 9, 5, 5, 0, 1, 3, 9, 1];
		const emptyGrid = new HexaGrid(3, 3, false, emptyTiles);
		const game = new PipesGame(emptyGrid, emptyTiles, undefined);
		game.setTileRotation(4, 3);
		expect(game.tileStates[4].rotations).toBe(0);
	});
});

describe('Test classic game behavior on a generated board', () => {
	// puzzles are not hand-designed: a generated solved board is a spanning tree,
	// and the tests pin behavior through structural invariants of that tree
	const grid = new HexaGrid(4, 4, false);
	const solvedTiles = new Generator(grid).pregenerate_growingtree(1);

	/**
	 * @param {Number[]} tiles
	 * @returns {{index: Number, direction: Number}} - a dead-end tile and the
	 * direction it points to
	 */
	function findLeaf(tiles) {
		for (let index = 0; index < tiles.length; index++) {
			const directions = grid.getDirections(tiles[index], 0, index);
			if (directions.length === 1) {
				return { index, direction: directions[0] };
			}
		}
		throw new Error('no dead-end tile in generated board');
	}

	const leaf = findLeaf(solvedTiles);
	const neighbour = grid.find_neighbour(leaf.index, leaf.direction).neighbour;
	const playableCells = grid.total - grid.emptyCells.size;

	it('Starts solved with all tiles in one component', () => {
		const game = new PipesGame(grid, solvedTiles, undefined);
		expect(game.initialized, 'sets initialized flag').toBe(true);
		// quirk: the solved flag is only recomputed after a rotation,
		// a freshly constructed solved board does not have it set yet
		expect(game.solved).toBe(false);
		expect(game.isSolved()).toBe(true);
		expect(game.openEnds.size).toBe(0);
		expect(game.shareDisconnectedSubcells).toBe(0);
		const component = game.components.get(0);
		expect(component?.subcells.size).toBe(playableCells);
		game.tileStates.forEach((state) => {
			expect(state.colors[0]).toBe('white');
			expect(state.isPartOfLoop[0]).toBe(false);
			// quirk: initializeBoard marks island tiles without a size check,
			// so the one whole-board component counts as an island too
			expect(state.isPartOfIsland[0]).toBe(true);
			expect(state.hasDisconnects[0]).toBe(false);
		});
	});

	it('Merges back and shares color when a broken dead end is restored', () => {
		const game = new PipesGame(grid, solvedTiles, undefined);
		game.rotateTile(leaf.index, 1);
		expect(game.solved).toBe(false);
		expect(game.isSolved()).toBe(false);
		// both sides of the broken link report disconnects
		expect(game.tileStates[leaf.index].hasDisconnects[0]).toBe(true);
		expect(game.tileStates[neighbour].hasDisconnects[0]).toBe(true);
		expect(game.openEnds.has(leaf.index)).toBe(true);
		expect(game.openEnds.has(neighbour)).toBe(true);
		expect(game.openEnds.size).toBe(2);
		// the leaf splits off as its own component
		expect(game.components.get(leaf.index)?.subcells).toEqual(new Set([leaf.index]));
		expect(game.components.get(neighbour)?.subcells.size).toBe(playableCells - 1);
		expect(game.components.get(neighbour)).not.toBe(game.components.get(leaf.index));

		game.rotateTile(leaf.index, -1);
		expect(game.solved).toBe(true);
		expect(game.openEnds.size).toBe(0);
		expect(game.components.get(0)?.subcells.size).toBe(playableCells);
		// merging assigns the shared component color to all tiles
		const color = game.tileStates[0].colors[0];
		expect(color).not.toBe('white');
		game.tileStates.forEach((state) => {
			expect(state.colors[0]).toBe(color);
		});
	});

	it('Resets state on startOver', () => {
		const game = new PipesGame(grid, solvedTiles, undefined);
		game.rotateTile(leaf.index, 1);
		game.toggleLocked(0, true);
		game.toggleEdgeMark('conn', 5, 8);
		expect(game.tileStates[5].edgeMarks[2]).toBe('conn');

		game.startOver();
		// quirk: like the constructor, startOver leaves the solved flag unset
		// until the next rotation recomputes it
		expect(game.solved).toBe(false);
		expect(game.isSolved()).toBe(true);
		expect(game.openEnds.size).toBe(0);
		game.tileStates.forEach((state, index) => {
			expect(state.rotations, `tile ${index} rotations reset`).toBe(0);
			expect(state.colors[0], `tile ${index} color reset`).toBe('white');
			expect(state.locked, `tile ${index} unlocked`).toBe(false);
			expect(state.hasDisconnects[0], `tile ${index} no disconnects`).toBe(false);
			expect(state.isPartOfLoop[0], `tile ${index} not in loop`).toBe(false);
			// outer border marks stay 'none', the rest resets to 'empty'
			expect(state.edgeMarks.every((mark) => mark === 'none' || mark === 'empty')).toBe(true);
		});
		// cell 0 is in the corner: its first edgemark direction is an outer border
		expect(game.tileStates[0].edgeMarks[0]).toBe('none');
	});

	it('Restores state from saved progress with a string color', () => {
		const game = new PipesGame(grid, solvedTiles, undefined);
		game.rotateTile(leaf.index, 1);
		const lockIndex = leaf.index === 0 ? 1 : 0;
		game.toggleLocked(lockIndex, true);
		game.toggleEdgeMark('conn', 5, 8);
		// the unified writer stores the colors array under the color field
		const progress = {
			tiles: game.tileStates.map((data) => ({
				rotations: data.rotations,
				color: [...data.colors],
				locked: data.locked,
				edgeMarks: [...data.edgeMarks]
			}))
		};

		const restored = new PipesGame(grid, solvedTiles, progress);
		expect(restored.initialized, 'sets initialized flag').toBe(true);
		restored.tileStates.forEach((state, index) => {
			const saved = progress.tiles[index];
			expect(state.rotations, `tile ${index} rotations restored`).toBe(saved.rotations);
			expect(state.colors, `tile ${index} color restored`).toEqual(saved.color);
			expect(state.locked, `tile ${index} locked restored`).toBe(saved.locked);
			expect(state.edgeMarks, `tile ${index} edge marks restored`).toEqual(saved.edgeMarks);
		});
		expect(restored.tileStates[lockIndex].locked).toBe(true);
		expect(restored.solved).toBe(false);
		// the broken link is reproduced
		expect(restored.openEnds.has(leaf.index)).toBe(true);
		expect(restored.openEnds.has(neighbour)).toBe(true);
		expect(restored.isSolved()).toBe(false);
		// and the restored game can still be played to the end
		restored.rotateTile(leaf.index, -1);
		expect(restored.solved).toBe(true);

		// saves written before the unification hold a single string color
		const oldProgress = {
			tiles: progress.tiles.map((saved) => ({ ...saved, color: saved.color[0] }))
		};
		const restoredOld = new PipesGame(grid, solvedTiles, oldProgress);
		restoredOld.tileStates.forEach((state, index) => {
			expect(state.colors[0], `tile ${index} string color restored`).toBe(
				oldProgress.tiles[index].color
			);
		});
		expect(restoredOld.isSolved()).toBe(false);
	});

	it('Unlocks a tile before setting its rotation', () => {
		const game = new PipesGame(grid, solvedTiles, undefined);
		const index = leaf.index === 0 ? 1 : 0;
		game.toggleLocked(index, true);
		game.setTileRotation(index, 3);
		expect(game.tileStates[index].locked).toBe(false);
		expect(((game.tileStates[index].rotations % 6) + 6) % 6).toBe(3);
	});
});

describe('Test classic game micro behaviors', () => {
	it('Marks off-board stubs as disconnects', () => {
		const grid = new HexaGrid(3, 3, false);
		// cell 2 is on the top row and points east and northeast, both off-board
		const tiles = [1, 3, 3, 11, 11, 5, 1, 1, 1];
		const game = new PipesGame(grid, tiles, undefined);
		expect(game.tileStates[2].hasDisconnects[0]).toBe(true);
		expect(game.openEnds.has(2)).toBe(true);
		expect(game.isSolved()).toBe(false);
	});

	it('Finds islands without open ends', () => {
		const grid = new SquareGrid(2, 2, false);
		// two separate closed chains: 0-1 and 2-3
		const tiles = [1, 4, 1, 4];
		const game = new PipesGame(grid, tiles, undefined);
		expect(game.components.get(0)?.subcells).toEqual(new Set([0, 1]));
		expect(game.components.get(2)?.subcells).toEqual(new Set([2, 3]));
		expect(game.openEnds.size).toBe(0);
		game.tileStates.forEach((state, index) => {
			expect(state.isPartOfIsland[0], `tile ${index} is part of an island`).toBe(true);
		});
		expect(game.isSolved()).toBe(false);
	});

	it('Detects a loop formed by rotation', () => {
		const grid = new HexaGrid(3, 3, false);
		// cells 3-1-4 form a tree: 3 and 4 both connect to cell 1
		// rotating cell 4 five times connects it to cell 3 too, closing the loop
		const tiles = [1, 48, 3, 11, 6, 5, 1, 1, 1];
		const game = new PipesGame(grid, tiles, undefined);
		expect(game.tileStates[1].isPartOfLoop[0]).toBe(false);
		expect(game.components.get(1)?.subcells).toEqual(new Set([1, 3, 4]));

		game.rotateTile(4, 5);
		[1, 3, 4].forEach((index) => {
			expect(game.tileStates[index].isPartOfLoop[0], `tile ${index} is part of a loop`).toBe(true);
		});
		expect(game.isSolved()).toBe(false);

		game.startOver();
		[1, 3, 4].forEach((index) => {
			expect(game.tileStates[index].isPartOfLoop[0], `tile ${index} loop cleared`).toBe(false);
		});
	});

	it('Rotates to match a locked neighbour pointing at the tile', () => {
		const grid = new SquareGrid(2, 2, false);
		const tiles = [2, 4, 1, 4];
		const game = new PipesGame(grid, tiles, undefined);
		// cell 1 is locked and points at cell 0,
		// cell 0 must rotate to connect back to it
		game.toggleLocked(1, true);
		game.rotateToMatchMarks(0);
		expect(game.tileStates[0].rotations).toBe(1);
		expect(game.connections.get(0)?.has(1)).toBe(true);
		expect(game.connections.get(1)?.has(0)).toBe(true);

		// the assistant locks a tile and rotates its neighbours to match
		const game2 = new PipesGame(grid, tiles, undefined);
		game2.toggleLocked(1, true, true);
		expect(game2.tileStates[1].locked).toBe(true);
		expect(game2.tileStates[0].rotations).toBe(1);
		// cell 3 has no mark and no locked neighbour pointing at it: it stays
		expect(game2.tileStates[3].rotations).toBe(0);
	});
});
