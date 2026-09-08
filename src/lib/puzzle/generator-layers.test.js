import { describe, expect, it } from 'vitest';
import {
	LayeredGenerator,
	applyRotations,
	buildStartLayers,
	planReuse,
	pregenerate_layers,
	randomRotate,
	validateLayers
} from './generator-layers';
import { SquareGrid } from './grids/squaregrid';
import { HexaGrid } from './grids/hexagrid';
import { LayeredPipesGame } from './game-layers.svelte';
import { LayeredSolver } from './solver-layers';

const LETTERS = { 1: 'E', 2: 'N', 4: 'W', 8: 'S' };

/**
 * Applies growth events to a layers board, mirroring the page's animation
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {Number[][]} board
 * @param {import('./generator-layers').GrowthMove[]} moves
 */
function applyGrowthMoves(grid, board, moves) {
	for (const move of moves) {
		if (move.type === 'seed') {
			board[move.cell] = [...move.layers];
		} else if (move.type === 'erase') {
			board[move.cell] = [];
		} else if (move.type === 'move') {
			const back = grid.OPPOSITE.get(move.direction) || 0;
			board[move.fromNode][move.layerIndex] |= move.direction;
			board[move.neighbour].push(back);
		} else if (move.type === 'absorb') {
			const back = grid.OPPOSITE.get(move.direction) || 0;
			board[move.fromNode][move.layerIndex] |= move.direction;
			board[move.neighbour][0] |= back;
		}
	}
}

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
							const layers = pregenerate_layers(grid, 1.0, branchingAmount, avoidObvious);
							validateLayers(grid, layers);
							expect(layers.length).toBe(grid.total);
						}
					}
				);
			}
		}
	}
});

describe('Test branchingAmount knob', () => {
	/**
	 * Counts the set bits in a mask
	 * @param {Number} mask
	 * @returns {Number}
	 */
	function countConnections(mask) {
		let bits = mask;
		let count = 0;
		while (bits > 0) {
			bits ^= bits & -bits;
			count += 1;
		}
		return count;
	}

	/**
	 * Fraction of deadend sub-cells (at most one connection) over all sub-cells
	 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 * @param {Number} branchingAmount
	 * @returns {Number}
	 */
	function deadendRatio(grid, branchingAmount) {
		let deadends = 0;
		let subCells = 0;
		for (let i = 0; i < 20; i++) {
			const layers = pregenerate_layers(grid, 0.6, branchingAmount);
			for (const cellLayers of layers) {
				for (const layer of cellLayers) {
					subCells += 1;
					if (countConnections(layer) <= 1) {
						deadends += 1;
					}
				}
			}
		}
		return deadends / subCells;
	}

	it('Pregenerates valid boards with default layering across the branching range', () => {
		const grids = [
			new SquareGrid(5, 5, false),
			new SquareGrid(4, 4, true),
			new HexaGrid(4, 3, false)
		];
		for (const grid of grids) {
			for (const branchingAmount of [0, 0.5, 1]) {
				for (let i = 0; i < 10; i++) {
					const layers = pregenerate_layers(grid, 0.6, branchingAmount);
					validateLayers(grid, layers);
				}
			}
		}
	});

	it('Low branching amounts produce fewer deadends than high ones', () => {
		const grids = [new SquareGrid(7, 7, false), new HexaGrid(5, 4, false)];
		for (const grid of grids) {
			const extending = deadendRatio(grid, 0);
			const branching = deadendRatio(grid, 1);
			// measured spread: square ~27% vs ~40%, hex ~18% vs ~62%
			expect(branching - extending).toBeGreaterThan(0.05);
		}
	});

	it('Mirrors growth events at both branching extremes with reuse', () => {
		const grid = new SquareGrid(4, 4, false);
		const tiles0 = pregenerate_layers(grid, 0.6, 0.5);
		const solver = new LayeredSolver(tiles0, grid);
		const { marked } = solver.markAmbiguousTiles();
		const startLayers = buildStartLayers(grid, tiles0, marked);
		for (const branchingAmount of [0, 1]) {
			for (let i = 0; i < 5; i++) {
				/** @type {import('./generator-layers').GrowthMove[]} */
				const moves = [];
				const tiles = pregenerate_layers(grid, 0.6, branchingAmount, 0, startLayers, 3, (move) =>
					moves.push(move)
				);
				/** @type {Number[][]} */
				const board = Array.from({ length: grid.total }, () => []);
				applyGrowthMoves(grid, board, moves);
				expect(board).toStrictEqual(tiles);
				validateLayers(grid, tiles);
			}
		}
	});
});

