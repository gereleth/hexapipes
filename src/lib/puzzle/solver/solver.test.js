import { describe, expect, it } from 'vitest';
import { EtratGrid } from '#lib/puzzle/grids/etratgrid.js';
import { HexaGrid } from '#lib/puzzle/grids/hexagrid.js';
import { OctaGrid } from '#lib/puzzle/grids/octagrid.js';
import { RhombitrihexaGrid } from '#lib/puzzle/grids/rhombitrihexagrid.js';
import { SnubSquareGrid } from '#lib/puzzle/grids/snubsquaregrid.js';
import { SquareGrid } from '#lib/puzzle/grids/squaregrid.js';
import { TriangularGrid } from '#lib/puzzle/grids/triangulargrid.js';
import { TrihexaGrid } from '#lib/puzzle/grids/trihexagrid.js';
import { Solver } from '#lib/puzzle/solver/solver.js';
import { SolverTile } from '#lib/puzzle/solver/solver-tile.js';
import {
	applyRotations,
	pregenerateForest,
	randomRotate,
	validateMulti
} from '#lib/puzzle/generator/generator-forest.js';

describe('Test SolverTile possible states initialization', () => {
	const grid = new HexaGrid(3, 3, false);
	const polygon = grid.polygonAt(0);
	it('Starts with correct possible states from initial pipes - deadend', () => {
		const tile = new SolverTile([1], polygon, 0);
		expect(tile.possible.size).toBe(6);
		expect([...tile.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 3, 4, 5]));
	});
	it('Starts with correct possible states from initial pipes - straight', () => {
		const tile = new SolverTile([9], polygon, 0);
		expect(tile.possible.size).toBe(3);
		expect(tile.possible.get(0)).toEqual([9]);
		expect(tile.possible.get(1)).toEqual([36]);
		expect(tile.possible.get(2)).toEqual([18]);
	});
	it('Starts with correct possible states from initial pipes - deadend + bend', () => {
		const tile = new SolverTile([1, 6], polygon, 0);
		expect(tile.possible.size).toBe(6);
		expect(tile.possible.get(0)).toEqual([1, 6]);
		expect(tile.possible.get(1)).toEqual([32, 3]);
		expect(tile.possible.get(2)).toEqual([16, 33]);
		expect(tile.possible.get(3)).toEqual([8, 48]);
		expect(tile.possible.get(4)).toEqual([4, 24]);
		expect(tile.possible.get(5)).toEqual([2, 12]);
	});
	it('Starts with correct possible states from initial pipes - two opposite deadends', () => {
		const tile = new SolverTile([1, 8], polygon, 0);
		expect(tile.possible.size).toBe(3);
		expect(tile.possible.get(0)).toEqual([1, 8]);
		expect(tile.possible.get(1)).toEqual([32, 4]);
		expect(tile.possible.get(2)).toEqual([16, 2]);
	});
	it('Empty tile has a single empty state', () => {
		const tile = new SolverTile([], polygon, 0);
		expect(tile.possible.size).toBe(1);
		expect(tile.possible.get(0)).toEqual([]);
	});
});
describe('Test Tile applyConstraints', () => {
	const grid = new HexaGrid(3, 3, false);
	const polygon = grid.polygonAt(0);

	it('Throws error if no orientations are possible', () => {
		const tile = new SolverTile([9, 18], polygon, 0); // two straights form an X
		tile.addWall(1 + 2);
		expect(() => tile.applyConstraints()).toThrow('No orientations possible');
	});
	it('Reports own deadends - two deadend pipes', () => {
		const tile = new SolverTile([1, 8], polygon, 0);
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(63);
	});
	it('Reports own deadends - deadend + bend', () => {
		const tile = new SolverTile([1, 6], polygon, 0);
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(0);
	});
	it('Applies wall constraint', () => {
		const tile = new SolverTile([1, 6], polygon, 0);
		tile.addWall(1);
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(tile.possible.size).toBe(3);
		expect(tile.possible.get(3)).toEqual([8, 48]);
		expect(tile.possible.get(4)).toEqual([4, 24]);
		expect(tile.possible.get(5)).toEqual([2, 12]);
		expect(addedConnections).toEqual(8);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(2);
	});
	it('Applies connection constraint', () => {
		const tile = new SolverTile([1, 6], polygon, 0);
		tile.addConnection(1);
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(tile.possible.size).toBe(3);
		expect(tile.possible.get(0)).toEqual([1, 6]);
		expect(tile.possible.get(1)).toEqual([32, 3]);
		expect(tile.possible.get(2)).toEqual([16, 33]);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(8);
		expect(addedDeadends).toEqual(16);
	});
	it('Applies neighbour deadend constraint', () => {
		const tile = new SolverTile([1, 6], polygon, 0);
		tile.addNeighbourDeadend(1, 1);
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(tile.possible.size).toBe(5);
		expect(tile.possible.get(1)).toEqual([32, 3]);
		expect(tile.possible.get(2)).toEqual([16, 33]);
		expect(tile.possible.get(3)).toEqual([8, 48]);
		expect(tile.possible.get(4)).toEqual([4, 24]);
		expect(tile.possible.get(5)).toEqual([2, 12]);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(2);
	});
	it('Applies neighbour deadend constraint - a bend must escape deadend area', () => {
		const tile = new SolverTile([3], polygon, 0);
		// direction 1 is the only escape route
		polygon.directions.forEach((d) => d === 1 || tile.addNeighbourDeadend(d, 1));
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(tile.possible.size).toBe(2);
		expect(tile.possible.get(0)).toEqual([3]);
		expect(tile.possible.get(1)).toEqual([33]);
		expect(addedConnections).toEqual(1);
		expect(addedWalls).toEqual(4 + 8 + 16);
		expect(addedDeadends).toEqual(1);
		expect(tile.ownDeadendWeights.get(1)).toEqual(2);
	});
	it('Transfers neighbour deadend constraints through itself', () => {
		const tile = new SolverTile([9], polygon, 0);
		tile.addNeighbourDeadend(1, 1);
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(tile.possible.size).toBe(3);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(0);
		expect(addedDeadends).toEqual(8);
		expect(tile.ownDeadendWeights.get(8)).toEqual(2);
	});
	it('Uses max over neighbour deadends for deriving own deadends', () => {
		const tile = new SolverTile([3], polygon, 0);
		tile.addConnection(1);
		tile.addNeighbourDeadend(2, 1);
		tile.addNeighbourDeadend(32, 5);
		const { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints();
		expect(tile.possible.size).toBe(2);
		expect(addedConnections).toEqual(0);
		expect(addedWalls).toEqual(4 + 8 + 16);
		expect(addedDeadends).toEqual(1);
		expect(tile.ownDeadendWeights.get(1)).toEqual(6);
	});
});

describe('Test SolverTile cloning', () => {
	const grid = new HexaGrid(1, 1, false);
	const polygon = grid.polygonAt(0);

	it('Makes a copy of the solver tile', () => {
		const tile = new SolverTile([1], polygon, 0);
		const clone = tile.clone();
		expect(clone.index).toBe(tile.index);
		expect([...clone.possible.keys()]).toEqual(expect.arrayContaining([...tile.possible.keys()]));
	});

	it('Removing state from parent tile does not affect clone', () => {
		const tile = new SolverTile([1], polygon, 0);
		const rotations = [...tile.possible.keys()];
		const clone = tile.clone();
		tile.possible.delete(0);
		expect([...clone.possible.keys()]).toEqual(expect.arrayContaining(rotations));
		expect([...tile.possible.keys()]).toEqual(
			expect.arrayContaining(rotations.filter((x) => x !== 0))
		);
	});

	it('Removing state from clone does not affect parent tile', () => {
		const tile = new SolverTile([1], polygon, 0);
		const rotations = [...tile.possible.keys()];
		const clone = tile.clone();
		clone.possible.delete(0);
		expect([...tile.possible.keys()]).toEqual(expect.arrayContaining(rotations));
		expect([...clone.possible.keys()]).toEqual(
			expect.arrayContaining(rotations.filter((x) => x !== 0))
		);
	});
});

describe('Test solver border constraints', () => {
	const grid = new SquareGrid(3, 3, false);
	const tiles = [[1, 8], [12], [8], [11], [6, 8], [10], [3], [7], [6]];

	it('Adds walls to border tiles', () => {
		const solver = new Solver(tiles, grid);
		let tile = solver.getTile(0);
		expect(tile.walls).toBe(6);
		tile = solver.getTile(1);
		expect(tile.walls).toBe(2);
		tile = solver.getTile(2);
		expect(tile.walls).toBe(3);
		tile = solver.getTile(7);
		expect(tile.walls).toBe(8);
		expect([...solver.dirty]).toEqual(expect.arrayContaining([0, 1, 2, 7]));
	});

	it('Adds full and empty tiles to dirty set', () => {
		const solver = new Solver([[], [9], [4, 8], [9], [15], [6], [1, 2], [6], []], grid);
		const emptyTile = solver.getTile(0);
		expect(emptyTile.walls).toBe(0);
		expect(emptyTile.possible.size).toBe(1);
		expect(solver.dirty).toContain(0);
		const fullTile = solver.getTile(4);
		expect(fullTile.connections).toBe(0);
		expect(fullTile.possible.size).toBe(1);
		expect(solver.dirty).toContain(4);
	});

	it('Does not add constraints to tiles in a wrap puzzle', () => {
		const grid = new HexaGrid(3, 1, true);
		const solver = new Solver([[3], [3], [3]], grid);
		const tile = solver.getTile(0);
		expect(tile.walls).toBe(0);
		// materialization itself always dirties the tile, even with no facts to deduce
		expect(solver.dirty).toContain(0);
	});
});

describe('Test solver cloning', () => {
	it('Clone is isolated from the original solver', () => {
		const grid = new HexaGrid(3, 1, true);
		const tiles = [[1], [9], [1]];
		const solver = new Solver(tiles, grid);
		const tile = solver.getTile(0);
		const clone = solver.clone();
		const cloneTile = clone.getTile(0);
		tile.possible.delete(0);
		tile.addWall(1);
		expect([...cloneTile.possible.keys()]).toContain(0);
		expect(cloneTile.walls).toBe(tile.walls - 1);
		cloneTile.addConnection(2);
		expect(tile.connections).toBe(0);
	});
});

describe('Test solutions check and marking ambiguous tiles', () => {
	it('Detects unsolvable puzzle - quickly from border constraints', () => {
		const grid = new HexaGrid(2, 2, false);
		const tiles = [[9], [5], [5], [3]];
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects unsolvable puzzle - after some trials', () => {
		const grid = new HexaGrid(2, 2, true);
		const tiles = [[1], [5], [5], [3]];
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects a pipe node loop that can never be a tree', () => {
		const grid = new SquareGrid(2, 2, true);
		const tiles = [[9], [12], [3], [6]];
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects a small puzzle with a unique solution', () => {
		const grid = new HexaGrid(2, 2, false);
		const tiles = [[1], [1, 2], [7], [3]];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(solved).toStrictEqual([[32], [16, 32], [7], [12]]);
	});

	it('Detects a larger puzzle with a unique solution', () => {
		const grid = new HexaGrid(2, 3, false);
		const tiles = [[3], [1], [5, 24], [3], [3], [5, 2]];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(solved).toStrictEqual([[33], [8], [20, 33], [24], [3], [10, 4]]);
	});

	it('Detects a puzzle with multiple solutions', () => {
		const grid = new HexaGrid(3, 3, false);
		const tiles = [[1], [5], [1], [1], [62], [3], [1], [5], [1]];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(false);
		const ambiguousTiles = marked
			.map((rotation, index) => (rotation === solver.AMBIGUOUS ? index : -1))
			.filter((index) => index !== -1);
		expect(ambiguousTiles).toEqual([2, 4, 5, 8]);
		const solved = applyRotations(grid, tiles, marked);
		expect([solved[0][0], solved[1][0], solved[3][0], solved[6][0], solved[7][0]]).toEqual([
			1, 40, 1, 1, 10
		]);
	});

	it('Detects a wrap puzzle with multiple solutions', () => {
		const grid = new HexaGrid(3, 3, true);
		const tiles = [[1], [3], [1], [43], [5], [5], [1], [3], [1]];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(false);
		const ambiguousTiles = marked
			.map((rotation, index) => (rotation === solver.AMBIGUOUS ? index : -1))
			.filter((index) => index !== -1);
		expect(ambiguousTiles).toEqual([2, 4, 5, 8]);
		const solved = applyRotations(grid, tiles, marked);
		expect([solved[0][0], solved[1][0], solved[3][0], solved[6][0], solved[7][0]]).toEqual([
			1, 24, 43, 1, 12
		]);
	});

	it('Detects a puzzle with an empty tile and a unique solution', () => {
		const tiles = [[3], [9], [5], [5], [], [1], [3], [9], [1]];
		const grid = new HexaGrid(3, 3, false, tiles);
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateMulti(grid, solved)).not.toThrow();
	});

	it('Detects a wrap puzzle with an empty tile and a unique solution', () => {
		const tiles = [[3], [9], [5], [5], [], [1], [3], [9], [1]];
		const grid = new HexaGrid(3, 3, true, tiles);
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateMulti(grid, solved)).not.toThrow();
	});

	it('Detects a puzzle with many empty tiles and a unique solution', () => {
		const classicTiles = [
			0, 0, 16, 1, 25, 40, 0, 0, 18, 1, 42, 16, 4, 0, 0, 18, 32, 32, 7, 25, 8, 35, 8, 20, 36, 19, 8,
			16, 0, 36, 19, 9, 62, 17, 10, 0, 6, 32, 18, 7, 8, 0, 0, 0, 1, 15, 9, 8, 0
		];
		const grid = new HexaGrid(7, 7, false, classicTiles);
		const tiles = classicTiles.map((tile) => (tile === 0 ? [] : [tile]));
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		const solved = applyRotations(grid, tiles, marked);
		expect(() => validateMulti(grid, solved)).not.toThrow();
	});
});

