import { describe, expect, it } from 'vitest';
import {
	CLAIM_STATE,
	MOVE_KIND,
	TIER,
	UnionFind,
	applyForestMove,
	classifyMoveKind,
	defaultTreeCount,
	directionState,
	farthestPointSeeds,
	moveTier,
	pregenerateForest
} from '#lib/puzzle/generator/generator-forest.js';
import { computeCellObviousTiles } from '#lib/puzzle/generator/generator.js';
import { SquareGrid } from '#lib/puzzle/grids/squaregrid.js';
import { HexaGrid } from '#lib/puzzle/grids/hexagrid.js';
import { TrihexaGrid } from '#lib/puzzle/grids/trihexagrid.js';
import { SnubSquareGrid } from '#lib/puzzle/grids/snubsquaregrid.js';
import { TriangularGrid } from '#lib/puzzle/grids/triangulargrid.js';
import { popcount } from '#lib/puzzle/grids/bitmasks.js';

describe('UnionFind over pipe nodes', () => {
	it('Registers nodes as singleton components', () => {
		const uf = new UnionFind();
		expect(uf.count).toBe(0);
		expect(uf.add(5)).toBe(true);
		expect(uf.add(7)).toBe(true);
		expect(uf.count).toBe(2);
		expect(uf.find(5)).toBe(uf.find(5));
		expect(uf.find(5) === uf.find(7)).toBe(false);
	});

	it('Adding a known node again changes nothing', () => {
		const uf = new UnionFind();
		uf.add(5);
		expect(uf.add(5)).toBe(false);
		expect(uf.count).toBe(1);
	});

	it('Unions distinct components and reports one component', () => {
		const uf = new UnionFind();
		uf.add(1);
		uf.add(2);
		uf.add(3);
		expect(uf.union(1, 2)).toBe(true);
		expect(uf.count).toBe(2);
		expect(uf.union(2, 3)).toBe(true);
		expect(uf.count).toBe(1);
		expect(uf.find(1) === uf.find(2)).toBe(true);
		expect(uf.find(1) === uf.find(3)).toBe(true);
	});

	it('Refuses unions inside one component without merging', () => {
		const uf = new UnionFind();
		uf.add(1);
		uf.add(2);
		uf.add(3);
		uf.add(4);
		uf.union(1, 2);
		uf.union(3, 4);
		uf.union(2, 3);
		expect(uf.union(1, 4)).toBe(false);
		expect(uf.count).toBe(1);
	});

	it('Rejects unknown nodes', () => {
		const uf = new UnionFind();
		expect(() => uf.find(9)).toThrow();
		expect(() => uf.union(9, 10)).toThrow();
	});
});