describe('Test layered scrambling', () => {
	it('Scrambled boards keep their shape', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(5, 5, false);
			const solved = pregenerate_layers(grid, 1.0, 0.5);
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
		const solved = pregenerate_layers(grid, 1.0, 0.5);
		const scrambled = randomRotate(solved, grid);
		const changed = scrambled.filter((cellLayers, index) =>
			cellLayers.some((layer, layerIndex) => layer !== solved[index][layerIndex])
		);
		expect(changed.length).toBeGreaterThan(0);
	});

	it('Scrambled board can be solved by rotating cells back', () => {
		const grid = new SquareGrid(4, 4, false);
		const solved = pregenerate_layers(grid, 1.0, 0.5);
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

	it('Produces single-layer classic boards with layeringAmount 0', () => {
		for (let i = 0; i < 20; i++) {
			const grid = i % 2 === 0 ? new SquareGrid(5, 4, i % 4 === 0) : new HexaGrid(4, 3, false);
			const tiles = pregenerate_layers(grid, 0, Math.random());
			for (let cell = 0; cell < grid.total; cell++) {
				if (grid.emptyCells.has(cell)) {
					continue;
				}
				expect(tiles[cell].length, `cell ${cell} layer count`).toBe(1);
			}
			validateLayers(grid, tiles);
		}
	});

	it('Produces multi-layer boards with layeringAmount 1', () => {
		const grid = new SquareGrid(5, 5, false);
		let multiLayerSeen = false;
		for (let i = 0; i < 10 && !multiLayerSeen; i++) {
			const tiles = pregenerate_layers(grid, 1, Math.random());
			multiLayerSeen = tiles.some((cellLayers) => cellLayers.length > 1);
		}
		expect(multiLayerSeen).toBe(true);
	});
});

describe('Test layered startLayers reuse', () => {
	/**
	 * Checks that some layer of the cell covers all the given direction bits
	 * @param {Number[]} cellLayers
	 * @param {Number} bits - direction bitmask
	 */
	function hasLayerWithBits(cellLayers, bits) {
		return cellLayers.some((layer) => (layer & bits) === bits);
	}

	it('Reuses non-ambiguous regions and produces valid boards', () => {
		// fuzz startLayers with messy component topologies:
		// randomly nulled cells create small components, conflicts,
		// cells shared by several components and dissolved layers
		for (let i = 0; i < 150; i++) {
			const wrap = i % 3 === 0;
			const grid = i % 5 === 0 ? new HexaGrid(3, 4, wrap) : new SquareGrid(4, 4, wrap);
			const tiles = pregenerate_layers(grid, 1 - Math.random(), Math.random());
			const solver = new LayeredSolver(tiles, grid);
			const { marked } = solver.markAmbiguousTiles();
			const startLayers = buildStartLayers(grid, tiles, marked);
			for (let cell = 0; cell < grid.total; cell++) {
				if (startLayers[cell] && Math.random() < 0.4) {
					startLayers[cell] = null;
				}
			}
			const regenerated = pregenerate_layers(
				grid,
				1 - Math.random(),
				Math.random(),
				0,
				startLayers,
				[1, 2, 3, 5][i % 4]
			);
			validateLayers(grid, regenerated);
			// fate accounting: every keepable sub-cell ends up in exactly one bucket
			const { stats: s } = planReuse(grid, startLayers, [1, 2, 3, 5][i % 4]);
			expect(
				s.liveSubCells +
					s.islandSubCells +
					s.conflictLostSubCells +
					s.fragmentLostSubCells +
					s.tooSmallLostSubCells
			).toBe(s.keepableSubCells);
		}
	});

	it('Reproduces a fully keepable board verbatim', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(5, 5, false);
			const tiles = pregenerate_layers(grid, 1 - Math.random(), Math.random());
			const regenerated = pregenerate_layers(grid, 1.0, 0.5, 0, tiles);
			validateLayers(grid, regenerated);
			expect(regenerated).toStrictEqual(tiles);
		}
	});

	it('Reproduces the rotated solution when no cell is ambiguous', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(4, 4, false);
			const tiles = pregenerate_layers(grid, 1 - Math.random(), Math.random());
			const solver = new LayeredSolver(tiles, grid);
			const { marked, numAmbiguous } = solver.markAmbiguousTiles();
			const startLayers = buildStartLayers(grid, tiles, marked);
			const regenerated = pregenerate_layers(grid, 1.0, 0.5, 0, startLayers);
			validateLayers(grid, regenerated);
			if (numAmbiguous === 0) {
				expect(regenerated).toStrictEqual(applyRotations(grid, tiles, marked));
			}
		}
	});

	it('Absorbs dormant islands with their internal edges preserved', () => {
		const grid = new SquareGrid(3, 3, false);
		// live region: top row (cell 1 is a straight);
		// dormant island: bottom row; middle row is ambiguous
		const startLayers = [[1], [5], [4], null, null, null, [1], [5], [4]];
		for (let i = 0; i < 20; i++) {
			const regenerated = pregenerate_layers(
				grid,
				1 - Math.random(),
				Math.random(),
				0,
				startLayers
			);
			validateLayers(grid, regenerated);
			for (let [cell, bits] of [
				[0, 1],
				[1, 5],
				[2, 4],
				[6, 1],
				[7, 5],
				[8, 4]
			]) {
				expect(hasLayerWithBits(regenerated[cell], bits)).toBe(true);
			}
		}
	});

	it('Drops layers that only connect to ambiguous cells', () => {
		const grid = new SquareGrid(3, 3, false);
		// cell 0 has two layers: [1] pointing at ambiguous cell 1
		// (dissolves) and [8] pointing at keepable cell 3 (live seed)
		const startLayers = [[1, 8], null, null, [2], null, null, null, null, null];
		for (let i = 0; i < 20; i++) {
			const regenerated = pregenerate_layers(
				grid,
				1 - Math.random(),
				Math.random(),
				0,
				startLayers
			);
			validateLayers(grid, regenerated);
			expect(hasLayerWithBits(regenerated[0], 8)).toBe(true);
			expect(hasLayerWithBits(regenerated[3], 2)).toBe(true);
		}
	});

	it('Dissolves islands that share a cell with another reused component', () => {
		const grid = new SquareGrid(3, 3, false);
		// live region: 0-1-4 (cell 1 is a corner);
		// island {4/L1, 5} shares cell 4 with live and dissolves;
		// island {6, 7, 8} is conflict-free and gets absorbed
		const startLayers = [[1], [12], null, null, [2, 1], [4], [1], [5], [4]];
		for (let i = 0; i < 20; i++) {
			const regenerated = pregenerate_layers(
				grid,
				1 - Math.random(),
				Math.random(),
				0,
				startLayers
			);
			validateLayers(grid, regenerated);
			for (let [cell, bits] of [
				[0, 1],
				[1, 12],
				[4, 2],
				[6, 1],
				[7, 5],
				[8, 4]
			]) {
				expect(hasLayerWithBits(regenerated[cell], bits)).toBe(true);
			}
		}
		// with a higher minimum size the bottom island dissolves too
		const regenerated = pregenerate_layers(grid, 1.0, 0.5, 0, startLayers, 4);
		validateLayers(grid, regenerated);
	});

	it('Treats unusable startLayers as a fresh board', () => {
		const grid = new SquareGrid(4, 4, false);
		const allNull = Array.from({ length: grid.total }, () => null);
		for (let i = 0; i < 5; i++) {
			validateLayers(grid, pregenerate_layers(grid, 1.0, 0.5, 0, allNull));
		}
		// wrong length is ignored entirely
		validateLayers(grid, pregenerate_layers(grid, 1.0, 0.5, 0, [null]));
	});

	it('Plans live, island and dissolved roles', () => {
		const grid = new SquareGrid(3, 3, false);
		// live region 0-1-4; island {4/L1, 5} shares cell 4 with live and
		// dissolves; island {6, 7, 8} is conflict-free
		const startLayers = [[1], [12], null, null, [2, 1], [4], [1], [5], [4]];
		const plan = planReuse(grid, startLayers);
		expect(plan.cells.get(0)?.role).toBe('live');
		expect(plan.cells.get(1)?.role).toBe('live');
		expect(plan.cells.get(4)?.role).toBe('live');
		expect(plan.cells.get(5)?.role).toBe('dissolved');
		expect(plan.cells.get(6)?.role).toBe('island');
		expect(plan.cells.get(7)?.role).toBe('island');
		expect(plan.cells.get(8)?.role).toBe('island');
		expect(plan.cells.get(2)).toBeUndefined();
		// live layers are pruned to the component's edges
		expect(plan.cells.get(0)?.layers).toStrictEqual([1]);
		expect(plan.cells.get(1)?.layers).toStrictEqual([12]);
		expect(plan.cells.get(4)?.layers).toStrictEqual([2]);
		// the surviving island keeps its internal skeleton
		expect(plan.cells.get(7)?.layers).toStrictEqual([5]);
		// all island cells map to the same island
		const island = plan.islands.get(6);
		expect(island).toBeDefined();
		expect([...(island || [])]).toStrictEqual([6, 7, 8]);
		expect(plan.islands.get(8)).toBe(island);
	});

	it('Reports reuse statistics', () => {
		const grid = new SquareGrid(3, 3, false);
		// live region 0-1-4; conflict-free island 6-7-8
		const noConflict = [[1], [5], [4], null, null, null, [1], [5], [4]];
		expect(planReuse(grid, noConflict).stats).toStrictEqual({
			keepableCells: 6,
			keepableSubCells: 6,
			liveCells: 3,
			liveSubCells: 3,
			islandCells: 3,
			islandSubCells: 3,
			conflictIslands: 0,
			conflictWithLive: 0,
			conflictWithIsland: 0,
			conflictLostSubCells: 0,
			conflictMaxIslandSize: 0,
			fragmentLostSubCells: 0,
			tooSmallLostSubCells: 0
		});
		// island {4/L1, 5, 8} shares cell 4 with live and is carved to {5, 8};
		// that piece is too small to keep, so only the shared sub-cell 4/L1
		// counts as conflict loss, the rest as fragment loss
		const conflict = [[1], [12], null, null, [2, 1], [12], null, null, [2]];
		expect(planReuse(grid, conflict).stats).toStrictEqual({
			keepableCells: 5,
			keepableSubCells: 6,
			liveCells: 3,
			liveSubCells: 3,
			islandCells: 0,
			islandSubCells: 0,
			conflictIslands: 1,
			conflictWithLive: 1,
			conflictWithIsland: 0,
			conflictLostSubCells: 1,
			conflictMaxIslandSize: 3,
			fragmentLostSubCells: 2,
			tooSmallLostSubCells: 0
		});
	});

	it('Carves conflicting islands around claimed cells', () => {
		const grid = new SquareGrid(5, 3, false);
		// live region: top row 0-4;
		// island A {2/L1, 7/L0, 11, 12, 13} passes through live cell 2,
		// is carved to {7, 11, 12, 13} and survives as one piece;
		// island B {5, 6, 7/L1, 8, 9} passes through island A's cell 7
		// and splits into pieces {5, 6} and {8, 9}
		const startLayers = [
			[1],
			[5],
			[5, 8],
			[5],
			[4],
			[1],
			[5],
			[10, 5],
			[5],
			[4],
			null,
			[1],
			[7],
			[4],
			null
		];
		const plan = planReuse(grid, startLayers, 2);
		expect(plan.cells.get(0)?.role).toBe('live');
		// cell 2 keeps only its live layer
		expect(plan.cells.get(2)?.role).toBe('live');
		expect(plan.cells.get(2)?.layers).toStrictEqual([5]);
		// island A keeps its internal skeleton, the carved edge to 2 is pruned
		expect(plan.cells.get(7)?.role).toBe('island');
		expect(plan.cells.get(7)?.layers).toStrictEqual([8]);
		expect(plan.cells.get(11)?.role).toBe('island');
		expect(plan.cells.get(12)?.layers).toStrictEqual([7]);
		expect(plan.cells.get(13)?.role).toBe('island');
		// island B survives as two pieces around cell 7
		expect(plan.cells.get(5)?.role).toBe('island');
		expect(plan.cells.get(6)?.role).toBe('island');
		expect(plan.cells.get(8)?.role).toBe('island');
		expect(plan.cells.get(9)?.role).toBe('island');
		// island membership: A's cells vs the two B pieces
		const pieceA = plan.islands.get(11);
		expect([...(pieceA || [])].sort((a, b) => a - b)).toStrictEqual([7, 11, 12, 13]);
		const pieceB1 = plan.islands.get(5);
		const pieceB2 = plan.islands.get(8);
		expect([...(pieceB1 || [])]).toStrictEqual([5, 6]);
		expect([...(pieceB2 || [])]).toStrictEqual([8, 9]);
		expect(plan.islands.get(6)).toBe(pieceB1);
		expect(plan.islands.get(9)).toBe(pieceB2);
		expect(plan.islands.get(7)).toBe(pieceA);
		expect(plan.stats).toStrictEqual({
			keepableCells: 13,
			keepableSubCells: 15,
			liveCells: 5,
			liveSubCells: 5,
			islandCells: 8,
			islandSubCells: 8,
			conflictIslands: 2,
			conflictWithLive: 1,
			conflictWithIsland: 1,
			conflictLostSubCells: 2,
			conflictMaxIslandSize: 5,
			fragmentLostSubCells: 0,
			tooSmallLostSubCells: 0
		});
		// carved islands still absorb and produce valid boards
		for (let i = 0; i < 20; i++) {
			validateLayers(
				grid,
				pregenerate_layers(grid, 1 - Math.random(), Math.random(), 0, startLayers, 2)
			);
		}
	});

	it('Keeps carved pieces at cell granularity (regression)', () => {
		// a component can hold several sub-cells of one cell (paths through
		// the cell); carving must assign whole cells to pieces, else two
		// pieces share a cell and the second seed overwrites the first
		const grid = new HexaGrid(3, 4, false);
		// island {7/L0, 8, 10/L0, 10/L1, 11/L0, 11/L1} passes through live
		// cell 7; cells 10 and 11 both host two of its sub-cells
		const startLayers = [
			[1],
			[24],
			[32],
			[3],
			[25],
			[12],
			[1],
			[33, 26],
			[56],
			null,
			[13, 2],
			[8, 4]
		];
		const plan = planReuse(grid, startLayers);
		expect(plan.cells.get(7)?.role).toBe('live');
		expect(plan.cells.get(8)?.role).toBe('island');
		expect(plan.cells.get(10)?.role).toBe('island');
		expect(plan.cells.get(11)?.role).toBe('island');
		// the carve splits the island into two sub-cell pieces that would
		// share cells 10 and 11; only the bigger one survives, the smaller
		// one dissolves (it cannot own the cells exclusively)
		const piece = plan.islands.get(8);
		expect(plan.islands.get(10)).toBe(piece);
		expect(plan.islands.get(11)).toBe(piece);
		expect(plan.stats.islandCells).toBe(3);
		expect(plan.stats.islandSubCells).toBe(3);
		expect(plan.stats.conflictIslands).toBe(1);
		expect(plan.stats.conflictWithLive).toBe(1);
		expect(plan.stats.conflictLostSubCells).toBe(1);
		expect(plan.stats.fragmentLostSubCells).toBe(2);
		for (let i = 0; i < 20; i++) {
			validateLayers(
				grid,
				pregenerate_layers(grid, 1 - Math.random(), Math.random(), 0, startLayers)
			);
		}
	});
});

