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

describe('Test hexagrid layered cell constraints', () => {
	const grid = new HexaGrid(3, 3, false);

	it('Starts with correct possible states from initial layers - deadend', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		expect(cell.possible.size).toBe(6);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 3, 4, 5]));
	});

	it('Starts with correct possible states from initial layers - sharp turn', () => {
		const cell = new LayeredCell([3], grid.polygon_at(0), 0);
		expect(cell.possible.size).toBe(6);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 3, 4, 5]));
	});

	it('Starts with correct possible states from initial layers - straight', () => {
		const cell = new LayeredCell([9], grid.polygon_at(0), 0);
		expect(cell.possible.size).toBe(3);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2]));
	});

	it('Drops configurations that contradict walls - deadend', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		cell.addWall(8);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(5);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 4, 5]));
	});

	it('Drops configurations that contradict walls - straight', () => {
		const cell = new LayeredCell([9], grid.polygon_at(0), 0);
		cell.addWall(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(2);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1]));
	});

	it('Drops configurations that contradict walls - sharp turn', () => {
		const cell = new LayeredCell([3], grid.polygon_at(0), 0);
		cell.addWall(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(4);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([1, 2, 3, 4]));
	});

	it('Drops configurations that contradict connections - deadend', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		cell.addConnection(8);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(1);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([3]));
	});

	it('Drops configurations that contradict connections - straight', () => {
		const cell = new LayeredCell([9], grid.polygon_at(0), 0);
		cell.addConnection(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(1);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([2]));
	});

	it('Drops configurations that contradict connections - sharp turn', () => {
		const cell = new LayeredCell([3], grid.polygon_at(0), 0);
		cell.addConnection(2);
		cell.applyConstraints();
		expect(cell.possible.size).toBe(2);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 5]));
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

describe('Test squaregrid layered cell possible states', () => {
	const grid = new SquareGrid(3, 3, false);

	it('Deduplicates twin rotations of two opposite deadends', () => {
		const cell = new LayeredCell([1, 4], grid.polygon_at(4), 4);
		expect(cell.possible.size).toBe(2);
		expect(cell.possible.get(0)).toEqual([1, 4]);
		expect(cell.possible.get(1)).toEqual([8, 2]);
	});

	it('Deduplicates all rotations of two crossing straights', () => {
		const cell = new LayeredCell([5, 10], grid.polygon_at(4), 4);
		expect(cell.possible.size).toBe(1);
		expect(cell.possible.get(0)).toEqual([5, 10]);
	});

	it('Empty cell has a single empty state', () => {
		const cell = new LayeredCell([], grid.polygon_at(0), 0);
		expect(cell.possible.size).toBe(1);
		expect(cell.possible.get(0)).toEqual([]);
	});
});

