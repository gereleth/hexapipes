import { describe, expect, it } from 'vitest';
import { LayeredPipesGame } from './game-layers.svelte';
import { SquareGrid } from './grids/squaregrid';
import { pregenerate_layers } from './generator-layers';

describe('Test layered game', () => {
	it('Tracks connections and solved state on a simple chain', () => {
		const grid = new SquareGrid(2, 1, false);
		const tiles = [[1], [4]];
		const game = new LayeredPipesGame(grid, tiles, undefined);
		expect(game.initialized, 'sets initialized flag').toBe(true);
		expect(game.isSolved()).toBe(true);
		expect(game.connections.get(0)).toEqual(new Set([1]));
		expect(game.connections.get(1)).toEqual(new Set([0]));
		// edge marks on outer edges of non-wrap boards
		expect(game.tileStates[0].edgeMarks).toEqual(['none', 'none']);
		expect(game.tileStates[1].edgeMarks).toEqual(['none', 'empty']);

		// rotate away from the solution
		game.rotateTile(0, 1);
		expect(game.solved).toBe(false);
		expect(game.tileStates[0].hasDisconnects[0]).toBe(true);
		expect(game.tileStates[1].hasDisconnects[0]).toBe(true);
		expect(game.components.get(0)?.tiles).toEqual(new Set([0]));
		expect(game.components.get(1)?.tiles).toEqual(new Set([1]));

		// rotate back
		game.rotateTile(0, -1);
		expect(game.solved).toBe(true);
		expect(game.tileStates[0].hasDisconnects[0]).toBe(false);
		expect(game.tileStates[1].hasDisconnects[0]).toBe(false);
		expect(game.components.get(0)?.tiles).toEqual(new Set([0, 1]));
		const color = game.tileStates[0].colors[0];
		expect(color).not.toBe('white');
		expect(game.tileStates[1].colors[0]).toBe(color);

		game.startOver();
		expect(game.tileStates[0].rotations).toBe(0);
		expect(game.tileStates[0].colors[0]).toBe('white');
		expect(game.isSolved()).toBe(true);
	});

	it('Finds separate components and islands', () => {
		const grid = new SquareGrid(2, 2, false);
		const tiles = [[1], [4], [1], [4]];
		const game = new LayeredPipesGame(grid, tiles, undefined);
		expect(game.components.get(0)?.tiles).toEqual(new Set([0, 1]));
		expect(game.components.get(2)?.tiles).toEqual(new Set([2, 3]));
		game.tileStates.forEach((state, index) => {
			expect(state.isPartOfIsland[0], `cell ${index} is part of an island`).toBe(true);
			expect(game.cellIsPartOfIsland(index)).toBe(true);
		});
		expect(game.isSolved()).toBe(false);
	});

	it('Tracks disconnects per layer', () => {
		const grid = new SquareGrid(2, 2, false);
		const tiles = [[1], [4, 2], [1], [4]];
		const game = new LayeredPipesGame(grid, tiles, undefined);
		// cell 1 second layer points outside the board
		expect(game.tileStates[1].hasDisconnects).toEqual([false, true]);
		expect(game.components.get(5)?.tiles).toEqual(new Set([5]));
		expect(game.shareDisconnectedTiles).toBeCloseTo(1 / 5);
	});

	it('Merges and splits components on rotations', () => {
		const grid = new SquareGrid(2, 2, false);
		const tiles = [[1], [4], [3], [6]];
		const game = new LayeredPipesGame(grid, tiles, undefined);
		// two components: cells 0-1 and 2-3
		// cell 2 and 3 point at not yet connected neighbours
		expect(game.components.get(0)?.tiles).toEqual(new Set([0, 1]));
		expect(game.components.get(2)?.tiles).toEqual(new Set([2, 3]));
		expect(game.tileStates[2].hasDisconnects[0]).toBe(true);
		expect(game.tileStates[3].hasDisconnects[0]).toBe(true);

		// rotating cell 1 breaks the connection to cell 0
		// and connects to cell 3 instead
		game.rotateTile(1, 3);
		expect(game.solved).toBe(false);
		expect(game.components.get(0)?.tiles).toEqual(new Set([0]));
		expect(game.components.get(1)?.tiles).toEqual(new Set([1, 2, 3]));

		// rotating cell 0 connects it to cell 2 and solves the puzzle
		game.rotateTile(0, 1);
		expect(game.solved).toBe(true);
		expect(game.components.get(0)?.tiles).toEqual(new Set([0, 1, 2, 3]));
		expect(game.tileStates[2].hasDisconnects[0]).toBe(false);
		expect(game.tileStates[3].hasDisconnects[0]).toBe(false);
		const color = game.tileStates[0].colors[0];
		expect(color).not.toBe('white');
		game.tileStates.forEach((state, index) => {
			expect(state.colors[0], `cell ${index} has the component color`).toBe(color);
		});
	});

	it('Detects loops over layers', () => {
		const grid = new SquareGrid(2, 2, false);
		// all four cells connect in a loop
		const tiles = [[9], [12], [3], [6]];
		const game = new LayeredPipesGame(grid, tiles, undefined);
		expect(game.tileStates[0].isPartOfLoop[0]).toBe(true);
		expect(game.tileStates[1].isPartOfLoop[0]).toBe(true);
		expect(game.tileStates[2].isPartOfLoop[0]).toBe(true);
		expect(game.tileStates[3].isPartOfLoop[0]).toBe(true);
		expect(game.isSolved()).toBe(false);

		// rotating cell 1 breaks the loop
		// and leaves cells 0 and 1 with disconnects
		game.rotateTile(1, 3);
		game.tileStates.forEach((state, index) => {
			expect(state.isPartOfLoop[0], `cell ${index} is not part of a loop`).toBe(false);
		});
		expect(game.tileStates[0].hasDisconnects[0]).toBe(true);
		expect(game.tileStates[1].hasDisconnects[0]).toBe(true);
		expect(game.solved).toBe(false);
	});

	it('Restores state from saved progress', () => {
		const grid = new SquareGrid(2, 2, false);
		const tiles = [[1], [4], [1], [6]];
		/** @type {import('./game-layers.svelte').LayeredProgress} */
		const progress = {
			tiles: [
				{ rotations: 2, colors: ['red'], locked: true, edgeMarks: ['none', 'none'] },
				{ rotations: 1, colors: ['blue'], locked: false, edgeMarks: ['empty', 'empty'] },
				{ rotations: -1, colors: ['green'], locked: false, edgeMarks: ['empty', 'empty'] },
				{ rotations: 0, colors: ['yellow'], locked: true, edgeMarks: ['empty', 'empty'] }
			]
		};
		const game = new LayeredPipesGame(grid, tiles, progress);
		game.tileStates.forEach((state, index) => {
			const savedTile = progress.tiles[index];
			expect(state.rotations).toBe(savedTile.rotations);
			expect(state.colors).toEqual(savedTile.colors);
			expect(state.locked).toBe(savedTile.locked);
			expect(state.edgeMarks).toEqual(savedTile.edgeMarks);
			expect(state.layers).toEqual(tiles[index]);
		});
	});

	it('Solves a scrambled generated board', () => {
		const grid = new SquareGrid(4, 4, false);
		const solvedTiles = pregenerate_layers(grid, 0.5);
		// rotate every cell by a random amount to scramble the board,
		// all layers of a cell rotate together
		const scrambles = solvedTiles.map(() => Math.floor(Math.random() * 4));
		const scrambled = solvedTiles.map((cellLayers, index) => {
			return cellLayers.map((layer) => {
				return grid.rotate(layer, scrambles[index], index);
			});
		});
		const game = new LayeredPipesGame(grid, scrambled, undefined);
		expect(game.isSolved()).toBe(false);
		game.tileStates.forEach((state, index) => {
			game.rotateTile(index, (4 - scrambles[index]) % 4);
		});
		expect(game.solved).toBe(true);
	});
});
