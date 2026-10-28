import { describe, expect, it } from 'vitest';
import {
	CLAIM_STATE,
	DirectionClaims,
	MOVE_KIND,
	TIER,
	UnionFind,
	applyForestMove,
	classifyMoveKind,
	defaultTreeCount,
	farthestPointSeeds,
	moveTier,
	pregenerate_forest
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
	it('Marks empty cells and the outside as walls, everything else free', () => {
		// 4x4 board with one empty cell in the middle, cell 5
		const tiles = Array(16).fill(1);
		tiles[5] = 0;
		const grid = new SquareGrid(4, 4, false, tiles);
		const claims = new DirectionClaims(grid);
		// corner cell 0: E free, S free, N and W outside
		expect(claims.state(0, 1)).toBe(CLAIM_STATE.FREE);
		expect(claims.state(0, 8)).toBe(CLAIM_STATE.FREE);
		expect(claims.state(0, 2)).toBe(CLAIM_STATE.WALL);
		expect(claims.state(0, 4)).toBe(CLAIM_STATE.WALL);
		// neighbours of the empty cell see a wall towards it
		expect(claims.state(4, 1)).toBe(CLAIM_STATE.WALL);
		expect(claims.state(1, 8)).toBe(CLAIM_STATE.WALL);
		expect(claims.state(6, 4)).toBe(CLAIM_STATE.WALL);
		expect(claims.state(9, 2)).toBe(CLAIM_STATE.WALL);
		// inner cell 10 away from the hole is fully free
		for (const direction of grid.polygonAt(10).directions) {
			expect(claims.state(10, direction)).toBe(CLAIM_STATE.FREE);
		}
	});

	it('Claims free directions exactly once', () => {
		const grid = new SquareGrid(3, 3, false);
		const claims = new DirectionClaims(grid);
		expect(claims.state(4, 1)).toBe(CLAIM_STATE.FREE);
		claims.claim(4, 1);
		expect(claims.state(4, 1)).toBe(CLAIM_STATE.CLAIMED);
		expect(() => claims.claim(4, 1)).toThrow();
		expect(() => claims.claim(0, 2)).toThrow();
	});

	it('Wrap boards have no outside walls', () => {
		const grid = new SquareGrid(4, 4, true);
		const claims = new DirectionClaims(grid);
		for (const direction of grid.polygonAt(0).directions) {
			expect(claims.state(0, direction)).toBe(CLAIM_STATE.FREE);
		}
	});

	it('Rejects queries about empty cells', () => {
		const tiles = Array(9).fill(1);
		tiles[4] = 0;
		const grid = new SquareGrid(3, 3, false, tiles);
		const claims = new DirectionClaims(grid);
		expect(() => claims.state(4, 1)).toThrow();
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
			it(`Grows a covering forest on ${board.name}, branching=${branchingAmount}`, () => {
				for (let run = 0; run < 10; run++) {
					const grid = board.make();
					/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestMove[]} */
					const moves = [];
					const tiles = pregenerate_forest(grid, { branchingAmount }, (move) => moves.push(move));
					const { components } = boardInvariants(grid, tiles);
					expect(components).toBeGreaterThanOrEqual(1);
					replayEvents(grid, tiles, moves);
				}
			});
		}
	}
});

describe('Forest growth knobs', () => {
	it('treeCount=1 grows a single tree covering the board', () => {
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(7, 7, false);
			const tiles = pregenerate_forest(grid, { treeCount: 1 });
			expect(boardInvariants(grid, tiles).components).toBe(1);
		}
	});

	it('treeCount=7 grows seven trees', () => {
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(10, 10, false);
			const tiles = pregenerate_forest(grid, { treeCount: 7 });
			expect(boardInvariants(grid, tiles).components).toBe(7);
		}
	});

	it('The default tree count is one plus the rounded square root of the cell count', () => {
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(10, 10, false);
			const tiles = pregenerate_forest(grid);
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
			for (const cellPipes of pregenerate_forest(grid, knobs)) {
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
			pregenerate_forest(grid, { treeCount: 1, branchingAmount: 0 }, (move) => moves.push(move));
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
			const tiles = pregenerate_forest(grid, knobs);
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
			const tiles = pregenerate_forest(grid, knobs);
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
		expect(avoiding).toBeLessThan(plain);
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
				sharingAmount: Math.random(),
				branchingAmount: Math.random(),
				avoidObvious: Math.random(),
				avoidStraights: Math.random(),
				treeCount: 1 + Math.floor(Math.random() * 8)
			};
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestMove[]} */
			const moves = [];
			const tiles = pregenerate_forest(grid, knobs, (move) => moves.push(move));
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
 * Checks the ticket-01 board invariants and returns pipe graph stats.
 * Throws an Error naming the first broken rule: coverage, one pipe per
 * tile, mutual edge matching, one pipe end per direction, forest shape
 * (no cycles), no fully connected tile whose union contains a deadend.
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
		if (tiles[index].length !== 1) {
			throw new Error(`playable cell ${index} holds ${tiles[index].length} pipes`);
		}
		const polygon = grid.polygonAt(index);
		const pipe = tiles[index][0];
		if (pipe === 0 || (pipe | polygon.fullyConnected) !== polygon.fullyConnected) {
			throw new Error(`cell ${index} holds an invalid pipe ${pipe}`);
		}
		if (pipe === polygon.fullyConnected && popcount(pipe) === 1) {
			throw new Error(`cell ${index} is a fully connected deadend`);
		}
		const key = `${index}_0`;
		adjacency.set(key, []);
		first ||= key;
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
			const matches = tiles[neighbour].filter((p) => (p & back) > 0);
			if (matches.length !== 1) {
				throw new Error(
					`pipe at ${index} direction ${direction} has ${matches.length} matches at ${neighbour}`
				);
			}
			adjacency.get(key)?.push(`${neighbour}_0`);
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
 * ban), and that the final board equals the returned one.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestMove[]} moves
 */
function replayEvents(grid, tiles, moves) {
	/** @type {Number[][]} */
	const board = Array.from({ length: grid.total }, () => []);
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
		applyForestMove(grid, board, move);
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
