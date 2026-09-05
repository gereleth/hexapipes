import { describe, expect, it } from 'vitest';
import { pregenerate_layers, validateLayers } from './generator-layers';
import { SquareGrid } from './grids/squaregrid';

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
			it(`Pregenerates a valid layered puzzle ${width}x${height} wrap=${wrap} branching=${branchingAmount}`, () => {
				for (let i = 0; i < 10; i++) {
					const grid = new SquareGrid(width, height, wrap);
					const layers = pregenerate_layers(grid, branchingAmount);
					validateLayers(grid, layers);
					expect(layers.length).toBe(grid.total);
				}
			});
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
