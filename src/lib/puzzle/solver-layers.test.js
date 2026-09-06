import { describe, expect, it } from 'vitest';
import { HexaGrid } from './grids/hexagrid';
import { SquareGrid } from './grids/squaregrid';
import { LayeredCell, LayeredSolver } from './solver-layers';
import { pregenerate_layers, randomRotate, validateLayers } from './generator-layers';

/**
 * Applies solved rotations to scrambled layered tiles
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @param {Number[]} marked - rotation per cell
 * @returns {Number[][]}
 */
function applyRotations(grid, tiles, marked) {
	return tiles.map((cellLayers, index) => {
		const polygon = grid.polygon_at(index);
		return cellLayers.map((layer) => polygon.rotate(layer, marked[index]));
	});
}

describe('Test hexagrid layered cell constraints', () => {
	const grid = new HexaGrid(3, 3, false);

	it('Starts with correct possible states from initial layers - deadend', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		expect(cell.pictures.size).toBe(6);
		expect([...cell.pictures.keys()]).toEqual(
			expect.arrayContaining(['1', '2', '4', '8', '16', '32'])
		);
	});

	it('Starts with correct possible states from initial layers - sharp turn', () => {
		const cell = new LayeredCell([3], grid.polygon_at(0), 0);
		expect(cell.pictures.size).toBe(6);
		expect([...cell.pictures.keys()]).toEqual(
			expect.arrayContaining(['3', '6', '12', '24', '48', '33'])
		);
	});

	it('Starts with correct possible states from initial layers - straight', () => {
		const cell = new LayeredCell([9], grid.polygon_at(0), 0);
		expect(cell.pictures.size).toBe(3);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['9', '18', '36']));
	});

	it('Drops configurations that contradict walls - deadend', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		cell.addWall(8);
		cell.applyConstraints();
		expect(cell.pictures.size).toBe(5);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['1', '2', '4', '16', '32']));
	});

	it('Drops configurations that contradict walls - straight', () => {
		const cell = new LayeredCell([9], grid.polygon_at(0), 0);
		cell.addWall(2);
		cell.applyConstraints();
		expect(cell.pictures.size).toBe(2);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['9', '36']));
	});

	it('Drops configurations that contradict walls - sharp turn', () => {
		const cell = new LayeredCell([3], grid.polygon_at(0), 0);
		cell.addWall(2);
		cell.applyConstraints();
		expect(cell.pictures.size).toBe(4);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['12', '24', '48', '33']));
	});

	it('Drops configurations that contradict connections - deadend', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		cell.addConnection(8);
		cell.applyConstraints();
		expect(cell.pictures.size).toBe(1);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['8']));
	});

	it('Drops configurations that contradict connections - straight', () => {
		const cell = new LayeredCell([9], grid.polygon_at(0), 0);
		cell.addConnection(2);
		cell.applyConstraints();
		expect(cell.pictures.size).toBe(1);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['18']));
	});

	it('Drops configurations that contradict connections - sharp turn', () => {
		const cell = new LayeredCell([3], grid.polygon_at(0), 0);
		cell.addConnection(2);
		cell.applyConstraints();
		expect(cell.pictures.size).toBe(2);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['3', '6']));
	});

	it('Reports correct added features - deadend', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		cell.addConnection(2);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(0);
		expect(addedWalls).toBe(61);
	});

	it('Reports correct added features - straight', () => {
		const cell = new LayeredCell([9], grid.polygon_at(0), 0);
		cell.addConnection(2);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(16);
		expect(addedWalls).toBe(45);
	});

	it('Reports correct added features - wide turn', () => {
		const cell = new LayeredCell([5], grid.polygon_at(0), 0);
		cell.addConnection(2);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(0);
		expect(addedWalls).toBe(21);
	});

	it('Reports correct added features - X', () => {
		const cell = new LayeredCell([54], grid.polygon_at(0), 0);
		cell.addWall(1);
		const { addedConnections, addedWalls } = cell.applyConstraints();
		expect(addedConnections).toBe(54);
		expect(addedWalls).toBe(8);
	});

	it('Throws error if no pictures are possible - X', () => {
		const cell = new LayeredCell([54], grid.polygon_at(0), 0);
		cell.addWall(3);
		expect(cell.applyConstraints).toThrowError('No orientations possible');
	});
});

