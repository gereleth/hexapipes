import { describe, expect, it } from 'vitest';
import { HexaGrid } from './grids/hexagrid';
import { SquareGrid } from './grids/squaregrid';
import { LayeredCell, LayeredSolver } from './solver-layers';
import {
	applyRotations,
	pregenerate_layers,
	randomRotate,
	validateLayers
} from './generator-layers';

describe('Test LayeredCell possible states initialization', () => {
	const grid = new HexaGrid(3, 3, false);
	const polygon = grid.polygon_at(0);
	it('Starts with correct possible states from initial layers - deadend', () => {
		const cell = new LayeredCell([1], polygon, 0);
		expect(cell.possible.size).toBe(6);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 3, 4, 5]));
	});
	it('Starts with correct possible states from initial layers - straight', () => {
		const cell = new LayeredCell([9], polygon, 0);
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(0)).toEqual([9]);
		expect(cell.possible.get(1)).toEqual([36]);
		expect(cell.possible.get(2)).toEqual([18]);
	});
	it('Starts with correct possible states from initial layers - deadend + bend', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		expect(cell.possible.size).toBe(6);
		expect(cell.possible.get(0)).toEqual([1, 6]);
		expect(cell.possible.get(1)).toEqual([32, 3]);
		expect(cell.possible.get(2)).toEqual([16, 33]);
		expect(cell.possible.get(3)).toEqual([8, 48]);
		expect(cell.possible.get(4)).toEqual([4, 24]);
		expect(cell.possible.get(5)).toEqual([2, 12]);
	});
	it('Starts with correct possible states from initial layers - two opposite deadends', () => {
		const cell = new LayeredCell([1, 8], polygon, 0);
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(0)).toEqual([1, 8]);
		expect(cell.possible.get(1)).toEqual([32, 4]);
		expect(cell.possible.get(2)).toEqual([16, 2]);
	});
	it('Empty cell has a single empty state', () => {
		const cell = new LayeredCell([], polygon, 0);
		expect(cell.possible.size).toBe(1);
		expect(cell.possible.get(0)).toEqual([]);
	});
});
describe('Test LayeredCell applyConstraints', () => {
	const grid = new HexaGrid(3, 3, false);
	const polygon = grid.polygon_at(0);

	it('Throws error if no orientations are possible', () => {
		const cell = new LayeredCell([9, 18], polygon, 0); // two straights form an X
		cell.addWall(1 + 2);
		expect(() => cell.applyConstraints()).toThrowError('No orientations possible');
	});
	it('Reports own deadends - two deadend layers', () => {
		const cell = new LayeredCell([1, 8], polygon, 0);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(63);
	});
	it('Reports own deadends - deadend + bend', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(0);
	});
	it('Applies wall constraint', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		cell.addWall(1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(3)).toEqual([8, 48]);
		expect(cell.possible.get(4)).toEqual([4, 24]);
		expect(cell.possible.get(5)).toEqual([2, 12]);
		expect(addedConnections).toEqual(8);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(2);
	});
	it('Applies connection constraint', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		cell.addConnection(1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(3);
		expect(cell.possible.get(0)).toEqual([1, 6]);
		expect(cell.possible.get(1)).toEqual([32, 3]);
		expect(cell.possible.get(2)).toEqual([16, 33]);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(8);
		expect(addedDeadends).toEqual(16);
	});
	it('Applies neighbour deadend constraint', () => {
		const cell = new LayeredCell([1, 6], polygon, 0);
		cell.addNeighbourDeadend(1, 1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(5);
		expect(cell.possible.get(1)).toEqual([32, 3]);
		expect(cell.possible.get(2)).toEqual([16, 33]);
		expect(cell.possible.get(3)).toEqual([8, 48]);
		expect(cell.possible.get(4)).toEqual([4, 24]);
		expect(cell.possible.get(5)).toEqual([2, 12]);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(2);
	});
	it('Applies neighbour deadend constraint - a bend must escape deadend area', () => {
		const cell = new LayeredCell([3], polygon, 0);
		// direction 1 is the only escape route
		polygon.directions.forEach((d) => d === 1 || cell.addNeighbourDeadend(d, 1));
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(2);
		expect(cell.possible.get(0)).toEqual([3]);
		expect(cell.possible.get(1)).toEqual([33]);
		expect(addedConnections).toEqual(1);
		expect(addedWalls).toEqual(4 + 8 + 16);
		expect(addedDeadends).toEqual(1);
		expect(cell.ownDeadendWeights.get(1)).toEqual(2);
	});
	it('Transfers neighbour deadend constraints through itself', () => {
		const cell = new LayeredCell([9], polygon, 0);
		cell.addNeighbourDeadend(1, 1);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(3);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(8);
		expect(cell.ownDeadendWeights.get(8)).toEqual(2);
	});
	it('Uses max over neighbour deadends for deriving own deadends', () => {
		const cell = new LayeredCell([3], polygon, 0);
		cell.addConnection(1);
		cell.addNeighbourDeadend(2, 1);
		cell.addNeighbourDeadend(32, 5);
		const { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints();
		expect(cell.possible.size).toBe(2);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(4 + 8 + 16);
		expect(addedDeadends).toEqual(1);
		expect(cell.ownDeadendWeights.get(1)).toEqual(6);
	});
});