describe('Test solutions check and marking ambiguous tiles (classic input)', () => {
	// classic Number[] tiles through the unified class: pins the constructor's
	// one-pipe normalization and the per-tile rotation output format
	it('Detects unsolvable puzzle - quickly from border constraints', () => {
		const grid = new HexaGrid(2, 2, false);
		const tiles = [9, 5, 5, 3];
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects unsolvable puzzle - after some trials', () => {
		const grid = new HexaGrid(2, 2, true);
		const tiles = [1, 5, 5, 3];
		const solver = new Solver(tiles, grid);
		const { solvable } = solver.markAmbiguousTiles();
		expect(solvable).toBe(false);
	});

	it('Detects a small puzzle with a unique solution', () => {
		const grid = new HexaGrid(2, 2, false);
		const tiles = [1, 1, 7, 1];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		expect(marked).toStrictEqual(expect.arrayContaining([1, 2, 0, 3]));
	});

	it('Detects a larger puzzle with a unique solution', () => {
		const grid = new HexaGrid(2, 3, false);
		const tiles = [1, 1, 15, 1, 1, 3];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		expect(marked).toStrictEqual(expect.arrayContaining([1, 2, 1, 3, 0, 4]));
	});

	it('Detects a puzzle with multiple solutions', () => {
		const grid = new HexaGrid(3, 3, false);
		const tiles = [1, 5, 1, 1, 62, 3, 1, 5, 1];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(false);
		const a = solver.AMBIGUOUS;
		expect(marked).toStrictEqual(expect.arrayContaining([0, 3, a, 0, a, a, 0, 5, a]));
	});

	it('Detects a wrap puzzle with multiple solutions', () => {
		const grid = new HexaGrid(3, 3, true);
		const tiles = [1, 3, 1, 43, 5, 5, 1, 3, 1];
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(false);
		const a = solver.AMBIGUOUS;
		expect(marked).toStrictEqual(expect.arrayContaining([0, 3, a, 0, a, a, 0, 4, a]));
	});

	it('Detects a puzzle with an empty tile and a unique solution', () => {
		const tiles = [3, 9, 5, 5, 0, 1, 3, 9, 1];
		const grid = new HexaGrid(3, 3, false, tiles);
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
	});

	it('Detects a wrap puzzle with an empty tile and a unique solution', () => {
		const tiles = [3, 9, 5, 5, 0, 1, 3, 9, 1];
		const grid = new HexaGrid(3, 3, true, tiles);
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
	});

	it('Detects a puzzle with many empty tiles and a unique solution', () => {
		const tiles = [
			0, 0, 16, 1, 25, 40, 0, 0, 18, 1, 42, 16, 4, 0, 0, 18, 32, 32, 7, 25, 8, 35, 8, 20, 36, 19, 8,
			16, 0, 36, 19, 9, 62, 17, 10, 0, 6, 32, 18, 7, 8, 0, 0, 0, 1, 15, 9, 8, 0
		];
		const grid = new HexaGrid(7, 7, false, tiles);
		const solver = new Solver(tiles, grid);
		const { marked, solvable, unique } = solver.markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
	});
});

