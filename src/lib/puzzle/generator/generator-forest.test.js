import { describe, expect, it } from 'vitest';
import {
	CLAIM_STATE,
	MOVE_KIND,
	TIER,
	UnionFind,
	UnmergeableBoardError,
	applyForestEvent,
	applyRotations,
	buildStartTiles,
	classifyMoveKind,
	defaultTreeCount,
	directionState,
	farthestPointSeeds,
	mergeForest,
	moveTier,
	planReusedComponents,
	pregenerateForest,
	randomRotate,
	MultiGenerator,
	validateMulti
} from '#lib/puzzle/generator/generator-forest.js';
import { computeCellObviousTiles } from '#lib/puzzle/generator/generator.js';
import { Solver } from '#lib/puzzle/solver/solver.js';
import { SquareGrid } from '#lib/puzzle/grids/squaregrid.js';
import { HexaGrid } from '#lib/puzzle/grids/hexagrid.js';
import { TrihexaGrid } from '#lib/puzzle/grids/trihexagrid.js';
import { SnubSquareGrid } from '#lib/puzzle/grids/snubsquaregrid.js';
import { TriangularGrid } from '#lib/puzzle/grids/triangulargrid.js';
import { popcount, union } from '#lib/puzzle/grids/bitmasks.js';

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

	it('Pins the tier order: normal > straight > obvious > clean-full', () => {
		expect(TIER.NORMAL).toBeLessThan(TIER.STRAIGHT);
		expect(TIER.STRAIGHT).toBeLessThan(TIER.OBVIOUS);
		expect(TIER.OBVIOUS).toBeLessThan(TIER.CLEAN_FULL);
		// demotions are the only tier pressure: every move kind starts
		// normal, sharing included - the sharing knob gates availability,
		// not preference, so no share tier exists
		expect('SHARE' in TIER).toBe(false);
		expect(moveTier()).toBe(TIER.NORMAL);
	});

	it('Keeps the worst demotion of a move', () => {
		expect(moveTier({ straight: true })).toBe(TIER.STRAIGHT);
		expect(moveTier({ obvious: true })).toBe(TIER.OBVIOUS);
		expect(moveTier({ straight: true, obvious: true })).toBe(TIER.OBVIOUS);
		expect(moveTier({ cleanFull: true })).toBe(TIER.CLEAN_FULL);
		expect(moveTier({ straight: true, obvious: true, cleanFull: true })).toBe(TIER.CLEAN_FULL);
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
				it(`Grows and merges a spanning forest on ${board.name}, branching=${branchingAmount}, sharing=${sharingAmount}`, () => {
					for (let run = 0; run < 10; run++) {
						const grid = board.make();
						/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
						const moves = [];
						const tiles = pregenerateForest(grid, { branchingAmount, sharingAmount }, (event) =>
							moves.push(event)
						);
						const { components } = boardInvariants(grid, tiles);
						expect(components).toBe(1);
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
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			pregenerateForest(grid, { treeCount: 7 }, (event) => events.push(event));
			expect(seedCount(events)).toBe(7);
		}
	});

	it('The default tree count keeps trees at about twenty cells, floored at three', () => {
		expect(defaultTreeCount(100)).toBe(5);
		expect(defaultTreeCount(400)).toBe(20);
		expect(defaultTreeCount(1600)).toBe(80);
		expect(defaultTreeCount(20)).toBe(3);
		expect(defaultTreeCount(1)).toBe(3);
		for (let run = 0; run < 10; run++) {
			const grid = new SquareGrid(10, 10, false);
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			pregenerateForest(grid, {}, (event) => events.push(event));
			expect(seedCount(events)).toBe(defaultTreeCount(100));
		}
	});

	/**
	 * Replays only the growth part of an event stream onto an empty board
	 * (everything up to the first merge event). The merge phase changes
	 * tile shapes by design - links turn deadend tips into bends and
	 * straights into tees - so growth-texture statistics are measured on
	 * the growth prefix
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestKnobs} knobs
	 * @returns {Number[][]} board as growth left it
	 */
	function growthBoard(grid, knobs) {
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		pregenerateForest(grid, knobs, (event) => events.push(event));
		const board = Array.from({ length: grid.total }, () => []);
		for (const event of events) {
			if (isMergeEvent(event)) {
				break;
			}
			applyForestEvent(grid, board, event);
		}
		return board;
	}

	/**
	 * Fraction of single-ended pipes over all pipes, growth prefix only
	 * (see growthBoard)
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestKnobs} knobs
	 */
	function deadendRatio(grid, knobs) {
		let deadends = 0;
		let pipes = 0;
		for (let run = 0; run < 20; run++) {
			for (const cellPipes of growthBoard(grid, knobs)) {
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
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const moves = [];
			pregenerateForest(grid, { treeCount: 1, branchingAmount: 0 }, (move) => moves.push(move));
			const seen = new Set();
			for (const event of moves) {
				if (event.type !== 'move') {
					continue;
				}
				const key = `${event.fromCell}_${event.fromPipeIndex}`;
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
	 * Fraction of straight pipes over all pipes, growth prefix only (see
	 * growthBoard: merge links turn straights into tees)
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestKnobs} knobs
	 */
	function straightRatio(grid, knobs) {
		let straights = 0;
		let pipes = 0;
		for (let run = 0; run < 20; run++) {
			const tiles = growthBoard(grid, knobs);
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
	 * Fraction of tiles whose pipe union is instantly solvable from
	 * walls, over tiles the precompute covers at all, growth prefix
	 * only (see growthBoard: merge links change tile orientations
	 * too). Rotating a tile rotates every pipe in it, so the solvable
	 * object is the union of all its pipes, not any single one
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
			const tiles = growthBoard(grid, knobs);
			for (const [index, forbidden] of obviousTiles) {
				covered += 1;
				obvious += forbidden.has(union(tiles[index])) ? 1 : 0;
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

	it('Braids during growth: shares fire even when the tip has a fresh extend available', () => {
		// co-tiered shares (the sharing knob gates availability, not
		// preference): with shares demoted below extends, a share could
		// only fire from a tip with no fresh-cell extend left - sharing
		// was an afterthought on a classic-shaped tree. Ranked equally, a
		// gated tip sometimes picks the share while a competing extend
		// sits right there. A competing extend: a free direction of the
		// acting tile whose neighbour is uncovered with a free answering
		// direction and whose move would not itself complete the union
		// (clean-full demotions do not compete for the pick)
		const grid = new SquareGrid(10, 10, false);
		let competingShares = 0;
		for (let run = 0; run < 10; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			pregenerateForest(grid, { sharingAmount: 1, branchingAmount: 0.5 }, (event) =>
				events.push(event)
			);
			/** @type {Number[][]} */
			const board = Array.from({ length: grid.total }, () => []);
			for (const event of events) {
				if (event.type !== 'move') {
					continue;
				}
				if (event.kind === MOVE_KIND.SHARE) {
					const polygon = grid.polygonAt(event.fromCell);
					let union = 0;
					for (const pipe of board[event.fromCell]) {
						union |= pipe;
					}
					for (const direction of polygon.directions) {
						if (direction === event.direction || (union & direction) > 0) {
							continue;
						}
						const { neighbour, empty } = grid.findNeighbour(event.fromCell, direction);
						if (empty || board[neighbour].length > 0) {
							continue;
						}
						const back = grid.OPPOSITE.get(direction) || 0;
						let neighbourUnion = 0;
						for (const pipe of board[neighbour]) {
							neighbourUnion |= pipe;
						}
						if ((neighbourUnion & back) === 0 && (union | direction) !== polygon.fullyConnected) {
							competingShares += 1;
							break;
						}
					}
				}
				applyForestEvent(grid, board, event);
			}
		}
		// with shares demoted below extends this is provably 0; measured
		// well above it once co-tiered
		expect(competingShares).toBeGreaterThan(10);
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

describe('Merge phase', () => {
	/**
	 * Narrows a forest event to its move flavor, failing the test otherwise
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent} event
	 * @returns {import('#lib/puzzle/generator/generator-forest.js').ForestMove}
	 */
	function asMove(event) {
		if (event.type !== 'move') {
			throw new Error(`expected a move event, got ${event.type}`);
		}
		return event;
	}

	/**
	 * Deep copy of a board so mergeForest mutations never leak between runs
	 * @param {Number[][]} tiles
	 */
	const copyBoard = (tiles) => tiles.map((pipes) => [...pipes]);

	it('Links two components into one spanning tree with a single link', () => {
		const grid = new SquareGrid(2, 2, false);
		// two horizontal deadend pairs: {0,1} and {2,3}
		const tiles = [[1], [4], [1], [4]];
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		mergeForest(grid, tiles, events);
		expect(boardInvariants(grid, tiles).components).toBe(1);
		expect(events.length).toBe(1);
		expect(events[0].type).toBe('move');
		expect(asMove(events[0]).kind).toBe(MOVE_KIND.LINK);
	});

	it('Refuses same-component links: a single-component board is returned untouched', () => {
		const grid = new SquareGrid(2, 2, false);
		// one tree through all four tiles; the free-free edge (2,3) offers
		// only same-component pairs, so the cycle guard skips it
		const tiles = [[9], [12], [2], [2]];
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		mergeForest(grid, tiles, events);
		expect(boardInvariants(grid, tiles).components).toBe(1);
		expect(events.length).toBe(0);
		expect(tiles).toEqual([[9], [12], [2], [2]]);
	});

	/**
	 * The seam wrap board family (4x4 wrap): an island component B = {5,6}
	 * sealed inside component A. Every A-B edge is hard-ban sealed by its
	 * A-side tile - a union one bit short of fully connected, holding
	 * three deadends, so whichever pipe receives the link, a deadend stays
	 * inside the completed union. The filler tiles (0, 3, 8, 11, 12, 13,
	 * 14, 15) are multi-end joiner pipes forming a connected backbone, so
	 * A is one component; the seam tiles' horizontal deadend pairs (1-2,
	 * 4-7, 9-10) form little islands that only a fusion can absorb.
	 * Variants override single tiles to open specific tiers.
	 * @param {Record<Number, Number[]>} [overrides]
	 */
	function seamBoard(overrides = {}) {
		return Object.assign(
			[
				[15],
				[2, 1, 4],
				[2, 1, 4],
				[13],
				[2, 4, 8],
				[1],
				[4],
				[2, 1, 8],
				[15],
				[1, 4, 8],
				[1, 4, 8],
				[15],
				[11],
				[15],
				[14],
				[2]
			],
			overrides
		);
	}

	it('Fires a union-completing link only as the last resort, never a hard-banned one', () => {
		// tile 9 = [5,8]: across edge (9,5) the pair ([5], island) would
		// leave deadend [8] inside a full union - hard banned; the pair
		// ([8], island) completes the union cleanly - last-resort tier.
		// After it fires, the two deadend islands fuse into A.
		const grid = new SquareGrid(4, 4, true);
		const tiles = seamBoard({ 9: [5, 8] });
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		mergeForest(grid, tiles, events);
		expect(boardInvariants(grid, tiles).components).toBe(1);
		// the completing link fired first, the fusions only cleaned up
		expect(asMove(events[0]).kind).toBe(MOVE_KIND.LINK);
		expect(events.slice(1).every((event) => event.type === 'fuse')).toBe(true);
		// the surviving pipe [8] gained N (2): the bend [10]; the island
		// deadend [1] gained S (8): [9]
		expect(tiles[9]).toEqual([5, 10]);
		expect(tiles[5]).toEqual([9]);
	});

	it('Prefers a plain link over an available union-completing link', () => {
		// tiles 8/11 lose their wrap edge, 10 = [5] frees its N without
		// completing anything (edge (10,6): a plain link) and 13/14/15
		// follow suit. Edge (9,5) still offers only the completing link -
		// it must not fire while the plain one exists
		const grid = new SquareGrid(4, 4, true);
		const tiles = seamBoard({
			8: [11],
			9: [5, 8],
			10: [5],
			11: [14],
			14: [12],
			15: [2]
		});
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		mergeForest(grid, tiles, events);
		expect(boardInvariants(grid, tiles).components).toBe(1);
		// the plain link fired first, at edge (10,6); the completing one
		// at (9,5) never fired at all (its components met via the plain
		// link) - later events are completing links and fusions into the
		// deadend islands, at their place in the order
		expect(asMove(events[0]).kind).toBe(MOVE_KIND.LINK);
		expect(asMove(events[0]).fromCell).toBe(10);
		expect(asMove(events[0]).direction).toBe(2);
		expect(tiles[6]).toEqual([12]);
		expect(tiles[9]).toEqual([5, 8]);
		expect(tiles[5]).toEqual([1]);
	});

	it('Merges a sealed board through fusions alone when no link exists', () => {
		// the seam board without the B island: tiles 5,6 are empty, so
		// every remaining edge is claimed or walled - no link candidate
		// exists anywhere. The three deadend islands still share tiles
		// with A pipes, so fusions merge everything
		const playable = [1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1];
		const grid = new SquareGrid(4, 4, true, playable);
		const tiles = seamBoard({ 5: [], 6: [] });
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		mergeForest(grid, tiles, events);
		expect(boardInvariants(grid, tiles).components).toBe(1);
		expect(events.length).toBe(3);
		expect(events.every((event) => event.type === 'fuse')).toBe(true);
	});

	it('Surfaces a wall-sealed seam as a clean, identifiable failure', () => {
		// two empty columns split the torus into two separate rings, each
		// a proper tree: no edge, no shared tile, nothing to merge - and
		// the board itself stays valid, never malformed. (A hard-ban
		// sealed square seam cannot be hand-built anymore: generalized
		// fusion cleans a seam tile's deadends, which un-bans its edge -
		// every constructed "sealed" board merges, which is the point of
		// fusion. Walls are the only seal fusion cannot dissolve.)
		const playable = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
		const grid = new SquareGrid(4, 4, true, playable);
		const tiles = [[], [8], [], [8], [], [10], [], [10], [], [10], [], [10], [], [2], [], [2]];
		expect(() => boardInvariants(grid, tiles)).not.toThrow();
		expect(boardInvariants(grid, tiles).components).toBe(2);
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		expect(() => mergeForest(grid, tiles, events)).toThrow(UnmergeableBoardError);
		// clean failure: nothing was applied, the board is untouched
		expect(events.length).toBe(0);
		expect(tiles).toEqual([
			[],
			[8],
			[],
			[8],
			[],
			[10],
			[],
			[10],
			[],
			[10],
			[],
			[10],
			[],
			[2],
			[],
			[2]
		]);
	});

	it('Picks the receiving resident pipe of a shared tile uniformly at random', () => {
		const grid = new SquareGrid(3, 2, false);
		// four components: X={0E,1,2W,4N}, W={0S,3N}, Y={3E,4W}, Z={2S,5};
		// the only cross edge is (4,5): both resident pipes of tile 4 form
		// a valid pair with tile 5's pipe, so the pick is a fair coin
		const board = [[1, 8], [13], [8, 4], [1, 2], [2, 4], [2]];
		/** @type {Number[]} */
		const picks = [];
		for (let run = 0; run < 200; run++) {
			const tiles = copyBoard(board);
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			mergeForest(grid, tiles, events);
			expect(boardInvariants(grid, tiles).components).toBe(1);
			// the first event is the link into the shared tile 4: which of
			// its two pipes received the end is the uniform pick
			expect(asMove(events[0]).kind).toBe(MOVE_KIND.LINK);
			expect(asMove(events[0]).fromCell).toBe(4);
			picks.push(asMove(events[0]).fromPipeIndex);
		}
		const first = picks.filter((pipeIndex) => pipeIndex === 0).length;
		// fair coin over 200 runs: 100 expected, 4+ sigma away at the bounds
		expect(first).toBeGreaterThanOrEqual(60);
		expect(first).toBeLessThanOrEqual(140);
	});

	/**
	 * Counts fully connected single pipes (pluses) - the
	 * rotation-invariant freebies the merge demotes below clean fusions
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number[][]} tiles
	 */
	const countPluses = (grid, tiles) => {
		let pluses = 0;
		for (let cell = 0; cell < grid.total; cell++) {
			if (grid.emptyCells.has(cell)) {
				continue;
			}
			const full = grid.polygonAt(cell).fullyConnected;
			for (const pipe of tiles[cell]) {
				if (pipe === full) {
					pluses++;
				}
			}
		}
		return pluses;
	};

	it('Never mints a plus while clean merges remain', () => {
		// seam variant: 9=[13] gives the board a plus-only edge (9,5) -
		// tile 9's tee would gain its every direction. 0/8/12 overrides
		// sever the backbone's 0-12-8 bridge so the tee's three matches
		// do not close a cycle, splitting A into two halves that tiles 1,
		// 4 and 7 all bridge with clean fusions; 6=[4,2] parks a B pipe
		// next to an A pipe as one more clean fusion. The plus link must
		// never fire: every merge happens through a fusion or an un-sealed
		// clean link, and the board's two hand-built pluses stay exactly
		// two. Loop for shuffle coverage - the claim holds for every order
		const grid = new SquareGrid(4, 4, true);
		for (let run = 0; run < 20; run++) {
			const tiles = seamBoard({
				9: [13],
				6: [4, 2],
				2: [10, 5],
				0: [13],
				8: [7],
				12: [1]
			});
			const plusesBefore = countPluses(grid, tiles);
			expect(plusesBefore).toBe(2);
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			mergeForest(grid, tiles, events);
			expect(boardInvariants(grid, tiles).components).toBe(1);
			expect(tiles[9]).toEqual([13]);
			expect(countPluses(grid, tiles)).toBe(plusesBefore);
			// and the plus edge itself never fired
			for (const event of events) {
				if (event.type !== 'move') {
					continue;
				}
				const edge = [event.fromCell, event.neighbour].sort().join(',');
				expect(edge === '5,9').toBe(false);
			}
		}
	});

	it('Never lets two clean links of one sweep stack into a plus', () => {
		// tile 5's straight [5] has both N and S free; the (5,1) and (5,9)
		// pairs are individually clean, so a round-1 sweep collects both.
		// Whatever the shuffle, the second one is re-validated as a plus
		// at apply time (the straight already gained its first end) and
		// skipped - the only way tile 5 could ever reach 15. Every other
		// pipe with completable directions is either same-root-guarded or
		// has the clean fusions of tiles 6 and 7 as escapes
		const grid = new SquareGrid(4, 4, true);
		const board = [
			[2, 4],
			[2],
			[2],
			[11],
			[1],
			[5],
			[4, 8],
			[2, 8],
			[4],
			[8],
			[2],
			[3],
			[12],
			[10],
			[8],
			[9]
		];
		for (let run = 0; run < 200; run++) {
			const tiles = copyBoard(board);
			mergeForest(grid, tiles, []);
			expect(boardInvariants(grid, tiles).components).toBe(1);
			expect(countPluses(grid, tiles)).toBe(0);
		}
	});

	it('Keeps plus completing links ahead of fusions on triangular grids', () => {
		// the triangular caveat mirrors growth's demoteFullUnion: plus
		// links sit in the completing tier, not below the fusions. The
		// same board as the no-minting test above, on a grid whose KIND
		// is triangular (the caveat keys on KIND alone, so the verified
		// square geometry stands in for a hand-built triangular seam).
		// The plus edge (9,5) is the island B's only merge, so it must
		// fire - and before every fusion, which is what separates the
		// completing tier from the demoted tiers (the assertion pins the
		// order; the caveat keys on KIND alone, so a polygon-based gate
		// would need this test reworked onto a real TriangularGrid)
		const grid = new SquareGrid(4, 4, true);
		grid.KIND = 'triangular';
		const tiles = seamBoard({
			9: [13],
			6: [4, 2],
			2: [10, 5],
			0: [13],
			8: [7],
			12: [1]
		});
		const plusesBefore = countPluses(grid, tiles);
		/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
		const events = [];
		mergeForest(grid, tiles, events);
		expect(boardInvariants(grid, tiles).components).toBe(1);
		// the plus link fired, and before every fusion
		const plusLinkIndex = events.findIndex(
			(event) => event.type === 'move' && event.fromCell === 9 && event.neighbour === 5
		);
		expect(plusLinkIndex).toBeGreaterThanOrEqual(0);
		const firstFuse = events.findIndex((event) => event.type === 'fuse');
		if (firstFuse >= 0) {
			expect(plusLinkIndex).toBeLessThan(firstFuse);
		}
		expect(tiles[9]).toEqual([15]);
		expect(countPluses(grid, tiles)).toBeGreaterThan(plusesBefore);
	});

	it('Mints no plus under randomized stress on non-triangular grids', () => {
		// share maxed out: boards full of shared tiles, the config where
		// the old tier order minted ~5 pluses per square board. The plus
		// demotion leaves clean fusions to do those merges instead. The
		// assertion is on the merge's contribution: growth's own pluses
		// (a rare clean-full last resort there) are counted from the
		// event stream's growth prefix and allowed to stand
		/** @type {Array<{make: () => import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid, runs: Number}>} */
		const boards = [
			{ make: () => new SquareGrid(8, 8, false), runs: 15 },
			{ make: () => new SquareGrid(6, 6, true), runs: 10 },
			{ make: () => new HexaGrid(6, 5, false), runs: 10 }
		];
		for (const board of boards) {
			for (let run = 0; run < board.runs; run++) {
				const grid = board.make();
				/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
				const events = [];
				const tiles = pregenerateForest(grid, { sharingAmount: 1 }, (event) => events.push(event));
				expect(() => boardInvariants(grid, tiles)).not.toThrow();
				const growthTiles = Array.from({ length: grid.total }, () => []);
				for (const event of events) {
					if (isMergeEvent(event)) {
						break;
					}
					applyForestEvent(grid, growthTiles, event);
				}
				expect(countPluses(grid, tiles)).toBe(countPluses(grid, growthTiles));
			}
		}
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
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const moves = [];
			const tiles = pregenerateForest(grid, knobs, (move) => moves.push(move));
			expect(() => boardInvariants(grid, tiles)).not.toThrow();
			expect(() => replayEvents(grid, tiles, moves)).not.toThrow();
		}
	});
});

describe('End-to-end pregeneration (solver oracle)', () => {
	/** @type {Array<{name: String, make: () => import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid}>} */
	const boards = [
		{ name: 'square 6x6', make: () => new SquareGrid(6, 6, false) },
		{ name: 'square 5x5 wrap', make: () => new SquareGrid(5, 5, true) },
		{ name: 'hex 5x4', make: () => new HexaGrid(5, 4, false) },
		{ name: 'trihexagonal 3x3 (mixed)', make: () => new TrihexaGrid(3, 3, false) },
		{ name: 'snub square 4x4 (mixed)', make: () => new SnubSquareGrid(4, 4, false) }
	];

	for (const board of boards) {
		for (const sharingAmount of [0, 0.5, 1]) {
			it(`Pregenerates a solver-solvable spanning tree on ${board.name}, sharing=${sharingAmount}`, () => {
				for (let run = 0; run < 3; run++) {
					const grid = board.make();
					const tiles = pregenerateForest(grid, { sharingAmount, branchingAmount: 0.5 });
					expect(boardInvariants(grid, tiles).components).toBe(1);
					const { solvable } = new Solver(tiles, grid).markAmbiguousTiles();
					expect(solvable).toBe(true);
				}
			});
		}
	}

	it('Sharing zero degenerates to a classic-shaped single-pipe puzzle, solver-verified', () => {
		for (const board of boards) {
			for (let run = 0; run < 5; run++) {
				const grid = board.make();
				const tiles = pregenerateForest(grid, {
					sharingAmount: 0,
					branchingAmount: Math.random(),
					avoidObvious: Math.random(),
					avoidStraights: Math.random(),
					treeCount: 1 + Math.floor(Math.random() * 8)
				});
				// every playable tile holds exactly one pipe - the
				// continuous bottom end of the sharing knob (mixed grids
				// have structurally empty cells)
				const playable = [...Array(grid.total).keys()].filter(
					(index) => !grid.emptyCells.has(index)
				);
				expect(playable.every((index) => tiles[index].length === 1)).toBe(true);
				expect(boardInvariants(grid, tiles).components).toBe(1);
				const { solvable } = new Solver(tiles, grid).markAmbiguousTiles();
				expect(solvable).toBe(true);
			}
		}
	});
});

describe('Last-resort parking', () => {
	/**
	 * A legal fresh-cell extend on the replayed board that would not
	 * itself complete a full union: a free direction of a covered tile
	 * whose neighbour is uncovered with a free answering direction. Hard
	 * bans need no separate exclusion - a hard-banned hypothetical
	 * completes a full union, which the last check already filters.
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number[][]} board
	 * @returns {{cell: Number, direction: Number} | null}
	 */
	function findFreshExtend(grid, board) {
		for (let cell = 0; cell < grid.total; cell++) {
			if (board[cell].length === 0) {
				continue;
			}
			const polygon = grid.polygonAt(cell);
			let union = 0;
			for (const pipe of board[cell]) {
				union |= pipe;
			}
			for (const direction of polygon.directions) {
				if ((union & direction) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				if (empty || board[neighbour].length > 0) {
					continue;
				}
				let neighbourUnion = 0;
				for (const pipe of board[neighbour]) {
					neighbourUnion |= pipe;
				}
				const back = grid.OPPOSITE.get(direction) || 0;
				if ((neighbourUnion & back) > 0 || (union | direction) === polygon.fullyConnected) {
					continue;
				}
				return { cell, direction };
			}
		}
		return null;
	}

	/**
	 * Replays a growth stream asserting last-resort parking: whenever a
	 * fired move completes a pipe union outside the exemption classes, no
	 * pipe anywhere on the board had a legal fresh-cell extend left that
	 * would not complete a full union - the union-completing move fired
	 * only as a true last resort. Exemptions, matching the engine's soft
	 * ban: a fully connected pipe completed by an extend on triangular
	 * grids (a triangle's only branching) and a multi-pipe union completed
	 * by an extend on a square cell (the X / L+L crossing, paying for
	 * itself in coverage). Every tile is checked, a sound superset of
	 * alive tips: dead tips have no legal moves at death and moves only
	 * ever die. Merge events (links, fusions) are applied but not judged:
	 * after growth every cell is covered, so no fresh-cell extend exists
	 * anyway and the merge's own tier order governs them.
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} moves
	 * @returns {Number} how many non-exempt union-completing moves fired
	 */
	function replayParkingOracle(grid, moves) {
		/** @type {Number[][]} */
		const board = Array.from({ length: grid.total }, () => []);
		/**
		 * Pipe union of a tile after a hypothetical end lands in direction
		 * @param {Number} cell
		 * @param {Number} direction
		 */
		const unionAfter = (cell, direction) => {
			let union = 0;
			for (const pipe of board[cell]) {
				union |= pipe;
			}
			return union | direction;
		};
		let drains = 0;
		for (const move of moves) {
			if (move.type === 'move') {
				const polygon = grid.polygonAt(move.fromCell);
				const back = grid.OPPOSITE.get(move.direction) || 0;
				const completes =
					unionAfter(move.fromCell, move.direction) === polygon.fullyConnected ||
					unionAfter(move.neighbour, back) === grid.polygonAt(move.neighbour).fullyConnected;
				if (completes) {
					const pipeFull =
						(board[move.fromCell][move.fromPipeIndex] | move.direction) === polygon.fullyConnected;
					const exempt =
						move.kind === MOVE_KIND.EXTEND &&
						((grid.KIND === 'triangular' && pipeFull) ||
							(polygon.numDirections === 4 && !pipeFull));
					if (!exempt) {
						drains += 1;
						const escape = findFreshExtend(grid, board);
						if (escape !== null) {
							throw new Error(
								`union-completing ${move.kind} move at ${move.fromCell} fired while a fresh ` +
									`extend remained at ${escape.cell} direction ${escape.direction}`
							);
						}
					}
				}
			}
			applyForestEvent(grid, board, move);
		}
		return drains;
	}

	it('Fires non-exempt union-completing moves only when no fresh-cell extend exists anywhere', () => {
		/** @type {{grid: import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid, knobs: import('#lib/puzzle/generator/generator-forest.js').ForestKnobs, runs: Number}[]} */
		const configs = [
			{
				grid: new SquareGrid(8, 8, false),
				knobs: { sharingAmount: 0, branchingAmount: 1 },
				runs: 10
			},
			{
				grid: new SquareGrid(8, 8, false),
				knobs: { sharingAmount: 0, branchingAmount: 0 },
				runs: 5
			},
			{ grid: new HexaGrid(6, 5, false), knobs: { sharingAmount: 0, branchingAmount: 1 }, runs: 5 },
			// the post-coverage sharing tail keeps draining - the oracle
			// must hold there too, and these runs keep it non-vacuous
			{
				grid: new SquareGrid(8, 8, false),
				knobs: { sharingAmount: 1, branchingAmount: 0 },
				runs: 5
			},
			{
				grid: new SquareGrid(8, 8, false),
				knobs: { sharingAmount: 1, branchingAmount: 1 },
				runs: 5
			},
			// triangular pipe completions are exempt (a triangle's only
			// branching) and fire mid-growth: the exemption is exercised,
			// the assertion never trips there
			{
				grid: new TriangularGrid(6, 6, false),
				knobs: { sharingAmount: 0, branchingAmount: 1 },
				runs: 5
			},
			// mixed grid: square cells get the crossing exemption, the
			// triangle cells do not (the pipe exemption is triangular-grid
			// only)
			{
				grid: new SnubSquareGrid(5, 5, false),
				knobs: { sharingAmount: 1, branchingAmount: 0.5 },
				runs: 5
			}
		];
		let drains = 0;
		for (const config of configs) {
			for (let run = 0; run < config.runs; run++) {
				/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
				const moves = [];
				pregenerateForest(config.grid, config.knobs, (move) => moves.push(move));
				drains += replayParkingOracle(config.grid, moves);
			}
		}
		expect(drains).toBeGreaterThan(0);
	});

	it('Completes square crossings mid-growth: a multi-pipe union-completing extend on a square cell fires with fresh extends remaining', () => {
		// the square exemption of the last-resort tier: on 4-direction
		// cells the clean multi-pipe union is exactly the X / L+L crossing
		// pair, and the completing extend visits a fresh cell, so it pays
		// for itself in coverage and ranks normal instead of parking
		const grid = new SquareGrid(10, 10, false);
		let midGrowthCompletions = 0;
		for (let run = 0; run < 10; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			pregenerateForest(grid, { sharingAmount: 1, branchingAmount: 0.5 }, (event) =>
				events.push(event)
			);
			/** @type {Number[][]} */
			const board = Array.from({ length: grid.total }, () => []);
			for (const event of events) {
				if (event.type === 'move' && event.kind === MOVE_KIND.EXTEND) {
					let union = 0;
					for (const pipe of board[event.fromCell]) {
						union |= pipe;
					}
					const pipeFull =
						(board[event.fromCell][event.fromPipeIndex] | event.direction) ===
						grid.polygonAt(event.fromCell).fullyConnected;
					if (
						board[event.fromCell].length > 1 &&
						!pipeFull &&
						(union | event.direction) === grid.polygonAt(event.fromCell).fullyConnected &&
						findFreshExtend(grid, board) !== null
					) {
						midGrowthCompletions += 1;
					}
				}
				applyForestEvent(grid, board, event);
			}
		}
		// with every union completion demoted this is provably 0 (they
		// all park); measured well above it with the exemption
		expect(midGrowthCompletions).toBeGreaterThan(10);
	});
});

describe('Share-source hard ban', () => {
	/**
	 * Replays a growth stream asserting the share-source hard ban: no
	 * share move may complete the source tile's pipe union, on any grid
	 * kind - pipe or multi-pipe, deadend or clean. Sharing gains no
	 * coverage, so the drain phase has no reason to mint fully connected
	 * tiles either; crossings form through the coverage-paying extend
	 * exemption instead
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} moves
	 */
	function replayShareSourceBan(grid, moves) {
		/** @type {Number[][]} */
		const board = Array.from({ length: grid.total }, () => []);
		for (const move of moves) {
			if (move.type !== 'move') {
				continue;
			}
			if (move.kind === MOVE_KIND.SHARE) {
				const polygon = grid.polygonAt(move.fromCell);
				let union = 0;
				for (let i = 0; i < board[move.fromCell].length; i++) {
					union |=
						i === move.fromPipeIndex
							? board[move.fromCell][i] | move.direction
							: board[move.fromCell][i];
				}
				if (union === polygon.fullyConnected) {
					throw new Error(`share move at ${move.fromCell} completes its tile's union`);
				}
			}
			applyForestEvent(grid, board, move);
		}
	}

	it('Never fires a share move that completes its source union, on any grid kind', () => {
		/** @type {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid[]} */
		const grids = [
			new SquareGrid(8, 8, false),
			new SquareGrid(6, 6, true),
			new HexaGrid(6, 5, false),
			new TrihexaGrid(4, 3, false),
			new SnubSquareGrid(4, 4, false),
			// the full-union demotion is off there, but the hard ban is not
			new TriangularGrid(6, 6, false)
		];
		for (let run = 0; run < 60; run++) {
			const grid = grids[run % grids.length];
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const moves = [];
			pregenerateForest(grid, { sharingAmount: 1, branchingAmount: Math.random() }, (move) =>
				moves.push(move)
			);
			expect(() => replayShareSourceBan(grid, moves)).not.toThrow();
		}
	});
});

describe('Avoid-obvious union demotion (white-box)', () => {
	it('Demotes by the post-move tile union: the two-deadend wall-straight extend parks', () => {
		// 4x3 board, four reused two-cell deadend pairs (reuseMinCount
		// 2): the west-column tile 4 holds deadends N and S - union 10,
		// the wall-hugging vertical straight - one per component, and
		// its only candidate direction is E into fresh cell 5. Acting
		// on either deadend the pipe alone becomes a bend (3 or 9),
		// never a unique survivor of its shape class, so the pipe-keyed
		// demotion passes the move; the union-keyed demotion sees
		// 10|E = 11, the only tee that fits a west wall, and parks it.
		// Tree 2's tile 6 sits in the interior (no nogo entry at all)
		// and covers cell 5 with a normal-tier extend while the parked
		// tips wait, so the tips at 4 can never fire afterwards:
		// sharing is off and their east neighbour is foreign-held.
		// Tile 4 keeps its two deadends in every run
		const grid = new SquareGrid(4, 3, false);
		const startTiles = startTilesFrom(12, {
			0: [8],
			4: [2, 8],
			8: [2],
			2: [8],
			6: [2, 8],
			10: [2]
		});
		for (let run = 0; run < 30; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			pregenerateForest(
				grid,
				{ sharingAmount: 0, avoidObvious: 1, treeCount: 4, branchingAmount: Math.random() },
				(event) => events.push(event),
				startTiles,
				2
			);
			const board = replayGrowthPrefix(grid, events);
			expect(board[4]).toEqual([2, 8]);
		}
	});

	it('Drops obvious-demoted shares at bucketing: they never fire, the tip dies instead', () => {
		// 3x3 board, three reused two-cell deadend pairs (reuseMinCount
		// 2). Tile 1 on the north edge holds E and W deadends (union 5);
		// the interior tile 4 holds an S deadend with its N direction
		// free. Across their edge both shares are obvious by union:
		// 1's tips would grow the source union to 5|S = 13, the only
		// tee that fits cell 1's north wall, and 4's tip - source
		// interior, no nogo of its own - would grow the NEIGHBOUR'S
		// union to the same 13. Pipe-keyed, both shares pass today
		// (9 and 10 are never unique survivors), so the tips at 1 fire
		// theirs straight from the frontier. Union-keyed, every share
		// on this board is dropped at bucketing - never bucketed, so
		// never fired from any pool - and a tip whose only candidate
		// is one (the tips at 1) dies instead of parking. Coverage
		// still completes through extends, which may use the obvious
		// tier
		const grid = new SquareGrid(3, 3, false);
		const startTiles = startTilesFrom(9, {
			0: [1],
			1: [1, 4],
			2: [4],
			4: [8],
			7: [2]
		});
		for (let run = 0; run < 30; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			pregenerateForest(
				grid,
				{ sharingAmount: 1, avoidObvious: 1, treeCount: 3, branchingAmount: Math.random() },
				(event) => events.push(event),
				startTiles,
				2
			);
			expect(events.some((event) => event.type === 'move' && event.kind === MOVE_KIND.SHARE)).toBe(
				false
			);
			// the share never fired, so tile 1's union stays its E|W
			// deadend pair - no newborn S end ever joins it
			const tileOne = replayGrowthPrefix(grid, events)[1];
			expect(union(tileOne)).toBe(5);
		}
	});
});

describe('Regrow from reused tiles', () => {
	it('Loads reused components as trees and caps fresh seeds at the erased region density', () => {
		for (let run = 0; run < 5; run++) {
			const grid = new SquareGrid(8, 3, false);
			// a four-cell kept path in the middle row, everything else
			// erased: one reused tree loads, and the 20-cell erased region
			// takes one fresh seed - the same ~20-cells-per-tree density as
			// a fresh board (K only caps, it no longer crams a shrinking
			// regrowth region with seeds) [ticket 06 decision]
			const startTiles = startTilesFrom(24, { 9: [1], 10: [5], 11: [5], 12: [4] });
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			const tiles = pregenerateForest(
				grid,
				{ treeCount: 4, sharingAmount: 0.5 },
				(event) => events.push(event),
				startTiles
			);
			expect(reusedCells(events)).toEqual(new Set([9, 10, 11, 12]));
			expect(seedCount(events)).toBe(1);
			expect(boardInvariants(grid, tiles).components).toBe(1);
			expect(new Solver(tiles, grid).markAmbiguousTiles().solvable).toBe(true);
			replayEvents(grid, tiles, events);
		}
	});

	it('Never shares between two reused cells: the ratchet fuel is cut', () => {
		// two facing kept components (top two rows of a 6x6): before the
		// ban, reused tips facing each other's cells birthed pipes there
		// (a both-reused share), mutating certified territory for zero
		// coverage and ratcheting shared-tile counts up iteration over
		// iteration until borders saturate [ticket 06 decision, from the
		// 30x30 measurements: r-class shares fired 5-26 times per regrow]
		const grid = new SquareGrid(6, 6, false);
		const startTiles = startTilesFrom(36, {
			0: [1],
			1: [5],
			2: [4],
			6: [1],
			7: [5],
			8: [4]
		});
		for (let run = 0; run < 20; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			pregenerateForest(
				grid,
				{ sharingAmount: 1, treeCount: 6 },
				(event) => events.push(event),
				startTiles
			);
			const reused = reusedCells(events);
			expect(reused.size).toBe(6);
			for (const event of events) {
				if (event.type !== 'move' || event.kind !== MOVE_KIND.SHARE) {
					continue;
				}
				expect(reused.has(event.fromCell) && reused.has(event.neighbour)).toBe(false);
			}
		}
	});

	it('Keeps every qualifying component when reuse exceeds K, adding no fresh seeds', () => {
		// four three-cell components on a strip, K = 3: K caps fresh
		// seeds, not reuse - all four load as trees and grow. The open
		// erased tail run leaves room where a seed could open, so the
		// zero-seed expectation genuinely pins the cap: on a board
		// whose erased cells are all boxed in by reused cells it would
		// hold vacuously, mutant seeds never opening
		const grid = new SquareGrid(19, 1, false);
		/** @type {Record<Number, Number[]>} */
		const solved = {};
		for (const start of [0, 4, 8, 12]) {
			solved[start] = [1];
			solved[start + 1] = [5];
			solved[start + 2] = [4];
		}
		const startTiles = startTilesFrom(19, solved);
		for (let run = 0; run < 5; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			const tiles = pregenerateForest(
				grid,
				{ treeCount: 3, sharingAmount: 0.5 },
				(event) => events.push(event),
				startTiles
			);
			expect(seedCount(events)).toBe(0);
			expect(reusedCells(events).size).toBe(12);
			// no linking during growth: the four reused trees reach the
			// merge phase as four components
			expect(pipeComponents(grid, replayGrowthPrefix(grid, events))).toBe(4);
			expect(boardInvariants(grid, tiles).components).toBe(1);
			expect(new Solver(tiles, grid).markAmbiguousTiles().solvable).toBe(true);
			replayEvents(grid, tiles, events);
		}
	});

	it("Keeps seed pipes' ends: interior pipes unchanged, boundary pipes only gain ends", () => {
		// a 3x3 kept block in the middle of a 5x5: the block's center
		// straight is fully interior (every neighbour kept), so growth
		// cannot touch it - no fresh cell to extend into, no foreign
		// tree to share into with sharing off; the rim pipes face erased
		// cells and may extend into them, never losing an end
		const grid = new SquareGrid(5, 5, false);
		const solved = {
			6: [1],
			7: [5],
			8: [12],
			13: [6],
			12: [5],
			11: [9],
			16: [3],
			17: [5],
			18: [4]
		};
		const startTiles = startTilesFrom(25, solved);
		let gainedEnds = 0;
		for (let run = 0; run < 5; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			const tiles = pregenerateForest(
				grid,
				{ treeCount: 4, sharingAmount: 0, branchingAmount: 0.5 },
				(event) => events.push(event),
				startTiles
			);
			const grown = replayGrowthPrefix(grid, events);
			for (const [cell, pipes] of Object.entries(solved)) {
				for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
					const seed = pipes[pipeIndex];
					const after = grown[Number(cell)][pipeIndex];
					// seed pipes keep their ends - only new ends may join
					expect(after & seed).toBe(seed);
					gainedEnds += popcount(after) > popcount(seed) ? 1 : 0;
				}
			}
			// the interior pipe cannot move at all
			expect(grown[12][0]).toBe(5);
			expect(boardInvariants(grid, tiles).components).toBe(1);
			replayEvents(grid, tiles, events);
		}
		// the block's rim pipes do extend into the erased region around
		// them (a kept component that never grows back would be a bug)
		expect(gainedEnds).toBeGreaterThan(0);
	});

	it('Grows the erased region around reused trees: a pocket enclosed by reused cells is covered by the reused tree itself', () => {
		// a ring of eight kept cells around the erased center 12; with
		// sharing off, no fresh tree can pass through the ring, so only
		// the reused tree can cover the center - by extending one of its
		// rim pipes into it, regaining the end the ring's solution had
		const grid = new SquareGrid(5, 5, false);
		/** @type {Record<Number, Number[]>} */
		const ring = {
			7: [4],
			6: [9],
			11: [10],
			16: [3],
			17: [5],
			18: [6],
			13: [9],
			8: [4]
		};
		const startTiles = startTilesFrom(25, ring);
		for (let run = 0; run < 5; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			const tiles = pregenerateForest(
				grid,
				{ treeCount: 4, sharingAmount: 0 },
				(event) => events.push(event),
				startTiles
			);
			expect(tiles[12].length).toBe(1);
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestMove|null} */
			let entry = null;
			for (const event of events) {
				if (event.type === 'move' && event.neighbour === 12) {
					entry = event;
					break;
				}
			}
			// covered by an extend from a ring cell, not a foreign birth
			expect(entry).not.toBeNull();
			const move = /** @type {import('#lib/puzzle/generator/generator-forest.js').ForestMove} */ (
				entry
			);
			expect(move.kind).toBe(MOVE_KIND.EXTEND);
			expect(ring[move.fromCell]).toBeDefined();
			expect(boardInvariants(grid, tiles).components).toBe(1);
			replayEvents(grid, tiles, events);
		}
	});

	it('Foreign tips share into reused tiles: no linking during growth, only share births', () => {
		// reused tiles are trees, not absorption targets - a foreign tip
		// entering them births a new pipe there (a share), it never links
		const grid = new SquareGrid(7, 7, false);
		const solved = {
			22: [1],
			23: [5],
			24: [5],
			25: [12],
			32: [6],
			31: [5],
			30: [5],
			29: [9],
			36: [3],
			37: [5],
			38: [5],
			39: [4]
		};
		const kept = new Set(Object.keys(solved).map(Number));
		const startTiles = startTilesFrom(49, solved);
		let sharesIntoReused = 0;
		for (let run = 0; run < 20; run++) {
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			const tiles = pregenerateForest(
				grid,
				{ treeCount: 4, sharingAmount: 1 },
				(event) => events.push(event),
				startTiles
			);
			// growth prefix only: after it, merge links join everything
			for (const event of events) {
				if (isMergeEvent(event)) {
					break;
				}
				if (event.type === 'move' && event.kind === MOVE_KIND.SHARE && kept.has(event.neighbour)) {
					sharesIntoReused += 1;
				}
			}
			expect(boardInvariants(grid, tiles).components).toBe(1);
		}
		expect(sharesIntoReused).toBeGreaterThan(0);
	});
});

describe('Regrow validity (ticket 03 parity)', () => {
	/**
	 * Start tiles with a contiguous BFS patch of the board erased - the
	 * region a uniqueness iteration discards around its ambiguities
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number[][]} tiles - a full solved board
	 * @param {Number} fraction - share of the playable cells to erase
	 * @returns {(Number[]|null)[]}
	 */
	function erasePatch(grid, tiles, fraction) {
		const playable = [...Array(grid.total).keys()].filter((index) => !grid.emptyCells.has(index));
		const target = Math.max(1, Math.floor(playable.length * fraction));
		const erased = new Set([playable[Math.floor(Math.random() * playable.length)]]);
		const queue = [...erased];
		for (let head = 0; erased.size < target && head < queue.length; head++) {
			for (const direction of grid.polygonAt(queue[head]).directions) {
				const { neighbour, empty } = grid.findNeighbour(queue[head], direction);
				if (empty || erased.has(neighbour)) {
					continue;
				}
				erased.add(neighbour);
				queue.push(neighbour);
				if (erased.size >= target) {
					break;
				}
			}
		}
		return tiles.map((pipes, index) => (erased.has(index) ? null : pipes));
	}

	/** @type {Array<{name: String, make: () => import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid}>} */
	const boards = [
		{ name: 'square 6x6', make: () => new SquareGrid(6, 6, false) },
		{ name: 'square 5x5 wrap', make: () => new SquareGrid(5, 5, true) },
		{
			name: 'square 6x6 with holes',
			make: () => new SquareGrid(6, 6, false, withHoles(36, [8, 14, 21, 27]))
		},
		{ name: 'hex 5x4', make: () => new HexaGrid(5, 4, false) },
		{ name: 'trihexagonal 3x3 (mixed)', make: () => new TrihexaGrid(3, 3, false) },
		{ name: 'snub square 4x4 (mixed)', make: () => new SnubSquareGrid(4, 4, false) },
		{ name: 'triangular 5x5', make: () => new TriangularGrid(5, 5, false) }
	];

	for (const board of boards) {
		for (const sharingAmount of [0, 0.5, 1]) {
			it(`Regrows a solver-solvable spanning tree on ${board.name}, sharing=${sharingAmount}`, () => {
				for (let run = 0; run < 3; run++) {
					const grid = board.make();
					const full = pregenerateForest(grid, { sharingAmount, branchingAmount: 0.5 });
					const startTiles = erasePatch(grid, full, 0.45);
					/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
					const events = [];
					const tiles = pregenerateForest(
						grid,
						{ sharingAmount, branchingAmount: 0.5 },
						(event) => events.push(event),
						startTiles
					);
					expect(boardInvariants(grid, tiles).components).toBe(1);
					expect(new Solver(tiles, grid).markAmbiguousTiles().solvable).toBe(true);
					replayEvents(grid, tiles, events);
				}
			});
		}
	}

	it('Regrows from real solver markings: scramble, solve, reuse, regrow', () => {
		for (let run = 0; run < 3; run++) {
			const grid = new SquareGrid(6, 6, false);
			const solved = pregenerateForest(grid, { sharingAmount: 0.5 });
			// scramble: one random rotation per tile, applied to all its
			// pipes together - the puzzle the solver actually sees
			const scrambled = solved.map((pipes, index) => {
				const polygon = grid.polygonAt(index);
				const rotations = Math.floor(Math.random() * polygon.numDirections);
				return pipes.map((pipe) => polygon.rotate(pipe, rotations));
			});
			const { solvable, marked } = new Solver(scrambled, grid).markAmbiguousTiles();
			expect(solvable).toBe(true);
			const startTiles = buildStartTiles(grid, scrambled, marked);
			/** @type {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} */
			const events = [];
			const tiles = pregenerateForest(
				grid,
				{ sharingAmount: 0.5 },
				(event) => events.push(event),
				startTiles
			);
			expect(boardInvariants(grid, tiles).components).toBe(1);
			expect(new Solver(tiles, grid).markAmbiguousTiles().solvable).toBe(true);
			replayEvents(grid, tiles, events);
		}
	});
});

describe('Start tiles from solver markings', () => {
	it('Rotates every pipe of a determined tile together and nulls the rest', () => {
		const grid = new SquareGrid(3, 1, false);
		// a crossing and a straight, one rotation each: E|W -> N|S and
		// N|S -> W|E, all pipes of a tile move together. The solver's
		// sentinels are negative rotations: -2 ambiguous, -1 unresolved
		const tiles = [[5, 10], [], [1]];
		const marked = [1, -2, 0];
		const startTiles = buildStartTiles(grid, tiles, marked);
		expect(startTiles[0]).toEqual([10, 5]);
		// ambiguous and empty cells hold null, determined untouched ones
		// keep their pipes
		expect(startTiles[1]).toBe(null);
		expect(startTiles[2]).toEqual([1]);
	});

	it('Treats every negative marking as a sentinel', () => {
		const grid = new SquareGrid(2, 1, false);
		const startTiles = buildStartTiles(grid, [[1], [2]], [-1, -7]);
		expect(startTiles).toEqual([null, null]);
	});
});

describe('Reuse planning (white-box)', () => {
	it('Builds one component per region of determined tiles linked by mutual edges', () => {
		const grid = new SquareGrid(4, 1, false);
		const startTiles = startTilesFrom(4, { 0: [1], 1: [5], 2: [5], 3: [4] });
		const plan = planReusedComponents(grid, startTiles, 3);
		expect(plan.components.length).toBe(1);
		// every end is mutual inside the region: nothing gets stripped
		expect(plan.components[0]).toEqual(
			new Map([
				[0, [1]],
				[1, [5]],
				[2, [5]],
				[3, [4]]
			])
		);
		expect(plan.keptCount).toBe(4);
	});

	it('Keeps the largest component even below the minimum count, stripped to its interior', () => {
		const grid = new SquareGrid(6, 1, false);
		const startTiles = startTilesFrom(6, { 0: [1], 1: [5] });
		const plan = planReusedComponents(grid, startTiles, 3);
		// two cells would be too small - kept anyway as the largest (and
		// only) component; cell 1's E end points at the erased cell 2, so
		// it is stripped down to the W end
		expect(plan.components.length).toBe(1);
		expect(plan.components[0]).toEqual(
			new Map([
				[0, [1]],
				[1, [4]]
			])
		);
		expect(plan.keptCount).toBe(2);
	});

	it('Keeps smaller components at the minimum count and drops the ones below it', () => {
		const grid = new SquareGrid(7, 1, false);
		const atMinimum = startTilesFrom(7, {
			0: [1],
			1: [5],
			2: [4],
			4: [1],
			5: [5],
			6: [4]
		});
		const kept = planReusedComponents(grid, atMinimum, 3);
		expect(kept.components.length).toBe(2);
		expect(kept.keptCount).toBe(6);
		// the second region shrinks to two cells: too small, erased
		const belowMinimum = startTilesFrom(7, {
			0: [1],
			1: [5],
			2: [4],
			4: [1],
			5: [5]
		});
		const dropped = planReusedComponents(grid, belowMinimum, 3);
		expect(dropped.components.length).toBe(1);
		expect(dropped.keptCount).toBe(3);
	});

	it('A pipe stripped to no ends disappears; a cell left with no pipes is not reused', () => {
		const grid = new SquareGrid(3, 3, false);
		// a lone crossing, every neighbour erased: the largest-component
		// rule keeps it, stripping empties it - nothing survives
		const startTiles = startTilesFrom(9, { 4: [5, 10] });
		const plan = planReusedComponents(grid, startTiles, 3);
		expect(plan.components.length).toBe(0);
		expect(plan.keptCount).toBe(0);
	});

	it('Reuses one pipe of a shared cell and drops its disappearing sibling', () => {
		const grid = new SquareGrid(3, 3, false);
		// the E-W straight of the crossing joins a three-cell component;
		// its N-S sibling matches only erased cells and vanishes
		const startTiles = startTilesFrom(9, { 3: [1], 4: [5, 10], 5: [4] });
		const plan = planReusedComponents(grid, startTiles, 3);
		expect(plan.components.length).toBe(1);
		expect(plan.components[0]).toEqual(
			new Map([
				[3, [1]],
				[4, [5]],
				[5, [4]]
			])
		);
		expect(plan.keptCount).toBe(3);
	});

	it('Lets two kept components share one cell, counting the cell once', () => {
		const grid = new SquareGrid(3, 3, false);
		// a crossing whose straights each anchor their own three-cell
		// component: both reach the minimum, both stay
		const startTiles = startTilesFrom(9, {
			1: [8],
			3: [1],
			4: [5, 10],
			5: [4],
			7: [2]
		});
		const plan = planReusedComponents(grid, startTiles, 3);
		expect(plan.components.length).toBe(2);
		expect(plan.keptCount).toBe(5);
		const crossingPipes = plan.components.map((component) => component.get(4)?.[0]);
		crossingPipes.sort((a, b) => /** @type {Number} */ (a) - /** @type {Number} */ (b));
		expect(crossingPipes).toEqual([5, 10]);
	});

	it('Ignores start tiles at empty cells', () => {
		const playable = [0, 1, 1, 1];
		const grid = new SquareGrid(4, 1, false, playable);
		// cell 0 is empty, its stray start tile is disregarded; cell 1's
		// W end points at that wall and gets stripped too
		const startTiles = startTilesFrom(4, { 0: [1], 1: [5], 2: [5] });
		const plan = planReusedComponents(grid, startTiles, 3);
		expect(plan.components.length).toBe(1);
		expect(plan.components[0]).toEqual(
			new Map([
				[1, [1]],
				[2, [4]]
			])
		);
		expect(plan.keptCount).toBe(2);
	});
});

describe('Uniqueness loop (public seam)', () => {
	/**
	 * Enumerates every solution of a scrambled board with the solver, the
	 * verifyUnique oracle of the classic generator tests
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number[][]} tiles
	 * @returns {Number}
	 */
	function countSolutions(grid, tiles) {
		const solver = new Solver(tiles, grid);
		for (const _ of solver.solve(true)) {
		}
		return solver.solutions.length;
	}

	/** @type {Array<{name: String, make: () => import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid}>} */
	const boards = [
		{ name: 'square 5x5', make: () => new SquareGrid(5, 5, false) },
		{ name: 'square 5x5 wrap', make: () => new SquareGrid(5, 5, true) },
		{ name: 'hex 5x4', make: () => new HexaGrid(5, 4, false) },
		{ name: 'hex 6x5 wrap', make: () => new HexaGrid(6, 5, true) },
		{ name: 'trihexagonal 3x3 (mixed)', make: () => new TrihexaGrid(3, 3, false) },
		{ name: 'snub square 4x4 (mixed)', make: () => new SnubSquareGrid(4, 4, false) },
		{ name: 'triangular 5x5', make: () => new TriangularGrid(5, 5, false) }
	];

	for (const board of boards) {
		it(`Generates a solver-unique puzzle on ${board.name}`, () => {
			for (let run = 0; run < 3; run++) {
				const grid = board.make();
				const generator = new MultiGenerator(grid);
				const tiles = generator.generate(0.35, 0.5, 0, 'unique');
				// verifyUnique-style: enumerate every solution, expect one
				expect(countSolutions(grid, tiles)).toBe(1);
				const { solvable, unique, marked } = new Solver(tiles, grid).markAmbiguousTiles();
				expect(solvable).toBe(true);
				expect(unique).toBe(true);
				// the scramble is a pure rotation: solving recovers a valid board
				expect(() => validateMulti(grid, applyRotations(grid, tiles, marked))).not.toThrow();
			}
		}, 120000);
	}

	it('Generates solver-unique puzzles at maximum sharing too', () => {
		for (let run = 0; run < 3; run++) {
			const grid = new SquareGrid(5, 5, false);
			const tiles = new MultiGenerator(grid).generate(1, 0.5, 0, 'unique');
			expect(countSolutions(grid, tiles)).toBe(1);
		}
	}, 120000);

	it('Defaults to the forest knob values (sharing 0.35, tree count formula)', () => {
		const grid = new SquareGrid(5, 5, false);
		const tiles = new MultiGenerator(grid).generate();
		const { solvable, unique } = new Solver(tiles, grid).markAmbiguousTiles();
		expect(solvable).toBe(true);
		expect(unique).toBe(true);
		// classic budgets: patience 5, 100 iterations, 100 attempts
		const generator = new MultiGenerator(grid);
		expect(generator.uniqueness_patience).toBe(5);
		expect(generator.max_uniqueness_iterations).toBe(100);
		expect(generator.max_attempts).toBe(100);
		expect(generator.reuse_tiles_min_count).toBe(3);
	}, 120000);

	it('Whatever mode returns a scrambled, solver-solvable board without uniqueness work', () => {
		for (let run = 0; run < 3; run++) {
			const grid = new SquareGrid(5, 5, false);
			const tiles = new MultiGenerator(grid).generate(0.35, 0.5, 0, 'whatever');
			const { solvable, marked } = new Solver(tiles, grid).markAmbiguousTiles();
			expect(solvable).toBe(true);
			expect(() => validateMulti(grid, applyRotations(grid, tiles, marked))).not.toThrow();
		}
	});

	it('Multiple mode returns a board the solver does not find unique', () => {
		// occasionally no multiple-solution board comes up, retry the way
		// the old generator's test did
		for (let attempt = 0; attempt < 5; attempt++) {
			const grid = new SquareGrid(4, 4, false);
			try {
				const tiles = new MultiGenerator(grid, 3, 5, 100).generate(0.35, 0.5, 0, 'multiple');
				expect(new Solver(tiles, grid).markAmbiguousTiles().unique).toBe(false);
				return;
			} catch {
				// try again
			}
		}
	});

	it('Reports progress and rejects unknown solutionsNumber settings', () => {
		const grid = new SquareGrid(4, 4, false);
		/** @type {import('#lib/puzzle/generator/generator-forest.js').GeneratorProgress[]} */
		const generatorProgress = [];
		/** @type {import('#lib/puzzle/solver/solver.js').SolverProgress[]} */
		const solverProgress = [];
		const generator = new MultiGenerator(
			grid,
			3,
			5,
			10,
			10,
			(progress) => solverProgress.push(progress),
			(progress) => generatorProgress.push(progress)
		);
		generator.generate(0.35, 0.5, 0, 'unique');
		expect(generatorProgress.length).toBeGreaterThan(0);
		expect(solverProgress.length).toBeGreaterThan(0);
		expect(() => generator.generate(0.35, 0.5, 0, /** @type {any} */ ('bogus'))).toThrow(
			'Unknown setting for solutionsNumber'
		);
	}, 60000);

	it('Yields contract-complete snapshots: reuse feeds the next iteration, the loop stops at unique', () => {
		// small boards are usually unique on iteration one; a 12x12 needs
		// a retry or two before a multi-iteration run shows up
		const grid = new SquareGrid(12, 12, false);
		/** @type {import('#lib/puzzle/generator/generator-forest.js').IterationSnapshot[]|undefined} */
		let snapshots = undefined;
		for (let run = 0; run < 15 && snapshots === undefined; run++) {
			const stepped = [...new MultiGenerator(grid).uniqueIterations(0.35, 0.5)];
			if (stepped.length > 1) {
				snapshots = stepped;
			}
		}
		expect(snapshots).not.toBeUndefined();
		const steps =
			/** @type {import('#lib/puzzle/generator/generator-forest.js').IterationSnapshot[]} */ (
				snapshots
			);
		const last = steps.at(-1);
		expect(last?.unique).toBe(true);
		// only the last snapshot may be unique - the loop stops there
		expect(steps.slice(0, -1).every((snapshot) => !snapshot.unique)).toBe(true);
		let previousAttempt = 0;
		let previousIteration = 0;
		for (const [index, snapshot] of steps.entries()) {
			// snapshot fields complete per contract
			expect(snapshot.tiles.length).toBe(grid.total);
			expect(snapshot.marked.length).toBe(grid.total);
			expect(snapshot.numAmbiguous).toBeGreaterThanOrEqual(0);
			expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(0);
			// attempt and iteration numbering: attempts count up, iterations
			// count up within an attempt and restart with each new one
			if (snapshot.attempt === previousAttempt) {
				expect(snapshot.iteration).toBe(previousIteration + 1);
			} else {
				expect(snapshot.attempt).toBe(previousAttempt + 1);
				expect(snapshot.iteration).toBe(1);
			}
			previousAttempt = snapshot.attempt;
			previousIteration = snapshot.iteration;
			if (index === 0) {
				// the first board of the first attempt is fresh
				expect(snapshot.keptCount).toBe(0);
			}
		}
		// a non-unique iteration hands its determined tiles to the next
		// one: some later snapshot reused them
		expect(steps.slice(1).some((snapshot) => snapshot.keptCount > 0)).toBe(true);
	}, 120000);

	it('Honors the attempt and iteration budgets', () => {
		const grid = new SquareGrid(5, 5, false);
		// one iteration per attempt, two attempts: at most two snapshots,
		// each the first iteration of its attempt
		const capped = [...new MultiGenerator(grid, 3, 5, 2, 1).uniqueIterations(0.35, 0.5)];
		expect(capped.length).toBeLessThanOrEqual(2);
		expect(capped.every((snapshot) => snapshot.iteration === 1)).toBe(true);
		if (capped.length === 2) {
			expect(capped[1].attempt).toBe(2);
		}
	}, 60000);

	it('Scrambles all pipes of a tile together: the scrambled board keeps the same unique solution', () => {
		/**
		 * A solved board up to pipe order within a tile: a tile's state is
		 * the multiset of its pipes (which pipe sits at which index is not
		 * observable - the player rotates the whole tile)
		 * @param {Number[][]} tiles
		 */
		const canonical = (tiles) => tiles.map((pipes) => [...pipes].sort((a, b) => a - b));
		for (let run = 0; run < 5; run++) {
			const grid = new SquareGrid(5, 5, false);
			const generator = new MultiGenerator(grid);
			/** @type {import('#lib/puzzle/generator/generator-forest.js').IterationSnapshot|undefined} */
			let unique = undefined;
			for (const snapshot of generator.uniqueIterations(0.35, 0.5)) {
				if (snapshot.unique) {
					unique = snapshot;
				}
			}
			expect(unique).not.toBeUndefined();
			const snapshotTiles = /** @type {any} */ (unique).tiles;
			const solved = applyRotations(grid, snapshotTiles, /** @type {any} */ (unique).marked);
			// the scramble: one random rotation per tile, all its pipes together
			const scrambled = randomRotate(snapshotTiles, grid);
			const {
				solvable,
				unique: isUnique,
				marked
			} = new Solver(scrambled, grid).markAmbiguousTiles();
			expect(solvable).toBe(true);
			expect(isUnique).toBe(true);
			// solving the scramble recovers exactly the snapshot's solved
			// orientation - only possible when every pipe of a tile moved
			// by the same rotation
			expect(canonical(applyRotations(grid, scrambled, marked))).toEqual(canonical(solved));
		}
	}, 120000);
});

/**
 * Whether an event belongs to the merge phase: links and fusions. The
 * growth prefix of an event stream ends at the first merge event - the
 * merge phase changes tile shapes by design, so growth invariants are
 * measured on the prefix.
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent} event
 * @returns {boolean}
 */
function isMergeEvent(event) {
	return event.type === 'fuse' || (event.type === 'move' && event.kind === MOVE_KIND.LINK);
}

/**
 * Start tiles from solved pipes: every unlisted (or empty) cell holds
 * null, the listed cells hold their solved pipes as given
 * @param {Number} total
 * @param {Record<Number, Number[]>} solved
 * @returns {(Number[]|null)[]}
 */
function startTilesFrom(total, solved) {
	return Array.from({ length: total }, (_, index) => solved[index] ?? null);
}

/**
 * Number of trees a growth run actually opened, from its seed events
 * (post-merge component counts are always 1, so the growth-phase tree
 * count is observable only through the event stream)
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} events
 */
function seedCount(events) {
	return events.filter((event) => event.type === 'move' && event.kind === MOVE_KIND.SEED).length;
}

/**
 * Cells covered by reuse events, the material regrowth started from
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} events
 * @returns {Set<Number>}
 */
function reusedCells(events) {
	/** @type {Set<Number>} */
	const cells = new Set();
	for (const event of events) {
		if (event.type === 'reuse') {
			for (const entry of event.cells) {
				cells.add(entry.cell);
			}
		}
	}
	return cells;
}

/**
 * Replays only the growth part of an event stream onto an empty board:
 * reuse loads, then every move up to the first merge event (link or
 * fusion). The merge phase changes tile shapes by design, so regrowth
 * invariants are measured on the growth prefix
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} events
 * @returns {Number[][]} board as growth left it
 */
function replayGrowthPrefix(grid, events) {
	/** @type {Number[][]} */
	const board = Array.from({ length: grid.total }, () => []);
	for (const event of events) {
		if (isMergeEvent(event)) {
			break;
		}
		applyForestEvent(grid, board, event);
	}
	return board;
}

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
 * Replays growth and merge events onto an empty board, asserting after
 * every event that all pipe ends created so far lock onto matching ends
 * (atomicity), that neither touched tile became a fully connected
 * deadend union (hard ban, including the newborn pipe of
 * extend/share/seed moves), that the union-find mirrors the events (a
 * share move never merges components during growth; a link or fusion
 * merges exactly two), and that the final board equals the returned one.
 * The growth-phase invariant that all pipes of a tile sit in distinct
 * components is dropped after the merge begins: once links and fusions
 * fire, a shared tile can legitimately hold same-component pipes,
 * connected via paths around the board.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @param {import('#lib/puzzle/generator/generator-forest.js').ForestEvent[]} events
 */
function replayEvents(grid, tiles, events) {
	/** @type {Number[][]} */
	const board = Array.from({ length: grid.total }, () => []);
	let uf = new UnionFind();
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
	/**
	 * Rebuilds a union-find from the board's locked edges - an oracle
	 * independent of the event bookkeeping. After a fusion the pre-fusion
	 * node ids no longer line up with the spliced tile, so the replay
	 * continues on a rebuilt union-find
	 * @returns {UnionFind}
	 */
	const rebuildUf = () => {
		const fresh = new UnionFind();
		for (let cell = 0; cell < grid.total; cell++) {
			for (let pipeIndex = 0; pipeIndex < board[cell].length; pipeIndex++) {
				fresh.add(grid.pipeNodeId(cell, pipeIndex));
			}
		}
		for (let cell = 0; cell < grid.total; cell++) {
			for (const direction of grid.polygonAt(cell).directions) {
				for (let pipeIndex = 0; pipeIndex < board[cell].length; pipeIndex++) {
					if ((board[cell][pipeIndex] & direction) === 0) {
						continue;
					}
					const { neighbour, empty } = grid.findNeighbour(cell, direction);
					if (empty) {
						throw new Error(`unlocked end at ${cell} pointing at a wall`);
					}
					const back = grid.OPPOSITE.get(direction) || 0;
					const other = board[neighbour].findIndex((pipe) => (pipe & back) > 0);
					if (other >= 0) {
						// each edge is visited from both sides; the second
						// union is a harmless no-op
						fresh.union(grid.pipeNodeId(cell, pipeIndex), grid.pipeNodeId(neighbour, other));
					}
				}
			}
		}
		return fresh;
	};
	/**
	 * Every end created so far must have its locked match across the edge
	 */
	const assertAllEndsLocked = () => {
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
	};
	for (const event of events) {
		const before = uf.count;
		if (event.type === 'fuse') {
			board[event.cell][event.firstPipeIndex] |= board[event.cell][event.secondPipeIndex];
			board[event.cell].splice(event.secondPipeIndex, 1);
			if (
				!uf.union(
					grid.pipeNodeId(event.cell, event.firstPipeIndex),
					grid.pipeNodeId(event.cell, event.secondPipeIndex)
				)
			) {
				throw new Error('a fuse event joined two pipes of one component');
			}
			if (uf.count - before !== -1) {
				throw new Error('a fuse event changed the component count by something else than -1');
			}
			// the splice shifted pipe indices: continue on a union-find
			// rebuilt from the board, which must agree with the events so far
			const rebuilt = rebuildUf();
			if (rebuilt.count !== uf.count) {
				throw new Error('the rebuilt union-find disagrees with the event stream');
			}
			uf = rebuilt;
			if (fullyConnectedDeadend(event.cell)) {
				throw new Error(`fusion created a fully connected deadend at ${event.cell}`);
			}
			continue;
		}
		if (event.type === 'reuse') {
			// loaded material arrives as whole components: every kept end
			// mutual-matches inside the component, which joins no foreign
			// component - the board is the ground truth, so the union-find
			// is rebuilt from it
			const loadedComponents = pipeComponents(grid, board);
			applyForestEvent(grid, board, event);
			uf = rebuildUf();
			if (uf.count !== loadedComponents + 1) {
				throw new Error(
					`a reuse event changed the component count by ${uf.count - loadedComponents}`
				);
			}
			for (const entry of event.cells) {
				if (fullyConnectedDeadend(entry.cell)) {
					throw new Error(`reused tile ${entry.cell} is fully connected and contains a deadend`);
				}
			}
			assertAllEndsLocked();
			continue;
		}
		// same-root pairs of the touched tiles before the move: growth
		// never links, so no new pair may appear (reused tiles can load
		// with same-component pipes - those pairs predate the move)
		/** @type {Map<Number, Set<String>>} */
		const pairsBefore = new Map();
		for (const cell of [event.fromCell, event.neighbour]) {
			pairsBefore.set(cell, sameRootPairs(grid, uf, board, cell));
		}
		applyForestEvent(grid, board, event);
		// register what the move birthed, then lock its edge in the
		// union-find exactly like the engine does
		if (event.kind === MOVE_KIND.SEED) {
			uf.add(grid.pipeNodeId(event.fromCell, event.fromPipeIndex));
		}
		uf.add(grid.pipeNodeId(event.neighbour, event.neighbourPipeIndex));
		if (
			!uf.union(
				grid.pipeNodeId(event.fromCell, event.fromPipeIndex),
				grid.pipeNodeId(event.neighbour, event.neighbourPipeIndex)
			)
		) {
			throw new Error(`a ${event.kind} move closed a cycle`);
		}
		// extend and share birth one pipe and lock it onto an existing one:
		// the component count is unchanged; a seed births two pipes joined
		// into one new component; a link joins two existing components
		const delta = uf.count - before;
		if (delta !== (event.kind === MOVE_KIND.SEED ? 1 : event.kind === MOVE_KIND.LINK ? -1 : 0)) {
			throw new Error(`a ${event.kind} move changed the component count by ${delta}`);
		}
		// growth-phase only: pipes sharing a tile never connect, so no
		// two pipes of a touched tile may share a component that did not
		// share one before the move. Links and fusions legitimately break
		// this once components meet
		if (event.kind !== MOVE_KIND.LINK) {
			for (const cell of [event.fromCell, event.neighbour]) {
				for (const pair of sameRootPairs(grid, uf, board, cell)) {
					if (!(/** @type {Set<String>} */ (pairsBefore.get(cell)).has(pair))) {
						throw new Error(`a ${event.kind} move paired two pipes of tile ${cell}`);
					}
				}
			}
		}
		if (fullyConnectedDeadend(event.fromCell)) {
			throw new Error(`move created a fully connected deadend at ${event.fromCell}`);
		}
		if (fullyConnectedDeadend(event.neighbour)) {
			throw new Error(`move created a fully connected deadend at ${event.neighbour}`);
		}
		assertAllEndsLocked();
	}
	expect(board).toEqual(tiles);
}

/**
 * Same-root pipe pairs of one tile, as 'i_j' keys, for the growth
 * replay's no-new-pair check
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {UnionFind} uf
 * @param {Number[][]} board
 * @param {Number} cell
 * @returns {Set<String>}
 */
function sameRootPairs(grid, uf, board, cell) {
	/** @type {Set<String>} */
	const pairs = new Set();
	for (let i = 0; i < board[cell].length; i++) {
		for (let j = i + 1; j < board[cell].length; j++) {
			if (uf.find(grid.pipeNodeId(cell, i)) === uf.find(grid.pipeNodeId(cell, j))) {
				pairs.add(`${i}_${j}`);
			}
		}
	}
	return pairs;
}

/**
 * Number of pipe node components on a board, over mutual locked edges
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} board
 * @returns {Number}
 */
function pipeComponents(grid, board) {
	const uf = new UnionFind();
	for (let cell = 0; cell < grid.total; cell++) {
		for (let pipeIndex = 0; pipeIndex < board[cell].length; pipeIndex++) {
			uf.add(grid.pipeNodeId(cell, pipeIndex));
		}
	}
	for (let cell = 0; cell < grid.total; cell++) {
		for (let pipeIndex = 0; pipeIndex < board[cell].length; pipeIndex++) {
			for (const direction of grid.polygonAt(cell).directions) {
				if ((board[cell][pipeIndex] & direction) === 0) {
					continue;
				}
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				if (empty) {
					continue;
				}
				const back = grid.OPPOSITE.get(direction) || 0;
				const other = board[neighbour].findIndex((pipe) => (pipe & back) > 0);
				if (other >= 0) {
					uf.union(grid.pipeNodeId(cell, pipeIndex), grid.pipeNodeId(neighbour, other));
				}
			}
		}
	}
	return uf.count;
}