describe('Test layered cell cloning', () => {
	const grid = new HexaGrid(1, 1, false);
	const polygon = grid.polygon_at(0);

	it('Makes a copy of the cell', () => {
		const cell = new LayeredCell([1], polygon, 0);
		const clone = cell.clone();
		expect(clone.index).toBe(cell.index);
		expect([...clone.possible.keys()]).toEqual(expect.arrayContaining([...cell.possible.keys()]));
	});

	it('Removing state from cell does not affect clone', () => {
		const cell = new LayeredCell([1], polygon, 0);
		const rotations = [...cell.possible.keys()];
		const clone = cell.clone();
		cell.possible.delete(0);
		expect([...clone.possible.keys()]).toEqual(expect.arrayContaining(rotations));
		expect([...cell.possible.keys()]).toEqual(
			expect.arrayContaining(rotations.filter((x) => x !== 0))
		);
	});

	it('Removing state from clone does not affect cell', () => {
		const cell = new LayeredCell([1], polygon, 0);
		const rotations = [...cell.possible.keys()];
		const clone = cell.clone();
		clone.possible.delete(0);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining(rotations));
		expect([...clone.possible.keys()]).toEqual(
			expect.arrayContaining(rotations.filter((x) => x !== 0))
		);
	});
});

describe('Test solver border constraints', () => {
	const grid = new SquareGrid(3, 3, false);
	const tiles = [[1, 8], [12], [8], [11], [6, 8], [10], [3], [7], [6]];

	it('Adds walls to border cells', () => {
		const solver = new LayeredSolver(tiles, grid);
		let cell = solver.getCell(0);
		expect(cell.walls).toBe(6);
		cell = solver.getCell(1);
		expect(cell.walls).toBe(2);
		cell = solver.getCell(2);
		expect(cell.walls).toBe(3);
		cell = solver.getCell(7);
		expect(cell.walls).toBe(8);
		expect([...solver.dirty]).toEqual(expect.arrayContaining([0, 1, 2, 7]));
	});

	it('Adds full and empty cells to dirty set', () => {
		const solver = new LayeredSolver([[], [9], [4, 8], [9], [15], [6], [1, 2], [6], []], grid);
		const emptyCell = solver.getCell(0);
		expect(emptyCell.walls).toBe(0);
		expect(emptyCell.possible.size).toBe(1);
		expect(solver.dirty).toContain(0);
		const fullCell = solver.getCell(4);
		expect(fullCell.connections).toBe(0);
		expect(fullCell.possible.size).toBe(1);
		expect(solver.dirty).toContain(4);
	});

	it('Does not add constraints to cells in a wrap puzzle', () => {
		const grid = new HexaGrid(3, 1, true);
		const solver = new LayeredSolver([[3], [3], [3]], grid);
		const cell = solver.getCell(0);
		expect(cell.walls).toBe(0);
		// materialization itself always dirties the cell, even with no facts to deduce
		expect(solver.dirty).toContain(0);
	});
});