describe('Test solver emit format (classic input)', () => {
	// pins the emit format (rotation counts, not masks), not the processing order
	it('Emits rotations as steps and solutions as rotation arrays', () => {
		const grid = new HexaGrid(2, 3, false);
		const tiles = [1, 1, 15, 1, 1, 3];
		const solver = new Solver(tiles, grid);
		const finalRotations = new Map();
		for (let { stage, step } of solver.solve(true)) {
			expect(['initial', 'guess', 'aftercheck']).toContain(stage);
			// rotations stay within a tile's orbit - masks would fall outside
			expect(step.rotation).toBeGreaterThanOrEqual(0);
			expect(step.rotation).toBeLessThan(grid.polygonAt(step.index).numDirections);
			if (step.final) {
				finalRotations.set(step.index, step.rotation);
			}
		}
		expect(solver.solutions).toEqual([[1, 2, 1, 3, 0, 4]]);
		expect(finalRotations.size).toBe(tiles.length);
		for (const [index, rotation] of finalRotations) {
			expect(rotation).toBe(solver.solutions[0][index]);
		}
	});

	it('Does not report processing an empty tile as a step', () => {
		const tiles = [3, 9, 5, 5, 0, 1, 3, 9, 1];
		const grid = new HexaGrid(3, 3, false, tiles);
		const solver = new Solver(tiles, grid);
		const stepIndexes = [];
		for (let { stage, step } of solver.solve(true)) {
			stepIndexes.push(step.index);
		}
		expect(stepIndexes).not.toContain(4);
		expect(solver.solutions).toEqual([[1, 0, 3, 4, 0, 4, 0, 0, 3]]);
	});
});