describe('Test layered generator', () => {
	it('Generates a unique solution puzzle', () => {
		const grid = new SquareGrid(4, 4, false);
		for (let i = 0; i < 10; i++) {
			const generator = new LayeredGenerator(grid);
			const tiles = generator.generate(1.0, 0.5, 0, 'unique');
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(true);
		}
	});

	it('Generates a unique solution wrap puzzle', () => {
		const grid = new SquareGrid(5, 5, true);
		for (let i = 0; i < 3; i++) {
			const generator = new LayeredGenerator(grid);
			const tiles = generator.generate(1.0, 0.5, 0, 'unique');
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(true);
		}
	});

	it('Generates a unique solution hexagonal puzzle', () => {
		const grid = new HexaGrid(4, 6, false);
		for (let i = 0; i < 5; i++) {
			const generator = new LayeredGenerator(grid);
			const tiles = generator.generate(1.0, 0.5, 0, 'unique');
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(true);
		}
	});

	it('Generates a puzzle without uniqueness check', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid);
		const tiles = generator.generate(1.0, 0.5, 0, 'whatever');
		tiles.forEach((cellLayers) => {
			expect(cellLayers.length).toBeGreaterThan(0);
		});
	});

	it('Generates a puzzle with multiple solutions', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid, 3, 5, 100);
		/** @type {Number[][]|null} */
		let tiles = null;
		for (let attempt = 0; attempt < 5 && tiles === null; attempt++) {
			try {
				tiles = generator.generate(1.0, 0.5, 0, 'multiple');
			} catch {
				// occasionally no multiple-solution board is found, retry
			}
		}
		if (tiles !== null) {
			const solver = new LayeredSolver(tiles, grid);
			expect(solver.markAmbiguousTiles().unique).toBe(false);
		}
	});

	it('Reports progress and rejects unknown settings', () => {
		const grid = new SquareGrid(3, 3, false);
		/** @type {import('./generator-layers').GeneratorProgress[]} */
		const generatorProgress = [];
		/** @type {import('./solver-layers').SolverProgress[]} */
		const solverProgress = [];
		/** @param {import('./solver-layers').SolverProgress} progress */
		const onSolverProgress = (progress) => solverProgress.push(progress);
		/** @param {import('./generator-layers').GeneratorProgress} progress */
		const onGeneratorProgress = (progress) => generatorProgress.push(progress);
		const generator = new LayeredGenerator(
			grid,
			3,
			5,
			10,
			10,
			0,
			onSolverProgress,
			onGeneratorProgress
		);
		generator.generate(1.0, 0.5, 0, 'unique');
		expect(generatorProgress.length).toBeGreaterThan(0);
		expect(solverProgress.length).toBeGreaterThan(0);
		expect(() => generator.generate(1.0, 0.5, 0, /** @type {any} */ ('bogus'))).toThrow(
			'Unknown setting for solutionsNumber'
		);
	});
});