describe('Test layered cell cloning', () => {
	const grid = new HexaGrid(1, 1, false);

	it('Makes a copy of the cell', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		const clone = cell.clone();
		expect(clone.index).toBe(cell.index);
		expect([...clone.possible.keys()]).toEqual(expect.arrayContaining([...cell.possible.keys()]));
	});

	it('Removing state from cell does not affect clone', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
		const rotations = [...cell.possible.keys()];
		const clone = cell.clone();
		cell.possible.delete(0);
		expect([...clone.possible.keys()]).toEqual(expect.arrayContaining(rotations));
		expect([...cell.possible.keys()]).toEqual(
			expect.arrayContaining(rotations.filter((x) => x !== 0))
		);
	});

	it('Removing state from clone does not affect cell', () => {
		const cell = new LayeredCell([1], grid.polygon_at(0), 0);
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
	const grid = new HexaGrid(3, 3, false);
	const tiles = [[3], [3], [3], [1], [9], [1], [3], [3], [3]];

	it('Starts with correct possible states', () => {
		const solver = new LayeredSolver(tiles, grid);
		const cell = solver.getCell(3);
		expect(cell.possible.size).toBe(5);
		expect([...cell.possible.keys()]).toEqual(expect.arrayContaining([0, 1, 2, 4, 5]));
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
		expect(emptyCell.possible.size).toBe(1);
		const fullCell = solver.getCell(6);
		expect(fullCell.connections).toBe(0);
		expect(fullCell.possible.size).toBe(1);
		expect([...solver.dirty]).toContain(5);
		expect([...solver.dirty]).toContain(6);
	});

	it('Does not add constraints to cells in a wrap puzzle', () => {
		const grid = new HexaGrid(3, 1, true);
		const solver = new LayeredSolver([[3], [3], [3]], grid);
		solver.getCell(0);
		expect(solver.dirty.size).toBe(0);
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
		expect(centerCell.possible.size).toBe(1);
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

describe('Test deadend pair facts', () => {
	it('Derives the deadends mask from layer popcounts', () => {
		const grid = new SquareGrid(3, 3, false);
		const polygon = grid.polygon_at(4);
		// two deadend layers: every used direction is always used via a deadend
		const deadendCell = new LayeredCell([2, 1], polygon, 4);
		deadendCell.applyConstraints();
		expect(deadendCell.deadends).toBe(polygon.fully_connected);
		// mixed cell: every direction is also used via a busier layer somewhere
		const mixedCell = new LayeredCell([2, 9], polygon, 4);
		mixedCell.applyConstraints();
		expect(mixedCell.deadends).toBe(0);
	});

	it('Prunes pictures answering neighbour deadend facts by mass', () => {
		const grid = new SquareGrid(3, 3, false);
		const polygon = grid.polygon_at(4);
		// [2, 9]: N via the deadend layer in picture rotation 0
		const cell = new LayeredCell([2, 9], polygon, 4);
		cell.addNeighbourDeadend(2, { mass: 1, ref: undefined });
		cell.applyConstraints(9);
		// the pure deadend answer seals 2 < 9 sub-cells: gone, while the
		// two-connection north user [4, 3] survives
		expect(cell.possible.has(0)).toBe(false);
		expect(cell.possible.has(3)).toBe(true);
		// a mass that makes the sealed area the whole board withholds the
		// prune: the answer may be the final move completing the tree
		const boundary = new LayeredCell([2, 9], polygon, 4);
		boundary.addNeighbourDeadend(2, { mass: 8, ref: undefined });
		boundary.applyConstraints(9);
		expect(boundary.possible.has(0)).toBe(true);
		// ...and once the board grows, the same fact prunes again
		const bigger = new LayeredCell([2, 9], polygon, 4);
		bigger.addNeighbourDeadend(2, { mass: 8, ref: undefined });
		bigger.applyConstraints(10);
		expect(bigger.possible.has(0)).toBe(false);
	});

	it('Transfers neighbour deadend facts through a bend', () => {
		const grid = new SquareGrid(3, 3, false);
		const polygon = grid.polygon_at(4);
		// bend E+N: both east and west neighbours are deadends, so every
		// surviving picture uses N and S via layers whose other direction
		// faces a deadend - the bend becomes an effective deadend at N and S
		const cell = new LayeredCell([3], polygon, 4);
		cell.addNeighbourDeadend(1, { mass: 1, ref: undefined });
		cell.addNeighbourDeadend(4, { mass: 1, ref: undefined });
		const { addedDeadends } = cell.applyConstraints(9);
		expect(addedDeadends).toBe(2 | 8);
		// the pushed masses cover the worst picture: if the neighbour above
		// answers N with its own deadend, the sealed area is the answerer
		// (1) + the bend + the mass-1 fact behind E or W => pushed mass 2
		expect(cell.ownDeadendMass(2)).toBe(2);
		expect(cell.ownDeadendMass(8)).toBe(2);
	});

	it('Computes pushed deadend masses along a corridor', () => {
		const grid = new SquareGrid(3, 1, false);
		const polygon = grid.polygon_at(1);
		// straight E+W with a mass-2 deadend fact from the west: the east
		// direction becomes an effective deadend carrying that mass forward
		const cell = new LayeredCell([5], polygon, 1);
		cell.addNeighbourDeadend(4, { mass: 2, ref: undefined });
		const { addedDeadends } = cell.applyConstraints(9);
		expect(addedDeadends).toBe(1);
		expect(cell.ownDeadendMass(1)).toBe(3);
	});

	it('Clones the deadends mask and neighbour deadend facts', () => {
		const grid = new SquareGrid(3, 3, false);
		const cell = new LayeredCell([2, 1], grid.polygon_at(4), 4);
		cell.applyConstraints(9);
		cell.addNeighbourDeadend(4, { mass: 2, ref: undefined });
		const clone = cell.clone();
		expect(clone.deadends).toBe(cell.deadends);
		expect(clone.layerPopcounts).toEqual(cell.layerPopcounts);
		expect(clone.neighbourDeadends).toBe(cell.neighbourDeadends);
		expect(clone.neighbourDeadendMass.get(4)?.mass).toBe(2);
		// the mass map must not be shared: raising a fact on the clone
		// leaves the original untouched
		clone.addNeighbourDeadend(4, { mass: 5, ref: undefined });
		expect(cell.neighbourDeadendMass.get(4)?.mass).toBe(2);
	});

	it('Does not report phantom deadend additions after a picture set replacement', () => {
		// Regression: the deadends mask is not monotone under picture set
		// replacement (short trial probes), so the delta must be a bit
		// intersection, not numeric subtraction. Stale bits used to come
		// back as phantom additions and unsoundly prune true pictures.
		const grid = new SquareGrid(3, 3, false);
		const polygon = grid.polygon_at(4);
		// layers [S, W, E+N]: rotations put the two deadend layers on
		// different direction pairs, so the full picture set derives no
		// deadend facts at all
		const cell = new LayeredCell([8, 4, 3], polygon, 4);
		expect(cell.deadends).toBe(0);
		// survivor [1, 2, 12]: E and N are used via the two-connection layer:
		// only E and N are (always) used via a deadend among the survivors
		cell.possible = new Map([[2, [2, 1, 12]]]);
		cell.applyConstraints();
		expect(cell.deadends).toBe(3);
		// replace the set wholesale, like a short trial probe does:
		// the only survivor uses S and W via their deadend layers
		cell.possible = new Map([[0, [8, 4, 3]]]);
		const deltas = cell.applyConstraints();
		expect(cell.deadends).toBe(12);
		// numeric subtraction would return 12 - 3 = 9: phantom E, missing W
		expect(deltas.addedDeadends).toBe(12);
	});

	it('Prunes neighbour pictures answering a deadend with a deadend', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [
			[1],
			[8, 5], // cell 1: deadend layer south towards the centre
			[12],
			[9],
			[2, 9], // centre: answers north via a deadend in picture [2, 9]
			[14],
			[3],
			[5],
			[6]
		];
		const solver = new LayeredSolver(tiles, grid);
		solver.dirty.add(1);
		// stop when the centre itself gets processed: the deadend fact is
		// stored on it and prunes its pictures in its own constraint pass
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 4) {
				break;
			}
		}
		const centre = solver.getCell(4);
		// the deadend answer must be gone while the two-connection
		// north user [4, 3] survives
		expect(centre.possible.has(0)).toBe(false);
		expect(centre.possible.has(3)).toBe(true);
	});

	it('Detects a deadend pair against a pinned cell', () => {
		const grid = new SquareGrid(3, 3, false);
		const tiles = [[5], [8, 1], [5], [5], [2, 9], [5], [5], [5], [5]];
		const solver = new LayeredSolver(tiles, grid);
		// pin the centre cell to its deadend answer
		const centre = solver.getCell(4);
		centre.possible = new Map([[0, [2, 9]]]);
		solver.dirty.add(4);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 4) {
				break;
			}
		}
		// processing cell 1 must run into the sealed deadend pair
		solver.dirty.add(1);
		expect(() => {
			for (const _ of solver.processDirtyCells()) {
			}
		}).toThrow();
	});

	it('Keeps valid boards solvable with the deadend pair rule', () => {
		const grids = [
			new SquareGrid(3, 3, false),
			new SquareGrid(4, 4, false),
			new HexaGrid(3, 3, false)
		];
		for (const grid of grids) {
			for (let i = 0; i < 10; i++) {
				const layers = pregenerate_layers(grid, 0.6, Math.random(), Math.random() * 0.5);
				validateLayers(grid, layers);
				const scrambled = randomRotate(layers, grid);
				const solver = new LayeredSolver(scrambled, grid);
				const result = solver.markAmbiguousTiles();
				expect(result.solvable).toBe(true);
				expect(result.complete).toBe(true);
			}
		}
	});

	it('Solves a 1x2 pair of deadends - the final move seals the board', () => {
		const grid = new SquareGrid(2, 1, false);
		const solver = new LayeredSolver([[1], [4]], grid);
		const result = solver.markAmbiguousTiles();
		expect(result.solvable).toBe(true);
		expect(result.complete).toBe(true);
		expect(result.unique).toBe(true);
		const solved = applyRotations(grid, [[1], [4]], solver.solution);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});

	it('Solves a corridor that chains deadend facts to the last tile', () => {
		// the chained facts reach the right deadend with a sealed mass of 6
		// (five straights transfer it, one hop each); the pair rule used to
		// throw NoOrientationsPossible here once the board passed the old
		// static gate, because sealing the corridor would be the whole tree
		const grid = new SquareGrid(7, 1, false);
		const tiles = [[1], [5], [5], [5], [5], [5], [4]];
		const solver = new LayeredSolver(tiles, grid);
		const result = solver.markAmbiguousTiles();
		expect(result.solvable).toBe(true);
		expect(result.complete).toBe(true);
		expect(result.unique).toBe(true);
		const solved = applyRotations(grid, tiles, solver.solution);
		expect(() => validateLayers(grid, solved)).not.toThrow();
	});
});