describe('Test multipipes boards', () => {
	it('Finds pregenerated scrambled boards solvable', () => {
		const grids = [
			new SquareGrid(4, 4, false),
			new HexaGrid(4, 3, false),
			new SquareGrid(3, 4, true)
		];
		for (const grid of grids) {
			const tiles = pregenerateForest(grid, { sharingAmount: 1.0, branchingAmount: 0.5 });
			expect(() => validateMulti(grid, tiles)).not.toThrow();
			const scrambled = randomRotate(tiles, grid);
			const solver = new Solver(scrambled, grid);
			const { marked, solvable, unique } = solver.markAmbiguousTiles();
			expect(solvable).toBe(true);
			if (unique) {
				const solved = applyRotations(grid, scrambled, marked);
				expect(() => validateMulti(grid, solved)).not.toThrow();
			}
		}
	}, 60000);

	it('Dirty-processes every materialized tile', () => {
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
		const originalProcess = Solver.prototype.processDirtyTile;
		/** @type {Set<Number>} */
		const rootProcessed = new Set();
		Solver.prototype.processDirtyTile = function (/** @type {Number} */ index) {
			// clones materialize nothing themselves, so only root-side
			// processing matters for this invariant
			if (this.parent === null) {
				rootProcessed.add(index);
			}
			return originalProcess.call(this, index);
		};
		try {
			const solver = new Solver(tiles, grid);
			const { solvable } = solver.markAmbiguousTiles();
			expect(solvable).toBe(true);
			for (const index of solver.unsolved.keys()) {
				expect(rootProcessed.has(index)).toBe(true);
			}
		} finally {
			Solver.prototype.processDirtyTile = originalProcess;
		}
	});

	it('Reports progress while marking ambiguous tiles', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[1], [13], [4], [9], [5, 10], [4], [3], [7], [4]];
		const solver = new Solver(tiles, grid);
		/** @type {import('#lib/puzzle/solver/solver.js').SolverProgress[]} */
		const calls = [];
		solver.progressCallback = (progress) => calls.push({ ...progress });
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
		const solver = new Solver(scrambled, grid);
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
		expect(() => validateMulti(grid, solved)).not.toThrow();
	});
});