describe('Test layered generation worker', () => {
	it('Answers a generate command with generated tiles', async () => {
		// shim the web worker globals before importing the worker module
		/** @type {{msg: string, tiles?: Number[][]}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		globalAny.onmessage = null;
		await import('./worker-layers.js');

		const grid = new SquareGrid(4, 4, false);
		/** @type {any} */
		const event = {
			data: {
				command: 'generate',
				grid: grid.export(),
				options: { branchingAmount: 0.5, avoidObvious: 0, solutionsNumber: 'unique' }
			}
		};
		globalAny.onmessage(event);
		expect(messages.length).toBeGreaterThan(0);
		const generated = messages.find((message) => message.msg === 'generated');
		expect(generated?.tiles?.length).toBe(grid.total);
		// the board is scrambled: solve it back to verify uniqueness
		const tiles = /** @type {Number[][]} */ (generated?.tiles);
		const solver = new LayeredSolver(tiles, grid);
		expect(solver.markAmbiguousTiles().unique).toBe(true);
	});

	it('Answers an unknown solutionsNumber with an error message', async () => {
		/** @type {{msg: string, error?: any}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		const grid = new SquareGrid(3, 3, false);
		/** @type {any} */
		const event = {
			data: {
				command: 'generate',
				grid: grid.export(),
				options: {
					branchingAmount: 0.5,
					avoidObvious: 0,
					solutionsNumber: /** @type {any} */ ('bogus')
				}
			}
		};
		globalAny.onmessage(event);
		expect(messages.some((message) => message.msg === 'error')).toBe(true);
	});

	it('Rejects debug-step before debug-start', async () => {
		/** @type {{msg: string}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		globalAny.onmessage({ data: { command: 'debug-step' } });
		expect(messages.at(-1)?.msg).toBe('error');
	});

	it('Steps through debug iterations until done', async () => {
		/** @type {{msg: string, tiles?: Number[][], marked?: Number[], unique?: boolean}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		const grid = new SquareGrid(4, 4, false);
		globalAny.onmessage({
			data: {
				command: 'debug-start',
				grid: grid.export(),
				options: { branchingAmount: 0.5, avoidObvious: 0, solutionsNumber: 'unique' }
			}
		});
		expect(messages.at(-1)?.msg).toBe('debug-ready');

		let iterations = 0;
		let sawUnique = false;
		while (iterations < 500) {
			const producedFrom = messages.length;
			globalAny.onmessage({ data: { command: 'debug-step' } });
			const produced = messages.slice(producedFrom);
			expect(
				produced.some((message) => ['iteration', 'debug-done', 'error'].includes(message.msg))
			).toBe(true);
			const iteration = produced.find((message) => message.msg === 'iteration');
			if (iteration) {
				iterations += 1;
				expect(iteration.tiles?.length).toBe(grid.total);
				expect(iteration.marked?.length).toBe(grid.total);
				sawUnique = sawUnique || iteration.unique === true;
			}
			if (produced.some((message) => message.msg === 'debug-done')) {
				break;
			}
		}
		expect(iterations).toBeGreaterThan(0);
		// the loop stops right after a unique iteration
		expect(sawUnique).toBe(true);
		expect(messages.at(-1)?.msg).toBe('debug-done');
	});

	it('Reports the true ambiguity count for the last debug board', async () => {
		/** @type {{msg: string, numAmbiguous?: Number}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		const grid = new SquareGrid(4, 4, false);
		globalAny.onmessage({
			data: {
				command: 'debug-start',
				grid: grid.export(),
				options: { branchingAmount: 0.5, avoidObvious: 0, solutionsNumber: 'unique' }
			}
		});
		globalAny.onmessage({ data: { command: 'debug-step' } });
		const iteration = /** @type {{msg: string, tiles?: Number[][]}} */ (
			messages.find((message) => message.msg === 'iteration')
		);
		expect(iteration?.tiles?.length).toBe(grid.total);
		globalAny.onmessage({ data: { command: 'debug-true-count' } });
		expect(messages.at(-1)?.msg).toBe('true-count');
		expect(messages.at(-1)?.numAmbiguous).toBeGreaterThanOrEqual(0);
	});

	it('Streams growth events on growth-start', async () => {
		/** @type {{msg: string, move?: any, tiles?: Number[][]}[]} */
		const messages = [];
		/** @type {any} */
		const globalAny = globalThis;
		globalAny.postMessage = (/** @type {any} */ message) => messages.push(message);
		await import('./worker-layers.js');

		const grid = new SquareGrid(3, 3, false);
		globalAny.onmessage({
			data: {
				command: 'growth-start',
				grid: grid.export(),
				options: { branchingAmount: 0.5, avoidObvious: 0 }
			}
		});
		const moveMessages = messages.filter((message) => message.msg === 'growth-move');
		expect(moveMessages.length).toBeGreaterThan(0);
		const done = /** @type {{msg: string, tiles?: Number[][]}|undefined} */ (
			messages.find((message) => message.msg === 'growth-done')
		);
		expect(done?.tiles?.length).toBe(grid.total);
		// applying the streamed events reproduces the grown board exactly
		/** @type {Number[][]} */
		const board = Array.from({ length: grid.total }, () => []);
		applyGrowthMoves(
			grid,
			board,
			moveMessages.map((message) => message.move)
		);
		expect(board).toStrictEqual(done?.tiles);
	});
});