describe('Test solver cloning', () => {
	it('Clone is isolated from the original solver', () => {
		const grid = new HexaGrid(3, 1, true);
		const tiles = [[1], [9], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const cell = solver.getCell(0);
		const clone = solver.clone();
		const cloneCell = clone.getCell(0);
		cell.possible.delete(0);
		cell.addWall(1);
		expect([...cloneCell.possible.keys()]).toContain(0);
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
		const tiles = [[1], [1, 2], [7], [3]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(solved).toStrictEqual([[32], [16, 32], [7], [12]]);
	});

	it('Detects a larger puzzle with a unique solution', () => {
		const grid = new HexaGrid(2, 3, false);
		const tiles = [[3], [1], [5, 24], [3], [3], [5, 2]];
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(solved).toStrictEqual([[33], [8], [20, 33], [24], [3], [10, 4]]);
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
		const tiles = [[3], [9], [5], [5], [], [1], [3], [9], [1]];
		const grid = new HexaGrid(3, 3, false, tiles);
		const solver = new LayeredSolver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});

	it('Detects a wrap puzzle with an empty cell and a unique solution', () => {
		const tiles = [[3], [9], [5], [5], [], [1], [3], [9], [1]];
		const grid = new HexaGrid(3, 3, true, tiles);
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
	it('Finds pregenerated scrambled boards solvable', () => {
		const grids = [
			new SquareGrid(4, 4, false),
			new HexaGrid(4, 3, false),
			new SquareGrid(3, 4, true)
		];
		for (const grid of grids) {
			const layers = pregenerate_layers(grid, 1.0, 0.5);
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

	it('Dirty-processes every materialized cell', () => {
		// query paths (getAnsweringComponent etc.) materialize cells via getCell
		// without dirtying them; every materialized cell must still go through
		// processDirtyCell at least once, or its deadend/wall facts never reach
		// its neighbours. Tiles generated by pregenerate_layers on a 4x4 wrap
		// grid, picked because the pre-fix solver leaves cell 10 materialized
		// but never dirty-processed on this board.
		const tiles = [
			[14],
			[3],
			[4],
			[1],
			[7],
			[9, 4],
			[13],
			[13],
			[4, 9],
			[3, 4],
			[10, 4],
			[11],
			[14],
			[9],
			[7],
			[2, 4, 1]
		];
		const grid = new SquareGrid(4, 4, true);
		const originalProcess = LayeredSolver.prototype.processDirtyCell;
		/** @type {Set<Number>} */
		const rootProcessed = new Set();
		LayeredSolver.prototype.processDirtyCell = function (/** @type {Number} */ index) {
			// clones materialize nothing themselves, so only root-side
			// processing matters for this invariant
			if (this.parent === null) {
				rootProcessed.add(index);
			}
			return originalProcess.call(this, index);
		};
		try {
			const solver = new LayeredSolver(tiles, grid);
			const { solvable } = solver.markAmbiguousTiles();
			expect(solvable).toBe(true);
			for (const index of solver.unsolved.keys()) {
				expect(rootProcessed.has(index)).toBe(true);
			}
		} finally {
			LayeredSolver.prototype.processDirtyCell = originalProcess;
		}
	});

	it('Reports progress while marking ambiguous cells', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[1], [13], [4], [9], [5, 10], [4], [3], [7], [4]];
		const solver = new LayeredSolver(tiles, grid);
		/** @type {import('./solver-layers').SolverProgress[]} */
		const calls = [];
		solver.progress_callback = (progress) => calls.push({ ...progress });
		solver.markAmbiguousTiles();
		expect(calls.length).toBeGreaterThan(0);
		for (const progress of calls) {
			expect(progress.total).toBe(9);
			expect(progress.solved).toBeGreaterThanOrEqual(0);
			expect(progress.ambiguous).toBeGreaterThanOrEqual(0);
			expect(progress.guessed).toBeGreaterThanOrEqual(0);
		}
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
			expect(step.index).toBeGreaterThanOrEqual(0);
			expect(typeof step.rotation).toBe('number');
			expect(step.rotation).toBeGreaterThanOrEqual(0);
			if (step.final) {
				finalSteps += 1;
			}
		}
		expect(stages.length).toBeGreaterThan(0);
		expect(finalSteps).toBe(9);
		expect(solver.solutions.length).toBe(1);
		const solved = applyRotations(grid, scrambled, solver.solution);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});
});

describe('Test LayeredSolver island avoidance', () => {
	it('Does not prevent solving small instances', () => {
		const grid = new SquareGrid(2, 1, false);
		const tiles = [[1], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { solvable, unique, marked, numAmbiguous } = solver.markAmbiguousTiles();
		expect(solvable).toEqual(true);
		expect(unique).toEqual(true);
		expect(marked).toEqual([0, 2]);
		expect(numAmbiguous).toEqual(0);
	});

	it('Does not prevent the final move in a larger instance', () => {
		const grid = new SquareGrid(7, 1, false);
		const tiles = [[1], [5], [5], [5], [5], [10], [1]];
		const solver = new LayeredSolver(tiles, grid);
		const { solvable, unique, marked, numAmbiguous } = solver.markAmbiguousTiles();
		expect(solvable).toEqual(true);
		expect(unique).toEqual(true);
		expect(marked).toEqual([0, 0, 0, 0, 0, 1, 2]);
		expect(numAmbiguous).toEqual(0);
	});
});

describe('Test LayeredSolver loop avoidance', () => {
	it('Forbids an orientation where a bend closes a loop', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[9], [12], [8], [3], [4, 3], [14], [1], [5], [6]];
		const solver = new LayeredSolver(tiles, grid);
		[0, 1, 3].forEach((i) => solver.dirty.add(i));
		[0, 1, 3].forEach((i) => solver.processDirtyCell(i));
		const cell = solver.getCell(4);
		expect(cell.connections).toEqual(6);
		expect(cell.walls).toEqual(0);
		expect(cell.neighbourDeadends).toEqual(0);
		solver.processDirtyCell(4);
		expect(cell.possible.size).toEqual(1);
	});
	it('Puts a wall between one-layered Ts over a U-join', () => {
		const grid = new SquareGrid(4, 3, false);
		const tiles = [[1], [13], [13], [4], [1], [14], [11], [4], [1], [6], [3], [4]];
		const solver = new LayeredSolver(tiles, grid);
		const cell6 = solver.getCell(6);
		[1, 2, 5, 6].forEach((i) => solver.dirty.add(i));
		[1, 2, 5, 6].forEach((i) => solver.processDirtyCell(i));
		expect(cell6.possible.size).toEqual(1);
		expect(cell6.connections).toEqual(11);
		expect(cell6.walls).toEqual(4);
	});
	it('Prunes a bend+deadend orientation paired with a T over a U-join', () => {
		const grid = new SquareGrid(4, 3, false);
		const tiles = [[1], [13], [13], [4], [1], [14], [3, 8], [4], [1], [6], [3], [4]];
		const solver = new LayeredSolver(tiles, grid);
		const cell6 = solver.getCell(6);
		const cell5 = solver.getCell(5);
		[1, 2, 5].forEach((i) => solver.dirty.add(i));
		[1, 2, 5].forEach((i) => solver.processDirtyCell(i));
		solver.processDirtyCell(6);
		expect(cell6.possible.size).toEqual(2);
		expect([...cell6.possible.keys()]).toEqual([0, 2]);
	});
});