describe('Test Solver island avoidance', () => {
	it('Does not prevent solving small instances', () => {
		const grid = new SquareGrid(2, 1, false);
		const tiles = [[1], [1]];
		const solver = new Solver(tiles, grid);
		const { solvable, unique, marked, numAmbiguous } = solver.markAmbiguousTiles();
		expect(solvable).toEqual(true);
		expect(unique).toEqual(true);
		expect(marked).toEqual([0, 2]);
		expect(numAmbiguous).toEqual(0);
	});

	it('Does not prevent the final move in a larger instance', () => {
		const grid = new SquareGrid(7, 1, false);
		const tiles = [[1], [5], [5], [5], [5], [10], [1]];
		const solver = new Solver(tiles, grid);
		const { solvable, unique, marked, numAmbiguous } = solver.markAmbiguousTiles();
		expect(solvable).toEqual(true);
		expect(unique).toEqual(true);
		expect(marked).toEqual([0, 0, 0, 0, 0, 1, 2]);
		expect(numAmbiguous).toEqual(0);
	});
});

describe('Test Solver loop avoidance', () => {
	it('Forbids an orientation where a bend closes a loop', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[9], [12], [8], [3], [4, 3], [14], [1], [5], [6]];
		const solver = new Solver(tiles, grid);
		[0, 1, 3].forEach((i) => solver.dirty.add(i));
		[0, 1, 3].forEach((i) => solver.processDirtyTile(i));
		const tile = solver.getTile(4);
		expect(tile.connections).toEqual(6);
		expect(tile.walls).toEqual(0);
		expect(tile.neighbourDeadends).toEqual(0);
		solver.processDirtyTile(4);
		expect(tile.possible.size).toEqual(1);
	});
	it('Puts a wall between single-pipe Ts over a U-join', () => {
		const grid = new SquareGrid(4, 3, false);
		const tiles = [[1], [13], [13], [4], [1], [14], [11], [4], [1], [6], [3], [4]];
		const solver = new Solver(tiles, grid);
		const tile6 = solver.getTile(6);
		[1, 2, 5, 6].forEach((i) => solver.dirty.add(i));
		[1, 2, 5, 6].forEach((i) => solver.processDirtyTile(i));
		expect(tile6.possible.size).toEqual(1);
		expect(tile6.connections).toEqual(11);
		expect(tile6.walls).toEqual(4);
	});
	it('Prunes a bend+deadend orientation paired with a T over a U-join', () => {
		const grid = new SquareGrid(4, 3, false);
		const tiles = [[1], [13], [13], [4], [1], [14], [3, 8], [4], [1], [6], [3], [4]];
		const solver = new Solver(tiles, grid);
		const tile6 = solver.getTile(6);
		[1, 2, 5].forEach((i) => solver.dirty.add(i));
		[1, 2, 5].forEach((i) => solver.processDirtyTile(i));
		solver.processDirtyTile(6);
		expect(tile6.possible.size).toEqual(2);
		expect([...tile6.possible.keys()]).toEqual([0, 2]);
	});
});