describe('Test layered growth events', () => {
	it('Mirrors board mutations in growth events', () => {
		for (let i = 0; i < 10; i++) {
			const grid = new SquareGrid(4, 4, false);
			/** @type {import('./generator-layers').GrowthMove[]} */
			const moves = [];
			const tiles = pregenerate_layers(grid, 1 - Math.random(), Math.random(), 0, [], 3, (move) =>
				moves.push(move)
			);
			expect(moves.length).toBeGreaterThan(0);
			/** @type {Number[][]} */
			const board = Array.from({ length: grid.total }, () => []);
			applyGrowthMoves(grid, board, moves);
			expect(board).toStrictEqual(tiles);
		}
	});

	it('Mirrors growth events with startLayers reuse', () => {
		const grid = new SquareGrid(4, 4, false);
		const tiles0 = pregenerate_layers(grid, 1.0, 0.5);
		const solver = new LayeredSolver(tiles0, grid);
		const { marked } = solver.markAmbiguousTiles();
		const startLayers = buildStartLayers(grid, tiles0, marked);
		for (let i = 0; i < 10; i++) {
			/** @type {import('./generator-layers').GrowthMove[]} */
			const moves = [];
			const tiles = pregenerate_layers(
				grid,
				1 - Math.random(),
				Math.random(),
				0,
				startLayers,
				3,
				(move) => moves.push(move)
			);
			/** @type {Number[][]} */
			const board = Array.from({ length: grid.total }, () => []);
			applyGrowthMoves(grid, board, moves);
			expect(board).toStrictEqual(tiles);
		}
	});
});