describe('Per-direction claims', () => {
	/**
	 * An empty multipipes board for a grid
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @returns {Number[][]}
	 */
	function emptyBoard(grid) {
		return Array.from({ length: grid.total }, () => []);
	}

	it('Marks empty cells and the outside as walls, everything else free', () => {
		// 4x4 board with one empty cell in the middle, cell 5
		const tiles = Array(16).fill(1);
		tiles[5] = 0;
		const grid = new SquareGrid(4, 4, false, tiles);
		const board = emptyBoard(grid);
		// corner cell 0: E free, S free, N and W outside
		expect(directionState(grid, board, 0, 1)).toBe(CLAIM_STATE.FREE);
		expect(directionState(grid, board, 0, 8)).toBe(CLAIM_STATE.FREE);
		expect(directionState(grid, board, 0, 2)).toBe(CLAIM_STATE.WALL);
		expect(directionState(grid, board, 0, 4)).toBe(CLAIM_STATE.WALL);
		// neighbours of the empty cell see a wall towards it
		expect(directionState(grid, board, 4, 1)).toBe(CLAIM_STATE.WALL);
		expect(directionState(grid, board, 1, 8)).toBe(CLAIM_STATE.WALL);
		expect(directionState(grid, board, 6, 4)).toBe(CLAIM_STATE.WALL);
		expect(directionState(grid, board, 9, 2)).toBe(CLAIM_STATE.WALL);
		// inner cell 10 away from the hole is fully free
		for (const direction of grid.polygonAt(10).directions) {
			expect(directionState(grid, board, 10, direction)).toBe(CLAIM_STATE.FREE);
		}
	});

	it('Derives CLAIMED from the pipe bits, for any pipe of the tile', () => {
		const grid = new SquareGrid(3, 3, false);
		const board = emptyBoard(grid);
		expect(directionState(grid, board, 4, 1)).toBe(CLAIM_STATE.FREE);
		// a newborn pipe claiming E, then a second pipe claiming N: some
		// pipe holds the bit either way, never two ends on one direction
		board[4] = [1, 2];
		expect(directionState(grid, board, 4, 1)).toBe(CLAIM_STATE.CLAIMED);
		expect(directionState(grid, board, 4, 2)).toBe(CLAIM_STATE.CLAIMED);
		expect(directionState(grid, board, 4, 4)).toBe(CLAIM_STATE.FREE);
		// walls never flip, whatever the pipes hold
		expect(directionState(grid, board, 0, 2)).toBe(CLAIM_STATE.WALL);
	});

	it('Wrap boards have no outside walls', () => {
		const grid = new SquareGrid(4, 4, true);
		const board = emptyBoard(grid);
		for (const direction of grid.polygonAt(0).directions) {
			expect(directionState(grid, board, 0, direction)).toBe(CLAIM_STATE.FREE);
		}
	});
});

describe('Move classification', () => {
	it('Pins the four move kinds of the design table', () => {
		// what exists on each side of the edge: (A's pipe exists?, B's pipe exists?)
		expect(classifyMoveKind(true, true)).toBe(MOVE_KIND.LINK);
		expect(classifyMoveKind(true, false)).toBe(MOVE_KIND.EXTEND);
		expect(classifyMoveKind(false, true)).toBe(MOVE_KIND.SHARE);
		expect(classifyMoveKind(false, false)).toBe(MOVE_KIND.SEED);
	});

	it('Pins the tier order: normal > share > straight > obvious > clean-full', () => {
		expect(TIER.NORMAL).toBeLessThan(TIER.SHARE);
		expect(TIER.SHARE).toBeLessThan(TIER.STRAIGHT);
		expect(TIER.STRAIGHT).toBeLessThan(TIER.OBVIOUS);
		expect(TIER.OBVIOUS).toBeLessThan(TIER.CLEAN_FULL);
		expect(moveTier(MOVE_KIND.EXTEND)).toBe(TIER.NORMAL);
		expect(moveTier(MOVE_KIND.LINK)).toBe(TIER.NORMAL);
		expect(moveTier(MOVE_KIND.SEED)).toBe(TIER.NORMAL);
		// sharing is considered only after plain moves
		expect(moveTier(MOVE_KIND.SHARE)).toBe(TIER.SHARE);
	});

	it('Keeps the worst demotion of a move', () => {
		expect(moveTier(MOVE_KIND.SHARE, { straight: true })).toBe(TIER.STRAIGHT);
		expect(moveTier(MOVE_KIND.EXTEND, { obvious: true })).toBe(TIER.OBVIOUS);
		expect(moveTier(MOVE_KIND.EXTEND, { straight: true, obvious: true })).toBe(TIER.OBVIOUS);
		expect(moveTier(MOVE_KIND.EXTEND, { cleanFull: true })).toBe(TIER.CLEAN_FULL);
		expect(moveTier(MOVE_KIND.SHARE, { straight: true, obvious: true, cleanFull: true })).toBe(
			TIER.CLEAN_FULL
		);
	});
});