describe('Test component pruning against open neighbours', () => {
	//  0    1    2    3
	//  4    5    6    7
	//  8    9   10   11
	// A1 = cell 5 and A2 = cell 6 sit above the pinned pair P1 = cell 9 and
	// P2 = cell 10: both pins point north into them, so an A1-A2 edge would
	// close a cycle through the pinned pair
	const grid = new SquareGrid(4, 3, false);
	const tiles = (a2) => [[2], [2], [2], [2], [2], a2, [3], [2], [2], [3], [3], [2]];

	function pinU(solver) {
		// pin P1 to the N+E bend, P2 to the N+W bend: the W answer merges
		// both pins into one component
		solver.getCell(9).possible = new Map([[0, [3]]]);
		solver.dirty.add(9);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 9) break;
		}
		solver.dirty.delete(9);
		solver.getCell(10).possible = new Map([[3, [6]]]);
		solver.dirty.add(10);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 10) break;
		}
		solver.dirty.delete(10);
	}

	it('Prunes the loop-closing candidate against a resolved open neighbour', () => {
		const solver = new LayeredSolver(tiles([3]), grid);
		pinU(solver);
		// process only A1: A2 is still open, one-layered and linked, so A1's
		// east direction resolves to the shared component and the S+E bend
		// must be pruned, leaving the west exit
		solver.dirty.clear();
		solver.dirty.add(5);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 5) break;
		}
		expect(solver.solution[5]).toBe(2);
	});

	it('Keeps the loop-closing candidate while the far pin is missing', () => {
		const solver = new LayeredSolver(tiles([3]), grid);
		// pin P1 only: A2 has no pinned link and no destiny, so A1's east
		// direction resolves to nothing and the S+E bend stays alive
		solver.getCell(9).possible = new Map([[0, [3]]]);
		solver.dirty.add(9);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 9) break;
		}
		solver.dirty.delete(9);
		solver.dirty.clear();
		solver.dirty.add(5);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 5) break;
		}
		const A1 = solver.getCell(5);
		expect(A1.possible.size).toBe(2);
		expect(A1.possible.has(1)).toBe(true);
	});

	it('Ignores multi-layered open neighbours', () => {
		const solver = new LayeredSolver(tiles([12, 3]), grid);
		pinU(solver);
		// A2 is multi-layered: its two layers may legally connect into the
		// same component, so A1's east direction must not resolve to it
		solver.dirty.clear();
		solver.dirty.add(5);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 5) break;
		}
		const A1 = solver.getCell(5);
		expect(A1.possible.size).toBe(2);
		expect(A1.possible.has(1)).toBe(true);
	});

	it('Keeps valid boards solvable with the component prune', () => {
		const grids = [
			new SquareGrid(4, 4, false),
			new HexaGrid(3, 4, false),
			new SquareGrid(4, 3, true)
		];
		for (const g of grids) {
			for (let i = 0; i < 10; i++) {
				const layers = pregenerate_layers(g, 0.6, Math.random(), Math.random() * 0.5);
				validateLayers(g, layers);
				const scrambled = randomRotate(layers, g);
				const solver = new LayeredSolver(scrambled, g);
				const result = solver.markAmbiguousTiles();
				expect(result.solvable).toBe(true);
				expect(result.complete).toBe(true);
			}
		}
	});
});