describe('Test squaregrid layered cell pictures', () => {
	const grid = new SquareGrid(3, 3, false);

	it('Deduplicates twin rotations of two opposite deadends', () => {
		const cell = new LayeredCell([1, 4], grid.polygon_at(4), 4);
		expect(cell.pictures.size).toBe(2);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['1-4', '2-8']));
		expect(cell.pictures.get('1-4')).toBe(0);
		expect(cell.pictures.get('2-8')).toBe(1);
	});

	it('Deduplicates all rotations of two crossing straights', () => {
		const cell = new LayeredCell([5, 10], grid.polygon_at(4), 4);
		expect(cell.pictures.size).toBe(1);
		expect(cell.pictures.get('5-10')).toBe(0);
	});

	it('Empty cell has a single empty picture', () => {
		const cell = new LayeredCell([], grid.polygon_at(0), 0);
		expect(cell.pictures.size).toBe(1);
		expect(cell.pictures.get('0')).toBe(0);
	});
});

describe('Test layered cell cloning', () => {
	const grid = new HexaGrid(1, 1, false);

	it('Makes a copy of the cell', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		const clone = cell.clone();
		expect(clone.index).toBe(cell.index);
		expect([...clone.pictures.keys()]).toEqual(expect.arrayContaining([...cell.pictures.keys()]));
	});

	it('Removing picture from cell does not affect clone', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		const ids = [...cell.pictures.keys()];
		const clone = cell.clone();
		cell.pictures.delete('1');
		expect([...clone.pictures.keys()]).toEqual(expect.arrayContaining(ids));
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(ids.filter((x) => x !== '1')));
	});

	it('Removing picture from clone does not affect cell', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		const ids = [...cell.pictures.keys()];
		const clone = cell.clone();
		clone.pictures.delete('1');
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(ids));
		expect([...clone.pictures.keys()]).toEqual(
			expect.arrayContaining(ids.filter((x) => x !== '1'))
		);
	});
});

describe('Test solver border constraints', () => {
	const grid = new HexaGrid(3, 3, false);
	const tiles = [[3], [3], [3], [1], [9], [1], [3], [3], [3]];

	it('Starts with correct possible states', () => {
		const solver = new LayeredSolver(tiles, grid);
		const cell = solver.getCell(3);
		expect(cell.pictures.size).toBe(5);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['1', '2', '4', '16', '32']));
	});

	it('Adds walls to border cells', () => {
		const solver = new LayeredSolver(tiles, grid);
		let cell = solver.getCell(0);
		expect(cell.walls).toBe(30);
		cell = solver.getCell(1);
		expect(cell.walls).toBe(6);
		cell = solver.getCell(2);
		expect(cell.walls).toBe(7);
		expect([...solver.dirty]).toEqual(expect.arrayContaining([0, 1, 2]));
	});

	it('Adds full and empty cells to dirty set', () => {
		const solver = new LayeredSolver(
			[[1], [1], [1], [1], [1], [], [63], [1], [1], [1], [1], [1]],
			new HexaGrid(4, 3, false)
		);
		const emptyCell = solver.getCell(5);
		expect(emptyCell.walls).toBe(0);
		expect(emptyCell.pictures.size).toBe(1);
		const fullCell = solver.getCell(6);
		expect(fullCell.connections).toBe(0);
		expect(fullCell.pictures.size).toBe(1);
		expect([...solver.dirty]).toContain(5);
		expect([...solver.dirty]).toContain(6);
	});

	it('Does not add constraints to cells in a wrap puzzle', () => {
		const grid = new HexaGrid(3, 1, true);
		const solver = new LayeredSolver([[3], [3], [3]], grid);
		solver.getCell(0);
		expect(solver.dirty.size).toBe(0);
	});

	it('Rules out pictures connecting only deadends', () => {
		const solver = new LayeredSolver(tiles, new HexaGrid(3, 3, false));
		const cell = solver.getCell(4);
		expect([...solver.dirty]).toContain(4);
		expect([...cell.pictures.keys()]).toEqual(expect.arrayContaining(['18', '36']));
	});
});