describe('Farthest-point seed sampling', () => {
	it('Picks spread-out seeds by BFS hop distance', () => {
		// a 6x1 strip: hop distance is index distance
		const grid = new SquareGrid(6, 1, false);
		// first seed 0, then the far end 5, then the middle-est cell 2
		expect(farthestPointSeeds(grid, 3, 0)).toEqual([0, 5, 2]);
	});

	it('Seeds disconnected regions: unreachable cells win the next pick', () => {
		// a strip cut in half by an empty cell
		const tiles = [1, 1, 1, 0, 1, 1];
		const grid = new SquareGrid(6, 1, false, tiles);
		// from seed 0 the right half is unreachable, so seed 4 (first cell of it) is next
		expect(farthestPointSeeds(grid, 2, 0)).toEqual([0, 4]);
	});

	it('Caps the seed count at the playable cells', () => {
		const grid = new SquareGrid(6, 1, false);
		const seeds = farthestPointSeeds(grid, 10, 3);
		expect(seeds.length).toBe(6);
		expect(new Set(seeds).size).toBe(6);
	});

	it('Wraps around toroidal boards', () => {
		const grid = new SquareGrid(6, 1, true);
		// on a ring the farthest cell from 0 is 3 in both directions
		expect(farthestPointSeeds(grid, 2, 0)).toEqual([0, 3]);
	});
});

describe('Forest growth pregeneration', () => {
	/** @type {Array<{name: String, make: () => import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid}>} */
	const boards = [
		{ name: 'square 5x5', make: () => new SquareGrid(5, 5, false) },
		{ name: 'square 4x6 wrap', make: () => new SquareGrid(4, 6, true) },
		{
			name: 'square 5x5 with a hole',
			make: () => new SquareGrid(5, 5, false, withHoles(25, [12]))
		},
		{
			name: 'square 6x6 with holes',
			make: () => new SquareGrid(6, 6, false, withHoles(36, [8, 9, 14, 20, 27]))
		},
		{ name: 'hex 5x4', make: () => new HexaGrid(5, 4, false) },
		{ name: 'hex 6x4 wrap', make: () => new HexaGrid(6, 4, true) },
		{
			name: 'hex 5x4 with holes',
			make: () => new HexaGrid(5, 4, false, withHoles(20, [7, 8, 13]))
		},
		{ name: 'trihexagonal 3x3 (mixed)', make: () => new TrihexaGrid(3, 3, false) },
		{ name: 'trihexagonal 7x6 wrap (mixed)', make: () => new TrihexaGrid(7, 6, true) },
		{ name: 'snub square 4x4 (mixed)', make: () => new SnubSquareGrid(4, 4, false) },
		{ name: 'triangular 4x4', make: () => new TriangularGrid(4, 4, false) }
	];

	for (const board of boards) {
		for (const branchingAmount of [0, 0.5, 1]) {
			for (const sharingAmount of [0, 1]) {
				it(`Grows a covering forest on ${board.name}, branching=${branchingAmount}, sharing=${sharingAmount}`, () => {
					for (let run = 0; run < 10; run++) {
						const grid = board.make();
						/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestMove[]} */
						const moves = [];
						const tiles = pregenerateForest(grid, { branchingAmount, sharingAmount }, (move) =>
							moves.push(move)
						);
						const { components } = boardInvariants(grid, tiles);
						expect(components).toBeGreaterThanOrEqual(1);
						replayEvents(grid, tiles, moves);
					}
				});
			}
		}
	}
});

describe('Uncoverable boards', () => {
	it('Names the isolated playable cell instead of blaming treeCount', () => {
		// playable center cell, every neighbour empty: no pipe can ever
		// reach it (an atomic edge move needs two endpoints)
		const tiles = [0, 0, 0, 0, 1, 0, 0, 0, 0];
		const grid = new SquareGrid(3, 3, false, tiles);
		expect(() => pregenerateForest(grid)).toThrow(
			'cell 4 has no non-empty neighbours - no treeCount can cover it'
		);
	});

	it('Blames treeCount when uncovered cells form a second region', () => {
		// a strip cut in half by an empty cell, one tree: the right region
		// stays uncovered no matter how growth rolls
		const tiles = [1, 1, 1, 0, 1, 1];
		const grid = new SquareGrid(6, 1, false, tiles);
		expect(() => pregenerateForest(grid, { treeCount: 1 })).toThrow(
			'more separated regions than trees - raise treeCount'
		);
	});
});