describe('Test layered uniqueIterations', () => {
	it('Yields valid iteration snapshots and stops after a unique one', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid, 3, 2, 5, 10);
		let steps = 0;
		for (const step of generator.uniqueIterations(1.0, 0.5, 0)) {
			steps += 1;
			expect(step.attempt).toBeGreaterThan(0);
			expect(step.iteration).toBeGreaterThan(0);
			validateLayers(grid, step.tiles);
			expect(step.marked.length).toBe(grid.total);
			expect(step.numAmbiguous).toBeGreaterThanOrEqual(0);
			expect(step.keptCount).toBeGreaterThanOrEqual(0);
			expect(step.elapsedMs).toBeGreaterThanOrEqual(0);
			if (steps === 1) {
				expect(step.keptCount).toBe(0);
			}
			if (step.unique) {
				const solver = new LayeredSolver(step.tiles, grid);
				expect(solver.markAmbiguousTiles().unique).toBe(true);
			}
			expect(steps).toBeLessThan(500);
		}
		expect(steps).toBeGreaterThan(0);
	});

	it('Ends without yields when uniqueness iterations are disabled', () => {
		const grid = new SquareGrid(3, 3, false);
		const generator = new LayeredGenerator(grid, 3, 5, 3, 0);
		const steps = [...generator.uniqueIterations(1.0, 0.5, 0)];
		expect(steps.length).toBe(0);
	});

	it('Honors a custom ambiguity limit', () => {
		const grid = new SquareGrid(4, 4, false);
		const generator = new LayeredGenerator(grid, 3, 2, 5, 10);
		for (const step of generator.uniqueIterations(1.0, 0.5, 0, 1)) {
			// marking stops as soon as one ambiguity is found (or the board is unique)
			expect(step.numAmbiguous).toBeLessThanOrEqual(1);
			if (step.unique) {
				break;
			}
		}
	});
});