describe('Test Solver on every grid kind', () => {
	it('Solves small pregenerated boards on all grid kinds', () => {
		// The component registry sizes itself from grid.DIRECTIONS (the union
		// of all direction bits); mixed grids have tiles with different
		// direction subsets, so exercise every grid kind.
		/** @type {Array<[String, () => any]>} */
		const cases = [
			['square', () => new SquareGrid(4, 4, false)],
			['square wrap', () => new SquareGrid(4, 4, true)],
			['hexagonal', () => new HexaGrid(3, 3, false)],
			['octagonal', () => new OctaGrid(4, 4, false)],
			['rhombitrihexagonal', () => new RhombitrihexaGrid(3, 3, false)],
			['trihexagonal', () => new TrihexaGrid(3, 3, false)],
			['snub square', () => new SnubSquareGrid(4, 4, false)],
			['triangular', () => new TriangularGrid(4, 4, false)],
			['etrat', () => new EtratGrid(3, 3, false)]
		];
		for (const [name, makeGrid] of cases) {
			const grid = makeGrid();
			const tiles = pregenerateForest(grid, {
				sharingAmount: 0.6,
				branchingAmount: 0.5,
				avoidObvious: 0.25
			});
			validateMulti(grid, tiles);
			const solver = new Solver(tiles, grid);
			const result = solver.markAmbiguousTiles(Math.max(100, 0.1 * grid.total));
			expect(result.solvable, `${name} board must stay solvable`).toBe(true);
		}
	});
});