describe('Forest growth knobs', () => {
	it('treeCount=1 grows a single tree covering the board', () => {
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(7, 7, false);
			const tiles = pregenerateForest(grid, { treeCount: 1 });
			expect(boardInvariants(grid, tiles).components).toBe(1);
		}
	});

	it('treeCount=7 grows seven trees', () => {
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(10, 10, false);
			const tiles = pregenerateForest(grid, { treeCount: 7 });
			expect(boardInvariants(grid, tiles).components).toBe(7);
		}
	});

	it('The default tree count is one plus the rounded square root of the cell count', () => {
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(10, 10, false);
			const tiles = pregenerateForest(grid);
			expect(boardInvariants(grid, tiles).components).toBe(defaultTreeCount(100));
		}
	});

	/**
	 * Fraction of single-ended pipes over all pipes
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestKnobs} knobs
	 */
	function deadendRatio(grid, knobs) {
		let deadends = 0;
		let pipes = 0;
		for (let run = 0; run < 20; run++) {
			for (const cellPipes of pregenerateForest(grid, knobs)) {
				for (const pipe of cellPipes) {
					pipes += 1;
					deadends += popcount(pipe) <= 1 ? 1 : 0;
				}
			}
		}
		return deadends / pipes;
	}

	it('Keeps frontier tips as move candidates until they have no legal moves', () => {
		// the aborted-prototype pitfall popped a tip after a single use; in
		// winding mode a tip never moves twice in a row, so any tip seen as
		// the actor of two different moves went dormant and came back
		let reuses = 0;
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(7, 7, false);
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestMove[]} */
			const moves = [];
			pregenerateForest(grid, { treeCount: 1, branchingAmount: 0 }, (move) => moves.push(move));
			const seen = new Set();
			for (const move of moves) {
				const key = `${move.fromCell}_${move.fromPipeIndex}`;
				if (seen.has(key)) {
					reuses += 1;
				}
				seen.add(key);
			}
		}
		expect(reuses).toBeGreaterThan(0);
	});

	it('Winding growth (branching 0) makes fewer deadends than bushy growth (branching 1)', () => {
		const grids = [new SquareGrid(8, 8, false), new HexaGrid(6, 5, false)];
		for (const grid of grids) {
			const winding = deadendRatio(grid, { branchingAmount: 0 });
			const bushy = deadendRatio(grid, { branchingAmount: 1 });
			expect(winding).toBeLessThan(bushy - 0.05);
		}
	});

	/**
	 * Fraction of straight pipes over all pipes
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestKnobs} knobs
	 */
	function straightRatio(grid, knobs) {
		let straights = 0;
		let pipes = 0;
		for (let run = 0; run < 20; run++) {
			const tiles = pregenerateForest(grid, knobs);
			for (let index = 0; index < grid.total; index++) {
				for (const pipe of tiles[index]) {
					pipes += 1;
					straights += grid.polygonAt(index).pipeShapes.get(pipe)?.isStraight ? 1 : 0;
				}
			}
		}
		return straights / pipes;
	}

	it('avoidStraights=1 avoids straight pipes', () => {
		const grid = new SquareGrid(8, 8, false);
		const plain = straightRatio(grid, { branchingAmount: 0.5 });
		const avoiding = straightRatio(grid, { branchingAmount: 0.5, avoidStraights: 1 });
		expect(avoiding).toBeLessThan(plain - 0.05);
	});

	/**
	 * Fraction of tiles whose pipe orientation is instantly solvable from
	 * walls, over tiles the precompute covers at all
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestKnobs} knobs
	 */
	function obviousRatio(grid, knobs) {
		const playable = new Set(
			[...Array(grid.total).keys()].filter((index) => !grid.emptyCells.has(index))
		);
		const obviousTiles = computeCellObviousTiles(grid, playable);
		let obvious = 0;
		let covered = 0;
		for (let run = 0; run < 20; run++) {
			const tiles = pregenerateForest(grid, knobs);
			for (const [index, forbidden] of obviousTiles) {
				covered += 1;
				obvious += forbidden.has(tiles[index][0]) ? 1 : 0;
			}
		}
		return obvious / covered;
	}

	it('avoidObvious=1 avoids obviously solvable border orientations', () => {
		const grid = new SquareGrid(8, 8, false);
		const plain = obviousRatio(grid, { branchingAmount: 0.5 });
		const avoiding = obviousRatio(grid, { branchingAmount: 0.5, avoidObvious: 1 });
		// the effect is mild (measured gap ~0.05 over 100 runs), so the
		// margin only filters sampling noise - a broken knob lands at 0
		expect(avoiding).toBeLessThan(plain - 0.02);
	});
});