describe('Test solver cloning', () => {
	it('Clone is isolated from the original solver', () => {
		const grid = new HexaGrid(3, 1, true);
		const tiles = [[3], [3], [3]];
		const solver = new LayeredSolver(tiles, grid);
		const cell = solver.getCell(0);
		const clone = solver.clone();
		const cloneCell = clone.unsolved.get(0);
		if (cloneCell === undefined) {
			throw 'Clone cell is undefined';
		}
		cell.pictures.delete('3');
		cell.addWall(1);
		expect([...cloneCell.pictures.keys()]).toContain('3');
		expect(cloneCell.walls).toBe(cell.walls - 1);
		cloneCell.addConnection(2);
		expect(cell.connections).toBe(0);
	});
});

describe('Test solutions check and marking ambiguous cells', () => {
	it('Detects unsolvable puzzle - quickly from border constraints', () => {
		const grid = new HexaGrid(2, 2, false);
		const tiles = [[9], [5], [5], [3]];
		const solver = new LayeredSolver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects unsolvable puzzle - after some trials', () => {
		const grid = new HexaGrid(2, 2, true);
		const tiles = [[1], [5], [5], [3]];
		const solver = new LayeredSolver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects a sub-cell loop that can never be a tree', () => {
		const grid = new SquareGrid(2, 2, true);
		const tiles = [[9], [12], [3], [6]];
		const solver = new LayeredSolver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects a small puzzle with a unique solution', () => {
		const grid = new HexaGrid(2, 2, false);
		const tiles = [[1], [1], [7], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(solved).toStrictEqual([[32], [16], [7], [8]]);
	});

	it('Detects a larger puzzle with a unique solution', () => {
		const grid = new HexaGrid(2, 3, false);
		const tiles = [[1], [1], [15], [1], [1], [3]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(solved).toStrictEqual([[32], [16], [39], [8], [1], [12]]);
	});

	it('Detects a puzzle with multiple solutions', () => {
		const grid = new HexaGrid(3, 3, false);
		const tiles = [[1], [5], [1], [1], [62], [3], [1], [5], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(false);
		const ambiguousCells = marked
			.map((rotation, index) => (rotation === solver.AMBIGUOUS ? index : -1))
			.filter((index) => index !== -1);
		expect(ambiguousCells).toEqual([2, 4, 5, 8]);
		const solved = applyRotations(grid, tiles, marked);
		expect([solved[0][0], solved[1][0], solved[3][0], solved[6][0], solved[7][0]]).toEqual([
			1, 40, 1, 1, 10
		]);
	});

	it('Detects a wrap puzzle with multiple solutions', () => {
		const grid = new HexaGrid(3, 3, true);
		const tiles = [[1], [3], [1], [43], [5], [5], [1], [3], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(false);
		const ambiguousCells = marked
			.map((rotation, index) => (rotation === solver.AMBIGUOUS ? index : -1))
			.filter((index) => index !== -1);
		expect(ambiguousCells).toEqual([2, 4, 5, 8]);
		const solved = applyRotations(grid, tiles, marked);
		expect([solved[0][0], solved[1][0], solved[3][0], solved[6][0], solved[7][0]]).toEqual([
			1, 24, 43, 1, 12
		]);
	});

	it('Detects a puzzle with an empty cell and a unique solution', () => {
		const grid = new HexaGrid(3, 3, false, [3, 9, 5, 5, 0, 1, 3, 9, 1]);
		const tiles = [[3], [9], [5], [5], [], [1], [3], [9], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});

	it('Detects a wrap puzzle with an empty cell and a unique solution', () => {
		const grid = new HexaGrid(3, 3, true, [3, 9, 5, 5, 0, 1, 3, 9, 1]);
		const tiles = [[3], [9], [5], [5], [], [1], [3], [9], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});

	it('Detects a puzzle with many empty cells and a unique solution', () => {
		const classicTiles = [
			0, 0, 16, 1, 25, 40, 0, 0, 18, 1, 42, 16, 4, 0, 0, 18, 32, 32, 7, 25, 8, 35, 8, 20, 36, 19, 8,
			16, 0, 36, 19, 9, 62, 17, 10, 0, 6, 32, 18, 7, 8, 0, 0, 0, 1, 15, 9, 8, 0
		];
		const grid = new HexaGrid(7, 7, false, classicTiles);
		const tiles = classicTiles.map((tile) => (tile === 0 ? [] : [tile]));
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});
});

describe('Test multi-layer boards', () => {
	it('Solves a unique multi-layer board with a twin-picture cell', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[1], [13], [4], [9], [5, 10], [4], [3], [7], [4]];
		validateLayers(grid, tiles);
		const centerCell = new LayeredCell(tiles[4], grid.polygon_at(4), 4);
		// crossing straights draw the same picture at every rotation
		expect(centerCell.pictures.size).toBe(1);
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});

	it('Finds pregenerated scrambled boards solvable', () => {
		const grids = [
			new SquareGrid(4, 4, false),
			new HexaGrid(4, 3, false),
			new SquareGrid(3, 4, true)
		];
		for (const grid of grids) {
			const layers = pregenerate_layers(grid, 0.5);
			expect(() => validateLayers(grid, layers)).not.toThrow();
			const scrambled = randomRotate(layers, grid);
			const solver = new LayeredSolver(scrambled, grid);
			const { marked, solvable, unique } = solver.markAmbiguousTiles();
			expect(solvable).toBe(true);
			if (unique) {
				const solved = applyRotations(grid, scrambled, marked);
				expect(() => validateLayers(grid, solved)).not.toThrow();
			}
		}
	}, 60000);

	it('Reports progress while marking ambiguous cells', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[1], [13], [4], [9], [5, 10], [4], [3], [7], [4]];
		const solver = new LayeredSolver(tiles, grid);
		/** @type {import('./solver-layers').SolverProgress[]} */
		const calls = [];
		solver.progress_callback = (progress) => calls.push({ ...progress });
		const { complete } = solver.markAmbiguousTiles();
		expect(complete).toBe(true);
		expect(calls.length).toBeGreaterThan(0);
		for (const progress of calls) {
			expect(progress.total).toBe(9);
			expect(progress.solved).toBeGreaterThanOrEqual(0);
			expect(progress.ambiguous).toBeGreaterThanOrEqual(0);
			expect(progress.guessed).toBeGreaterThanOrEqual(0);
		}
	});

	it('Stops with an incomplete result when capped', () => {
		const grid = new HexaGrid(3, 3, false);
		const tiles = [[1], [5], [1], [1], [62], [3], [1], [5], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { solvable, unique, complete } = solver.markAmbiguousTiles(0, 1);
		expect(complete).toBe(false);
		expect(unique).toBe(false);
		expect(solvable).toBe(true);
		// without the cap the same puzzle completes
		const fullSolver = new LayeredSolver(tiles, grid);
		expect(fullSolver.markAmbiguousTiles().complete).toBe(true);
	});

	it('Yields steps while solving', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[1], [13], [4], [9], [5, 10], [4], [3], [7], [4]];
		const scrambled = randomRotate(tiles, grid);
		const solver = new LayeredSolver(scrambled, grid);
		/** @type {String[]} */
		const stages = [];
		let finalSteps = 0;
		for (const { stage, step } of solver.solve(true)) {
			stages.push(stage);
			expect(step.cell).toBeGreaterThanOrEqual(0);
			expect(typeof step.id).toBe('string');
			expect(step.rotation).toBeGreaterThanOrEqual(0);
			if (step.final) {
				finalSteps += 1;
			}
		}
		expect(stages.length).toBeGreaterThan(0);
		expect(finalSteps).toBe(9);
		expect(solver.solutions.length).toBe(1);
		const marked = solver.solution.map((id, cell) => {
			const rotation = solver.pictureTable[cell].get(/** @type {String} */ (id));
			expect(rotation).toBeDefined();
			return /** @type {Number} */ (rotation);
		});
		const solved = applyRotations(grid, scrambled, marked);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});
});