describe('Test hexa/octa PipeShape deductions', () => {
	it('Sets the isMulti and hasPipeShapeTricks flags', () => {
		const grid = new HexaGrid(2, 2, false);
		expect(new Solver([1, 2, 4, 8], grid).isMulti).toBe(false);
		expect(new Solver([[1], [2], [4], [8]], grid).isMulti).toBe(false);
		expect(new Solver([[1], [2, 4], [8], [1]], grid).isMulti).toBe(true);
		expect(new Solver([[1], [2], [4], [8]], grid).hasPipeShapeTricks).toBe(true);
		expect(new Solver([[1], [2], [4], [8]], new SquareGrid(2, 2, false)).hasPipeShapeTricks).toBe(
			false
		);
	});

	it('Must connect adjacent psi-likes on a classic board', () => {
		const grid = new HexaGrid(3, 2, false);
		// pipe 23 is the psi (E, NE, NW, SW), pipe 21 is the Y (E, NW, SW) -
		// both have no adjacent walls, so tile 0 must connect east.
		const tiles = [23, 21, 9, 9, 9, 9];
		const solver = new Solver(tiles, grid);
		const tile = solver.getTile(0);
		expect(tile.possible.size).toBe(4);
		const masks = [...tile.possible.values()].map(([mask]) => mask).sort((a, b) => a - b);
		expect(masks).toEqual([23, 29, 43, 53]);
		// control: a straight neighbour is not a psi-like, nothing is forced
		const control = new Solver([23, 9, 9, 9, 9, 9], grid);
		expect(control.getTile(0).possible.size).toBe(6);
	});

	it("Can't connect middle prongs to a sharp turn on a classic board", () => {
		const grid = new HexaGrid(3, 3, false);
		// pipe 7 is a trident (E, NE, NW); the sharp pair 3 (E + NE) sits east
		// of it, so the trident occupying the whole E/NE/SE trio is out
		const tiles = [9, 9, 9, 7, 3, 9, 9, 9, 9];
		const solver = new Solver(tiles, grid);
		const tile = solver.getTile(3);
		expect(tile.possible.size).toBe(5);
		for (let pipes of tile.possible.values()) {
			// no surviving orientation connects the whole E/NE/SE trio
			expect((pipes[0] & 35) === 35).toBe(false);
		}
		// control: a straight neighbour does not trigger the deduction
		const control = new Solver([9, 9, 9, 7, 9, 9, 9, 9, 9], grid);
		expect(control.getTile(3).possible.size).toBe(6);
	});

	it("Can't connect middle prongs to a sharp turn on a classic board - with more consequences", () => {
		const grid = new HexaGrid(3, 3, true);
		// tile 5 (pipe 15) should get a connection in direction 4, away
		// from the sharp turns neighbour tile 6 (pipe 48)
		// two orientations that point middle prongs at tile 6 should be removed
		const tiles = [26, 4, 2, 2, 34, 15, 48, 4, 16];
		const solver = new Solver(tiles, grid);
		const tile = solver.getTile(5);
		expect(tile.possible.size).toBe(4);
		for (let pipes of tile.possible.values()) {
			// all survivors connect to dir 4
			expect((pipes[0] & 4) === 4).toBe(true);
		}
	});

	it('Never leaves two adjacent walls next to a psi-like union on a multipipes board', () => {
		const grid = new OctaGrid(2, 2, false);
		// tile 1 is an octagon missing only W (a psi-like union), tile 4 is a
		// square connecting NE + SW (no adjacent connections). Tile 0's union
		// is an E-W straight [17]; tile 2 holds two pipes with union 26, which
		// keeps the board mu;to without changing the unions tile 0 sees.
		// The rotation connecting SE + NW would wall off the psi-like while
		// connecting into the square, which is impossible.
		const tiles = [[17], [239], [2, 24], [17], [34], [], [], []];
		const solver = new Solver(tiles, grid);
		const tile = solver.getTile(0);
		expect(tile.possible.size).toBe(3);
		for (let pipes of tile.possible.values()) {
			// no surviving orientation connects SE without also connecting E
			expect((pipes[0] & 128) > 0 && (pipes[0] & 1) === 0).toBe(false);
		}
		// control: a non-psi-like eastern neighbour (missing W and SW, so it
		// has adjacent walls) may be walled off
		const control = new Solver([[17], [207], [2, 24], [17], [34], [], [], []], grid);
		expect(control.getTile(0).possible.size).toBe(4);
	});
});