describe('Sharing knob', () => {
	/**
	 * Number of tiles holding two or more pipes
	 * @param {Number[][]} tiles
	 */
	function sharedTileCount(tiles) {
		return tiles.reduce((sum, pipes) => sum + (pipes.length > 1 ? 1 : 0), 0);
	}

	it('At zero, no tile ever holds two pipes, whatever the other knobs do', () => {
		/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid[]} */
		const grids = [
			new SquareGrid(6, 6, false),
			new SquareGrid(5, 5, true),
			new HexaGrid(5, 4, false),
			new TrihexaGrid(3, 3, false),
			new SnubSquareGrid(4, 4, false),
			new TriangularGrid(4, 4, false)
		];
		for (let run = 0; run < 120; run++) {
			const grid = grids[run % grids.length];
			const tiles = pregenerateForest(grid, {
				sharingAmount: 0,
				branchingAmount: Math.random(),
				avoidObvious: Math.random(),
				avoidStraights: Math.random(),
				treeCount: 1 + Math.floor(Math.random() * 8)
			});
			expect(sharedTileCount(tiles)).toBe(0);
			expect(() => boardInvariants(grid, tiles)).not.toThrow();
		}
	});

	it('At one, nearly every run braids: shared tiles appear on demand', () => {
		const grid = new SquareGrid(8, 8, false);
		let runsWithSharedTiles = 0;
		for (let run = 0; run < 40; run++) {
			const tiles = pregenerateForest(grid, { sharingAmount: 1, branchingAmount: 0.5 });
			runsWithSharedTiles += sharedTileCount(tiles) > 0 ? 1 : 0;
		}
		expect(runsWithSharedTiles).toBeGreaterThanOrEqual(36);
	});

	it('Rises with the knob: more shared tiles at 1 than at 0.25', () => {
		const grid = new SquareGrid(8, 8, false);
		/**
		 * @param {Number} sharingAmount
		 */
		const meanShared = (sharingAmount) => {
			let total = 0;
			for (let run = 0; run < 40; run++) {
				total += sharedTileCount(pregenerateForest(grid, { sharingAmount, branchingAmount: 0.5 }));
			}
			return total / 40;
		};
		expect(meanShared(1)).toBeGreaterThan(meanShared(0.25) + 1);
	});

	it('Produces crossings on demand: square X tiles of two straights', () => {
		const grid = new SquareGrid(8, 8, false);
		let crossings = 0;
		for (let run = 0; run < 40; run++) {
			const tiles = pregenerateForest(grid, { sharingAmount: 1, branchingAmount: 0 });
			for (const pipes of tiles) {
				// glossary crossing on square: E|W (5) plus N|S (10) straights
				crossings += pipes.includes(5) && pipes.includes(10) ? 1 : 0;
			}
		}
		expect(crossings).toBeGreaterThan(0);
	});
});

