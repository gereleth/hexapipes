import { describe, expect, it } from 'vitest';
import { pregenerate_layers, randomRotate, validateLayers } from './generator-layers';
import { SquareGrid } from './grids/squaregrid';
import { LayeredPipesGame } from './game-layers.svelte';

const LETTERS = { 1: 'E', 2: 'N', 4: 'W', 8: 'S' };

/**
 * Renders layer bitmasks as direction letters, e.g. 13 -> "EW"
 * @param {Number} layer
 */
function decode(layer) {
	let result = '';
	for (let [bit, letter] of Object.entries(LETTERS)) {
		if ((layer & Number(bit)) > 0) {
			result += letter;
		}
	}
	return result;
}

describe('Test layered pregeneration', () => {
	const boards = [
		[3, 3, false],
		[4, 6, false],
		[5, 5, false],
		[5, 5, true]
	];

	for (let [width, height, wrap] of boards) {
		for (let branchingAmount of [0, 0.5, 1]) {
			for (let avoidObvious of [0, 0.5, 1]) {
				it(
					`Pregenerates a valid layered puzzle ${width}x${height} wrap=${wrap} ` +
						`branching=${branchingAmount} avoidObvious=${avoidObvious}`,
					() => {
						for (let i = 0; i < 10; i++) {
							const grid = new SquareGrid(width, height, wrap);
							const layers = pregenerate_layers(grid, branchingAmount, avoidObvious);
							validateLayers(grid, layers);
							expect(layers.length).toBe(grid.total);
						}
					}
				);
			}
		}
	}

	it('Prints a small layered puzzle', () => {
		const grid = new SquareGrid(5, 5, false);
		const layers = pregenerate_layers(grid, 0.5);
		validateLayers(grid, layers);
		expect(layers.length).toBe(grid.total);
		console.log('tiles array:', JSON.stringify(layers));
		for (let r = 0; r < grid.height; r++) {
			const cells = [];
			for (let c = 0; c < grid.width; c++) {
				const cellLayers = layers[r * grid.width + c];
				if (cellLayers.length === 0) {
					cells.push('.');
				} else {
					cells.push(cellLayers.map((layer) => `${layer}(${decode(layer)})`).join('/'));
				}
			}
			console.log(`Row ${r}: ${cells.join('  ')}`);
		}
	});
});

describe('Test layered scrambling', () => {
	it('Scrambled boards keep their shape', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(5, 5, false);
			const solved = pregenerate_layers(grid, 0.5);
			const scrambled = randomRotate(solved, grid);
			expect(scrambled.length).toBe(grid.total);
			scrambled.forEach((cellLayers, index) => {
				expect(cellLayers.length).toBe(solved[index].length);
				const polygon = grid.polygon_at(index);
				let used = 0;
				let xored = 0;
				cellLayers.forEach((layer) => {
					expect(layer).toBeGreaterThan(0);
					expect((layer | polygon.fully_connected) === polygon.fully_connected).toBe(true);
					used |= layer;
					xored ^= layer;
				});
				// layers of a cell still don't share directions
				expect(used).toBe(xored);
			});
		}
	});

	it('Scrambling actually scrambles', () => {
		const grid = new SquareGrid(5, 5, false);
		const solved = pregenerate_layers(grid, 0.5);
		const scrambled = randomRotate(solved, grid);
		const changed = scrambled.filter((cellLayers, index) =>
			cellLayers.some((layer, layerIndex) => layer !== solved[index][layerIndex])
		);
		expect(changed.length).toBeGreaterThan(0);
	});

	it('Scrambled board can be solved by rotating cells back', () => {
		const grid = new SquareGrid(4, 4, false);
		const solved = pregenerate_layers(grid, 0.5);
		const scrambled = randomRotate(solved, grid);
		const game = new LayeredPipesGame(grid, scrambled, undefined);
		expect(game.isSolved()).toBe(false);
		// find the rotation that solves every cell
		game.tileStates.forEach((state, index) => {
			for (let rotations = 0; rotations < 4; rotations++) {
				const rotatedLayers = state.layers.map((layer) => grid.rotate(layer, rotations, index));
				const target = solved[index];
				if (rotatedLayers.every((layer, layerIndex) => layer === target[layerIndex])) {
					game.rotateTile(index, rotations);
					break;
				}
			}
		});
		expect(game.solved).toBe(true);
	});
});