describe('Test component pruning after late certainty', () => {
	// Same U layout as above. With maintained slot components the old
	// propagation gap is closed: when P2 pins, A2's sub-cell joins the
	// shared component and A1 is re-dirtied, so its loop-closing candidate
	// dies on the next pass
	it('Re-prunes when the certainty arrives late', () => {
		const grid = new SquareGrid(4, 3, false);
		const tiles = [[2], [2], [2], [2], [2], [3], [3], [2], [2], [3], [3], [2]];
		const solver = new LayeredSolver(tiles, grid);
		solver.getCell(9).possible = new Map([[0, [3]]]);
		solver.dirty.add(9);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 9) break;
		}
		solver.dirty.delete(9);
		// A1 (cell 5) processes while A2 (cell 6) is not yet linked: no prune
		solver.dirty.clear();
		solver.dirty.add(5);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 5) break;
		}
		expect(solver.getCell(5).possible.has(1)).toBe(true);
		// P2 (cell 10) pins: A2's sub-cell joins the shared component, A1 is
		// re-dirtied and the loop-closing candidate can not survive
		solver.getCell(10).possible = new Map([[3, [6]]]);
		solver.dirty.add(10);
		const A1 = solver.getCell(5);
		// P2 pins: its certain edge joins A2's sub-cell into the shared
		// component and the merge re-dirties A1
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 10) break;
		}
		const shared = solver.components.get(5);
		expect(shared).toBeDefined();
		expect(solver.components.get(6)).toBe(shared);
		// process A1 once more: the loop-closing candidate can not survive
		solver.dirty.clear();
		solver.dirty.add(5);
		for (const step of solver.processDirtyCells()) {
			if (step.cell === 5) break;
		}
		expect(A1.possible.has(1)).toBe(false);
	});
});