describe('Hard ban under randomized stress', () => {
	it('Never creates a fully connected tile whose union contains a deadend', () => {
		/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid[]} */
		const grids = [
			new SquareGrid(6, 6, false),
			new SquareGrid(5, 5, true),
			new HexaGrid(5, 4, false),
			new TrihexaGrid(3, 3, false),
			new SnubSquareGrid(4, 4, false),
			new TriangularGrid(4, 4, false)
		];
		for (let run = 0; run < 100; run++) {
			const grid = grids[run % grids.length];
			const knobs = {
				// every other run maxes sharing out so share births and their
				// newborn hard-ban case are exercised hard, the rest rolls
				// every knob including sharing
				sharingAmount: run % 2 === 0 ? 1 : Math.random(),
				branchingAmount: Math.random(),
				avoidObvious: Math.random(),
				avoidStraights: Math.random(),
				treeCount: 1 + Math.floor(Math.random() * 8)
			};
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestMove[]} */
			const moves = [];
			const tiles = pregenerateForest(grid, knobs, (move) => moves.push(move));
			expect(() => boardInvariants(grid, tiles)).not.toThrow();
			expect(() => replayEvents(grid, tiles, moves)).not.toThrow();
		}
	});
});

/**
 * Board tiles with some cells punched empty (0 = empty)
 * @param {Number} total
 * @param {Number[]} holes
 */
function withHoles(total, holes) {
	const tiles = Array(total).fill(1);
	for (const hole of holes) {
		tiles[hole] = 0;
	}
	return tiles;
}

/**
 * Checks the board invariants and returns pipe graph stats. Throws an
 * Error naming the first broken rule: coverage of non-empty cells, valid
 * pipes, one pipe end per direction per tile, mutual edge matching,
 * forest shape (no cycles), no fully connected tile whose union contains
 * a deadend.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @returns {{nodes: Number, halfEdges: Number, components: Number}}
 */
function boardInvariants(grid, tiles) {
	/** @type {Map<String, String[]>} pipe node key => neighbour node keys */
	const adjacency = new Map();
	let nodes = 0;
	let halfEdges = 0;
	let first = null;
	for (let index = 0; index < grid.total; index++) {
		if (grid.emptyCells.has(index)) {
			if (tiles[index].length > 0) {
				throw new Error(`empty cell ${index} holds pipes`);
			}
			continue;
		}
		if (tiles[index].length === 0) {
			throw new Error(`tile ${index} holds no pipes`);
		}
		const polygon = grid.polygonAt(index);
		let union = 0;
		let claimed = 0;
		let deadend = false;
		for (let p = 0; p < tiles[index].length; p++) {
			const pipe = tiles[index][p];
			if (pipe === 0 || (pipe | polygon.fullyConnected) !== polygon.fullyConnected) {
				throw new Error(`cell ${index} holds an invalid pipe ${pipe}`);
			}
			if ((pipe & claimed) > 0) {
				throw new Error(`tile ${index} has two pipes on direction ${pipe & claimed}`);
			}
			claimed |= pipe;
			union |= pipe;
			deadend ||= popcount(pipe) === 1;
			adjacency.set(`${index}_${p}`, []);
			first ||= `${index}_${p}`;
			nodes += 1;
			for (const direction of polygon.directions) {
				if ((pipe & direction) === 0) {
					continue;
				}
				halfEdges += 1;
				const { neighbour, empty } = grid.findNeighbour(index, direction);
				if (empty) {
					throw new Error(`pipe at ${index} points at a wall in direction ${direction}`);
				}
				const back = grid.OPPOSITE.get(direction) || 0;
				const matches = tiles[neighbour].filter((other) => (other & back) > 0);
				if (matches.length !== 1) {
					throw new Error(
						`pipe at ${index} direction ${direction} has ${matches.length} matches at ${neighbour}`
					);
				}
				adjacency
					.get(`${index}_${p}`)
					?.push(`${neighbour}_${tiles[neighbour].indexOf(matches[0])}`);
			}
		}
		if (union === polygon.fullyConnected && deadend) {
			throw new Error(`tile ${index} is fully connected and contains a deadend`);
		}
	}
	halfEdges /= 2;
	// flood fill component count
	const seen = new Set();
	let components = 0;
	for (const start of adjacency.keys()) {
		if (seen.has(start)) {
			continue;
		}
		components += 1;
		const queue = [start];
		seen.add(start);
		while (queue.length > 0) {
			for (const next of adjacency.get(/** @type {String} */ (queue.pop())) || []) {
				if (!seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			}
		}
	}
	if (first !== null && components !== nodes - halfEdges) {
		throw new Error(`not a forest: ${nodes} nodes, ${halfEdges} edges, ${components} components`);
	}
	return { nodes, halfEdges, components };
}

/**
 * Replays growth events onto an empty board, asserting after every event
 * that all pipe ends created so far lock onto matching ends (atomicity),
 * that neither touched tile became a fully connected deadend union (hard
 * ban, including the newborn pipe of extend/share/seed moves), that the
 * union-find mirrors the moves (a share move never merges components:
 * its component count is unchanged; pipes of one tile never share a
 * component), and that the final board equals the returned one.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestMove[]} moves
 */
function replayEvents(grid, tiles, moves) {
	/** @type {Number[][]} */
	const board = Array.from({ length: grid.total }, () => []);
	const uf = new UnionFind();
	/**
	 * Whether the tile now holds a fully connected union containing a deadend
	 * @param {Number} cell
	 */
	const fullyConnectedDeadend = (cell) => {
		const polygon = grid.polygonAt(cell);
		let union = 0;
		let deadend = false;
		for (const mask of board[cell]) {
			union |= mask;
			deadend ||= popcount(mask) === 1;
		}
		return union === polygon.fullyConnected && deadend;
	};
	for (const move of moves) {
		if (move.kind === MOVE_KIND.LINK) {
			throw new Error('growth streams contain no link moves');
		}
		const before = uf.count;
		applyForestMove(grid, board, move);
		// register what the move birthed, then lock its edge in the
		// union-find exactly like the engine does
		if (move.kind === MOVE_KIND.SEED) {
			uf.add(grid.pipeNodeId(move.fromCell, move.fromPipeIndex));
		}
		uf.add(grid.pipeNodeId(move.neighbour, move.neighbourPipeIndex));
		if (
			!uf.union(
				grid.pipeNodeId(move.fromCell, move.fromPipeIndex),
				grid.pipeNodeId(move.neighbour, move.neighbourPipeIndex)
			)
		) {
			throw new Error(`a ${move.kind} move closed a cycle`);
		}
		// extend and share birth one pipe and lock it onto an existing one:
		// the component count is unchanged; a seed births two pipes joined
		// into one new component
		const delta = uf.count - before;
		if (delta !== (move.kind === MOVE_KIND.SEED ? 1 : 0)) {
			throw new Error(`a ${move.kind} move changed the component count by ${delta}`);
		}
		// pipes sharing a tile never connect: all roots within each touched
		// tile are distinct
		for (const cell of [move.fromCell, move.neighbour]) {
			const roots = board[cell].map((_, pipeIndex) => uf.find(grid.pipeNodeId(cell, pipeIndex)));
			if (new Set(roots).size !== roots.length) {
				throw new Error(`two pipes of tile ${cell} share a component`);
			}
		}
		if (fullyConnectedDeadend(move.fromCell)) {
			throw new Error(`move created a fully connected deadend at ${move.fromCell}`);
		}
		if (fullyConnectedDeadend(move.neighbour)) {
			throw new Error(`move created a fully connected deadend at ${move.neighbour}`);
		}
		// every end created so far must have its locked match across the edge
		for (let index = 0; index < grid.total; index++) {
			const polygon = grid.polygonAt(index);
			for (const pipe of board[index]) {
				for (const direction of polygon.directions) {
					if ((pipe & direction) === 0) {
						continue;
					}
					const { neighbour, empty } = grid.findNeighbour(index, direction);
					if (empty) {
						throw new Error(`unlocked end at ${index} pointing at a wall`);
					}
					const opposite = grid.OPPOSITE.get(direction) || 0;
					if (!board[neighbour].some((p) => (p & opposite) > 0)) {
						throw new Error(`unlocked end at ${index} direction ${direction}`);
					}
				}
			}
		}
	}
	expect(board).toEqual(tiles);
}
