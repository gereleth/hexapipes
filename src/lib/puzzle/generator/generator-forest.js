import { computeCellObviousTiles } from './generator.js';
import { popcount } from '#lib/puzzle/grids/bitmasks.js';

/**
 * The four kinds of an atomic edge move, classified by what exists on each
 * side of the edge before the move (the design doc's table):
 *
 *                     | B has an existing pipe | B is fresh (pipe born there) |
 * A's pipe exists     | link (merge/revisit)   | extend (classic grow)         |
 * new pipe born in A  | share at A             | seed (new strand start)       |
 */
export const MOVE_KIND = Object.freeze({
	LINK: 'link',
	EXTEND: 'extend',
	SHARE: 'share',
	SEED: 'seed'
});

/**
 * Move tiers from best to worst. A growth point's candidates are bucketed
 * by tier and the best non-empty tier wins; demotions push a move down.
 */
export const TIER = Object.freeze({
	NORMAL: 0,
	SHARE: 1,
	STRAIGHT: 2,
	OBVIOUS: 3,
	CLEAN_FULL: 4
});

/**
 * @param {boolean} sourceHasPipe
 * @param {boolean} targetHasPipe
 * @returns {String} one of MOVE_KIND values
 */
export function classifyMoveKind(sourceHasPipe, targetHasPipe) {
	if (sourceHasPipe) {
		return targetHasPipe ? MOVE_KIND.LINK : MOVE_KIND.EXTEND;
	}
	return targetHasPipe ? MOVE_KIND.SHARE : MOVE_KIND.SEED;
}

/**
 * Tier of a candidate move: its kind sets the floor (sharing is only
 * considered after plain moves), demotion flags raise it, the worst wins.
 * @param {String} kind - one of MOVE_KIND values
 * @param {{straight?: boolean, obvious?: boolean, cleanFull?: boolean}} [demotions]
 * @returns {Number} one of TIER values
 */
export function moveTier(kind, demotions = {}) {
	/** @type {Number} */
	let tier = kind === MOVE_KIND.SHARE ? TIER.SHARE : TIER.NORMAL;
	if (demotions.straight) {
		tier = Math.max(tier, TIER.STRAIGHT);
	}
	if (demotions.obvious) {
		tier = Math.max(tier, TIER.OBVIOUS);
	}
	if (demotions.cleanFull) {
		tier = Math.max(tier, TIER.CLEAN_FULL);
	}
	return tier;
}

/**
 * Shuffles an array in place (Fisher-Yates)
 * @param {any[]} array
 * @returns {any[]} the same array
 */
function shuffleInPlace(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

/**
 * State of one tile after a hypothetical move adds addedMask to one of
 * its pipes (or to a newborn pipe when pipeIndex is negative; a pipeIndex
 * beyond the last pipe attaches the mask to no existing pipe, which with
 * a zero mask simply evaluates the tile as it stands). The growth
 * hard-ban checks and the merge hard-ban checks share this one
 * definition.
 * @param {Number[]} pipes
 * @param {Number} fullyConnected
 * @param {Number} pipeIndex
 * @param {Number} addedMask
 * @returns {{full: boolean, deadend: boolean}}
 */
function tileStateAfter(pipes, fullyConnected, pipeIndex, addedMask) {
	let union = 0;
	let deadend = false;
	for (let i = 0; i < pipes.length; i++) {
		const mask = i === pipeIndex ? pipes[i] | addedMask : pipes[i];
		union |= mask;
		deadend ||= popcount(mask) === 1;
	}
	if (pipeIndex < 0) {
		union |= addedMask;
		deadend ||= popcount(addedMask) === 1;
	}
	return { full: union === fullyConnected, deadend };
}

/**
 * BFS hop distances from a cell over playable cells, kept as the minimum
 * over all seeds processed so far; unreachable cells stay at Infinity
 * (they belong to other regions behind walls).
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number} start
 * @param {Number[]} distances - result buffer, distances[start] must be set
 */
function bfsDistances(grid, start, distances) {
	const queue = [start];
	for (let head = 0; head < queue.length; head++) {
		const cell = queue[head];
		for (let direction of grid.polygonAt(cell).directions) {
			const { neighbour, empty } = grid.findNeighbour(cell, direction);
			if (empty) {
				continue;
			}
			const candidate = distances[cell] + 1;
			if (distances[neighbour] === -1 || candidate >= distances[neighbour]) {
				continue;
			}
			distances[neighbour] = candidate;
			queue.push(neighbour);
		}
	}
}

/**
 * Farthest-point sampling of seed cells over the playable cells of the
 * grid: every next seed is the playable cell with the greatest BFS hop
 * distance to the seeds chosen so far, which keeps the K trees spatially
 * balanced. Unreachable cells (other regions) win the next pick, so every
 * region gets seeded as long as the count allows.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number} count - wanted seed count, capped at playable cells
 * @param {Number} firstSeed - playable cell to start from
 * @returns {Number[]} chosen seed cells, firstSeed included
 */
export function farthestPointSeeds(grid, count, firstSeed) {
	if (grid.emptyCells.has(firstSeed)) {
		throw new Error(`farthestPointSeeds: first seed ${firstSeed} is an empty cell`);
	}
	/** @type {Number[]} */
	const seeds = [firstSeed];
	const distances = Array.from({ length: grid.total }, (_, index) =>
		grid.emptyCells.has(index) ? -1 : Infinity
	);
	distances[firstSeed] = 0;
	bfsDistances(grid, firstSeed, distances);
	const playableCount = distances.filter((d) => d !== -1).length;
	while (seeds.length < Math.min(count, playableCount)) {
		let farthest = -1;
		let farthestDistance = -Infinity;
		for (let index = 0; index < grid.total; index++) {
			if (distances[index] > farthestDistance) {
				farthest = index;
				farthestDistance = distances[index];
			}
		}
		seeds.push(farthest);
		distances[farthest] = 0;
		bfsDistances(grid, farthest, distances);
	}
	return seeds;
}

/**
 * State of one direction of one tile, see GLOSSARY: tile. Replaces
 * the classic visited/unvisited vocabulary: a growth point is a pipe plus
 * a FREE direction of its tile, and at most one pipe end per direction
 * per tile holds by construction.
 */
export const CLAIM_STATE = Object.freeze({
	FREE: 'free',
	CLAIMED: 'claimed',
	WALL: 'wall'
});

/**
 * Derives the claim state of one direction of one tile from the board on
 * demand: CLAIMED is exactly "some pipe of the tile holds the direction
 * bit" and WALL is exactly "the neighbour is an empty cell or the
 * outside". Keeping no second claim map means there is nothing to fall
 * out of sync with the tiles when later tickets add mutation paths.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @param {Number} cell
 * @param {Number} direction
 * @returns {String} one of CLAIM_STATE values
 */
export function directionState(grid, tiles, cell, direction) {
	if (grid.findNeighbour(cell, direction).empty) {
		return CLAIM_STATE.WALL;
	}
	return tiles[cell].some((pipe) => (pipe & direction) > 0)
		? CLAIM_STATE.CLAIMED
		: CLAIM_STATE.FREE;
}

/**
 * Union-find over pipe node ids (see GLOSSARY: pipe node). Each locked edge
 * unions the two pipes it connects; refusing a union inside one component
 * is the cycle guard that keeps every tree loop-free.
 */ export class UnionFind {
	/** @type {Map<Number, Number>} node id => parent node id */
	#parent = new Map();
	/** @type {Map<Number, Number>} root id => subtree size */
	#size = new Map();
	/** @type {Number} number of distinct components */
	#count = 0;

	/** @param {Number} node */
	add(node) {
		if (this.#parent.has(node)) {
			return false;
		}
		this.#parent.set(node, node);
		this.#size.set(node, 1);
		this.#count += 1;
		return true;
	}

	/**
	 * @param {Number} node
	 * @returns {Number} root of the node's component
	 */
	find(node) {
		let root = this.#parent.get(node);
		if (root === undefined) {
			throw new Error(`UnionFind.find: unknown node ${node}`);
		}
		while (root !== node) {
			node = root;
			root = /** @type {Number} */ (this.#parent.get(node));
		}
		return root;
	}

	/**
	 * @param {Number} a
	 * @param {Number} b
	 * @returns {boolean} true if two components became one, false if the edge
	 * was refused - a and b are already the same component (a cycle)
	 */
	union(a, b) {
		let ra = this.find(a);
		let rb = this.find(b);
		if (ra === rb) {
			return false;
		}
		if (/** @type {Number} */ (this.#size.get(ra)) < /** @type {Number} */ (this.#size.get(rb))) {
			[ra, rb] = [rb, ra];
		}
		this.#parent.set(rb, ra);
		this.#size.set(
			ra,
			/** @type {Number} */ (this.#size.get(ra)) + /** @type {Number} */ (this.#size.get(rb))
		);
		this.#size.delete(rb);
		this.#count -= 1;
		return true;
	}

	/** @returns {Number} number of components among registered nodes */
	get count() {
		return this.#count;
	}
}

/**
 * A growth event of the forest engine, see pregenerateForest. Every event
 * is one atomic edge move: both of its pipe ends come into existence at the
 * same instant, so replaying the stream never shows an unlocked pipe end.
 * Seed births a new pipe at the source cell, every other kind extends the
 * acting pipe there; every kind except link births the neighbour-side
 * newborn pipe, link locks onto an existing pipe there.
 * @typedef {{type: 'move', kind: 'link'|'extend'|'share'|'seed', fromCell: Number,
 * fromPipeIndex: Number, direction: Number, neighbour: Number,
 * neighbourPipeIndex: Number}} ForestMove
 */

/**
 * A fusion event of the merge phase: two pipes of one tile, in two
 * different components, combined into one pipe - the bitwise or of their
 * masks, so two deadends such as [1] and [2] become the bend [3], but any
 * two pipes may fuse. The surviving pipe keeps firstPipeIndex, the other
 * disappears, so pipe indices above secondPipeIndex in that tile shift
 * down by one.
 * @typedef {{type: 'fuse', cell: Number, firstPipeIndex: Number,
 * secondPipeIndex: Number}} ForestFuse
 */

/** @typedef {ForestMove | ForestFuse} ForestEvent */

/**
 * Applies one growth or merge event to a board: the replay counterpart of
 * the engine's moves, shared by the debug animation and tests so the event
 * stream mirrors the engine's tiles exactly once everywhere.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} board
 * @param {ForestEvent} event
 */
export function applyForestEvent(grid, board, event) {
	if (event.type === 'fuse') {
		board[event.cell][event.firstPipeIndex] |= board[event.cell][event.secondPipeIndex];
		board[event.cell].splice(event.secondPipeIndex, 1);
		return;
	}
	const back = grid.OPPOSITE.get(event.direction) || 0;
	if (event.kind === MOVE_KIND.SEED) {
		board[event.fromCell].push(event.direction);
	} else {
		board[event.fromCell][event.fromPipeIndex] |= event.direction;
	}
	if (event.kind === MOVE_KIND.LINK) {
		board[event.neighbour][event.neighbourPipeIndex] |= back;
	} else {
		board[event.neighbour].push(back);
	}
}

/**
 * Knobs of the forest generator, all complete from the start even where
 * later tickets fill the behavior in
 * @typedef {object} ForestKnobs
 * @property {Number} [sharingAmount=0] - probability that a pick considers
 * the share tier at all: entering an occupied foreign cell (no pipe of the
 * tip's tree there) by birthing a new pipe in it, values in range [0,1].
 * Zero hard-guarantees boards where every tile holds exactly one pipe.
 * @property {Number} [branchingAmount=0.5] - frontier selection only: 0 picks
 * the most recent growth point (winding), 1 a uniform random one (bushy)
 * @property {Number} [avoidObvious=0] - demotes moves that would make a tile
 * instantly solvable from walls, values in range [0,1]
 * @property {Number} [avoidStraights=0] - demotes moves that make a straight
 * pipe, values in range [0,1]
 * @property {Number} [treeCount=0] - number of trees to grow from seeds;
 * 0 means the default 1 + round(sqrt(playable cells))
 */

/** Growth attempts before giving up on a board */
const MAX_ATTEMPTS = 20;

/**
 * A deterministic board defect no retry can fix: a playable cell walled
 * in from all sides can never hold a pipe, because an atomic edge move
 * needs two endpoints. Rethrown without retrying.
 */
class IsolatedCellError extends Error {}

/**
 * The merge phase ran out of moves with components remaining: every
 * cross-component edge is hard-ban sealed and no tile hosts pipes of two
 * different components. Not deterministic doom in general - a fresh
 * growth roll usually opens a seam - so the attempt loop retries on it.
 * A wall-sealed seam (empty cells splitting the playable region) is the
 * deterministic version.
 */
export class UnmergeableBoardError extends Error {}

/**
 * Default number of trees, scaling with the board size
 * @param {Number} playableCount
 * @returns {Number}
 */
export function defaultTreeCount(playableCount) {
	return 1 + Math.round(Math.sqrt(playableCount));
}

/**
 * Returns a random element from an array
 * @param {any[]} array
 * @returns {any}
 */
function getRandomElement(array) {
	return array[Math.floor(Math.random() * array.length)];
}

/**
 * A growing tree: its tips (pipe node ids) split across classic's three
 * lists - the active frontier (classic's visited), avoiding (tips whose
 * best move is obvious-demoted, classic parks them there) and lastResort
 * (tips whose best move completes a clean full union). Tips move one way
 * only: frontier -> avoiding/lastResort at park, out of a pool at death.
 * @typedef {{frontier: Number[], avoiding: Number[], lastResort: Number[]}} Tree
 */

/**
 * One growth attempt, see pregenerateForest. Grows treeCount independent
 * trees from farthest-point seeds until no tree can move anymore; a tip
 * reaching a cell held by another tree may birth a new pipe there (a
 * sharing event) per the sharing knob, so trees braid through each other's
 * territory without their pipes ever connecting. A tip whose best move
 * sits in the obvious or clean-full tier is not acted on - it parks in
 * classic's avoiding/lastResort lists, and parked moves fire only when no
 * active tip anywhere can move. Throws when cells remain uncovered
 * (degenerate boards).
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Required<ForestKnobs>} knobs
 * @param {ForestEvent[]} events - collects this attempt's growth events
 * @returns {Number[][]} - unrandomized multipipes tiles
 */
function growAttempt(grid, knobs, events) {
	const total = grid.total;
	/** @type {Number[][]} */
	const tiles = Array.from({ length: total }, () => []);
	/** @type {Number[]} playable cell indices */
	const playable = [];
	for (let index = 0; index < total; index++) {
		if (!grid.emptyCells.has(index)) {
			playable.push(index);
		}
	}
	if (playable.length === 0) {
		return tiles;
	}

	const uf = new UnionFind();
	const opposite = grid.OPPOSITE;
	// triangular-grid caveat ported from classic: full-union demotions are
	// skipped there, triangles need their full connections too often
	const demoteFullUnion = grid.KIND !== 'triangular';

	// classic avoid-obvious port: precomputed once at growth start over all
	// non-empty cells; consulting already-visited cells against it is intended
	/** @type {Map<Number, Set<Number>>} */
	const obviousTiles =
		knobs.avoidObvious > 0 ? computeCellObviousTiles(grid, new Set(playable)) : new Map();

	const treeCount = Math.min(
		knobs.treeCount > 0 ? knobs.treeCount : defaultTreeCount(playable.length),
		playable.length
	);
	const firstSeed = getRandomElement(playable);
	const seeds = farthestPointSeeds(grid, treeCount, firstSeed);

	/**
	 * State of one tile after a hypothetical move adds addedMask to one of
	 * its pipes (or to a newborn pipe when pipeIndex is negative)
	 * @param {Number} cell
	 * @param {Number} pipeIndex
	 * @param {Number} addedMask
	 * @returns {{full: boolean, deadend: boolean}}
	 */
	const tileAfter = (cell, pipeIndex, addedMask) =>
		tileStateAfter(tiles[cell], grid.polygonAt(cell).fullyConnected, pipeIndex, addedMask);

	/**
	 * Buckets the tip's candidate moves by tier. A pipeIndex of -1 means
	 * the tip is a tree seed: the move births the seed pipe itself.
	 * @param {Number} cell
	 * @param {Number} pipeIndex
	 * @returns {{direction: Number, neighbour: Number, kind: 'link'|'extend'|'share'|'seed'}[][]}
	 */
	const candidateBuckets = (cell, pipeIndex) => {
		/** @type {{direction: Number, neighbour: Number, kind: 'link'|'extend'|'share'|'seed'}[][]} */
		const buckets = Array.from({ length: TIER.CLEAN_FULL + 1 }, () => []);
		if (pipeIndex < 0 && tiles[cell].length > 0) {
			// a seed whose cell an earlier opening occupied never grows:
			// its tree is dropped (rare, farthest-point seeds spread out)
			return buckets;
		}
		const polygon = grid.polygonAt(cell);
		const pipe = pipeIndex >= 0 ? tiles[cell][pipeIndex] : 0;
		const nogo = obviousTiles.get(cell);
		// one roll per pick: with probability sharingAmount the share tier
		// joins this pick's candidates at all
		const shareConsidered = Math.random() < knobs.sharingAmount;
		const tipRoot =
			pipeIndex >= 0 && shareConsidered ? uf.find(grid.pipeNodeId(cell, pipeIndex)) : -1;
		for (let direction of polygon.directions) {
			if (directionState(grid, tiles, cell, direction) !== CLAIM_STATE.FREE) {
				continue;
			}
			const { neighbour, empty } = grid.findNeighbour(cell, direction);
			if (
				empty ||
				directionState(grid, tiles, neighbour, /** @type {Number} */ (opposite.get(direction))) !==
					CLAIM_STATE.FREE
			) {
				continue;
			}
			/** @type {'link'|'extend'|'share'|'seed'} */
			let kind;
			if (tiles[neighbour].length > 0) {
				if (pipeIndex < 0 || !shareConsidered) {
					// a link would merge trees mid-growth and seeds never
					// share in - the tip must extend elsewhere or die
					continue;
				}
				// sharing is foreign territory only: no pipe of the target
				// tile may belong to the tip's own tree
				if (
					tiles[neighbour].some(
						(_, otherPipeIndex) => uf.find(grid.pipeNodeId(neighbour, otherPipeIndex)) === tipRoot
					)
				) {
					continue;
				}
				kind = MOVE_KIND.SHARE;
			} else {
				kind = pipeIndex >= 0 ? MOVE_KIND.EXTEND : MOVE_KIND.SEED;
			}
			const backDirection = /** @type {Number} */ (opposite.get(direction));
			// hard ban: never create a fully connected tile holding a
			// deadend - including the newborn pipe, which does not exist
			// yet at check time (tileAfter adds its end)
			const sourceAfter = tileAfter(cell, pipeIndex, direction);
			const targetAfter = tileAfter(neighbour, -1, backDirection);
			if ((sourceAfter.full && sourceAfter.deadend) || (targetAfter.full && targetAfter.deadend)) {
				continue;
			}
			// hard ban: a share move completing a single-pipe source union is
			// refused on every grid kind - the fully connected single pipe is
			// the rotation-invariant freebie, and sharing gains no coverage
			// anyway. Multi-pipe source completions (crossings) stay demoted
			if (kind === MOVE_KIND.SHARE && sourceAfter.full && tiles[cell].length === 1) {
				continue;
			}
			const demotions = {
				straight:
					polygon.pipeShapes.get(pipe | direction)?.isStraight &&
					Math.random() < knobs.avoidStraights,
				obvious:
					nogo !== undefined && Math.random() < knobs.avoidObvious && nogo.has(pipe | direction),
				cleanFull:
					demoteFullUnion &&
					((sourceAfter.full && !sourceAfter.deadend) || (targetAfter.full && !targetAfter.deadend))
			};
			buckets[moveTier(kind, demotions)].push({ direction, neighbour, kind });
		}
		return buckets;
	};

	/**
	 * Applies one atomic edge move: births the newborn pipe(s) together
	 * with their first locked edge and unions the connected pipes in the
	 * union-find. Claim states follow from the pipe bits (see
	 * directionState), so nothing is synced by hand - the FREE checks at
	 * the top are a tripwire: candidateBuckets only offers FREE
	 * directions, so a non-FREE state here means a bug trying to
	 * double-claim a direction.
	 * @param {Tree} tree
	 * @param {Number} cell
	 * @param {Number} pipeIndex - the tip's pipe, -1 for a seed birth
	 * @param {{direction: Number, neighbour: Number, kind: 'link'|'extend'|'share'|'seed'}} move
	 */
	const applyMove = (tree, cell, pipeIndex, move) => {
		const backDirection = /** @type {Number} */ (opposite.get(move.direction));
		if (directionState(grid, tiles, cell, move.direction) !== CLAIM_STATE.FREE) {
			throw new Error(`applyMove: ${move.direction} of cell ${cell} is not free`);
		}
		if (directionState(grid, tiles, move.neighbour, backDirection) !== CLAIM_STATE.FREE) {
			throw new Error(`applyMove: ${backDirection} of cell ${move.neighbour} is not free`);
		}
		let fromPipeIndex = pipeIndex;
		if (pipeIndex < 0) {
			tiles[cell].push(move.direction);
			fromPipeIndex = tiles[cell].length - 1;
			const sourceNode = grid.pipeNodeId(cell, fromPipeIndex);
			uf.add(sourceNode);
			tree.frontier.push(sourceNode);
		} else {
			tiles[cell][pipeIndex] |= move.direction;
		}
		tiles[move.neighbour].push(backDirection);
		const neighbourNode = grid.pipeNodeId(move.neighbour, tiles[move.neighbour].length - 1);
		uf.add(neighbourNode);
		tree.frontier.push(neighbourNode);
		if (!uf.union(grid.pipeNodeId(cell, fromPipeIndex), neighbourNode)) {
			throw new Error('Pregeneration: an extend, share or seed move closed a cycle');
		}
		events.push({
			type: 'move',
			kind: move.kind,
			fromCell: cell,
			fromPipeIndex,
			direction: move.direction,
			neighbour: move.neighbour,
			neighbourPipeIndex: tiles[move.neighbour].length - 1
		});
	};

	// opening round: every tree births its seed pipe with one locked edge
	// into a fresh neighbour cell, in shuffled order for the animation.
	// A seed that cannot open (its cell taken by an earlier opening, walled
	// in, every move banned) never gets a tree - no later phase has an
	// empty tree to wonder about
	/** @type {Number[]} */
	const seedOrder = shuffleInPlace([...seeds]);
	/** @type {Tree[]} */
	const trees = [];
	for (let t = 0; t < seeds.length; t++) {
		const buckets = candidateBuckets(seedOrder[t], -1);
		const best = buckets.find((bucket) => bucket.length > 0);
		if (best === undefined) {
			continue;
		}
		const tree = { frontier: [], avoiding: [], lastResort: [] };
		trees.push(tree);
		applyMove(tree, seedOrder[t], -1, getRandomElement(best));
	}

	/**
	 * Picks the acting pool: classic's [visited, avoiding, lastResort]
	 * priority as a global phase gate across trees. No tree drains its
	 * parked tips while any tree still has an active one - a degenerate
	 * plus anywhere on the board is equally bad, so it waits until it is
	 * everyone's last resort. Within the phase the pick stays two-level:
	 * a uniform tree among the phase's trees, then the branching blend
	 * inside that tree's pool.
	 * @returns {{tree: Tree, tips: Number[], parked: boolean} | null}
	 */
	const pickActor = () => {
		for (const [pool, parked] of /** @type {[keyof Tree, boolean][]} */ ([
			['frontier', false],
			['avoiding', true],
			['lastResort', true]
		])) {
			const actors = trees.filter((tree) => tree[pool].length > 0);
			if (actors.length > 0) {
				const tree = getRandomElement(actors);
				return { tree, tips: tree[pool], parked };
			}
		}
		return null;
	};

	// growth: tips stay candidates until they have no legal moves at all,
	// they are never popped after a single use. A tip whose best bucket is
	// the obvious or clean-full tier parks instead of moving; a tip picked
	// from a parked pool fires its best re-derived move whatever its tier
	// (fresh dice) - exactly classic draining avoiding/lastResortCells
	// only after visited empties, and unconditional fire is what rules out
	// an endless demotion re-roll at avoidObvious = 1
	for (;;) {
		const actor = pickActor();
		if (actor === null) {
			break;
		}
		const { tree, tips, parked } = actor;
		const tipIndex =
			Math.random() < knobs.branchingAmount
				? Math.floor(Math.random() * tips.length)
				: tips.length - 1;
		const tip = tips[tipIndex];
		const [cell, pipeIndex] = grid.cellIndexPipeIndexOf(tip);
		const buckets = candidateBuckets(cell, pipeIndex);
		const bestTier = buckets.findIndex((bucket) => bucket.length > 0);
		if (bestTier === -1) {
			// no legal move at all - the tip dies, whatever pool it is in
			tips.splice(tipIndex, 1);
			continue;
		}
		if (!parked && bestTier >= TIER.OBVIOUS) {
			// park the tip: classic moves the cell from visited into
			// avoiding (obvious demotion) or lastResortCells (clean-full
			// demotion) instead of taking the move
			tips.splice(tipIndex, 1);
			(bestTier === TIER.CLEAN_FULL ? tree.lastResort : tree.avoiding).push(tip);
			continue;
		}
		applyMove(tree, cell, pipeIndex, getRandomElement(buckets[bestTier]));
	}

	const uncovered = playable.filter((index) => tiles[index].length === 0);
	if (uncovered.length > 0) {
		// diagnose the stall: an uncovered cell with no non-empty
		// neighbours can never be covered (no treeCount fixes it), any
		// other uncovered cell means more regions than trees
		const isolated = uncovered.find((index) =>
			grid
				.polygonAt(index)
				.directions.every((direction) => grid.findNeighbour(index, direction).empty)
		);
		if (isolated !== undefined) {
			throw new IsolatedCellError(
				`Pregeneration: cell ${isolated} has no non-empty neighbours - no treeCount can cover it`
			);
		}
		throw new Error(
			`Pregeneration: growth stalled with ${uncovered.length} uncovered cells ` +
				'(the board has more separated regions than trees - raise treeCount)'
		);
	}
	return tiles;
}

/**
 * Rebuilds a union-find over pipe nodes from the board's locked edges.
 * The board is the ground truth of pipe connectivity, so a rebuilt
 * union-find always equals the incremental one - and after a fusion
 * (which removes a pipe and shifts pipe indices) rebuilding is the only
 * correct way forward, since pre-fusion node ids no longer line up with
 * the tiles.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @returns {UnionFind}
 */
function unionFindFromBoard(grid, tiles) {
	const uf = new UnionFind();
	for (let cell = 0; cell < grid.total; cell++) {
		for (let pipeIndex = 0; pipeIndex < tiles[cell].length; pipeIndex++) {
			uf.add(grid.pipeNodeId(cell, pipeIndex));
		}
	}
	for (let cell = 0; cell < grid.total; cell++) {
		const polygon = grid.polygonAt(cell);
		for (let pipeIndex = 0; pipeIndex < tiles[cell].length; pipeIndex++) {
			for (const direction of polygon.directions) {
				if ((tiles[cell][pipeIndex] & direction) === 0) {
					continue;
				}
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				if (empty) {
					continue;
				}
				const back = /** @type {Number} */ (grid.OPPOSITE.get(direction));
				const other = tiles[neighbour].findIndex((pipe) => (pipe & back) > 0);
				// every locked end has exactly one match across the edge, so
				// other >= 0 holds; the second visit of an edge unions nothing
				if (other >= 0) {
					uf.union(grid.pipeNodeId(cell, pipeIndex), grid.pipeNodeId(neighbour, other));
				}
			}
		}
	}
	return uf;
}

/**
 * One fusion candidate of the merge phase: two pipes of one tile in two
 * different components - the payload of the ForestFuse event applying it
 * produces.
 * @typedef {{cell: Number, firstPipeIndex: Number, secondPipeIndex: Number}} FuseCandidate
 */

/**
 * One candidate link of the merge phase: a pair of existing pipes across
 * a free-free edge of two different components. A link into a shared
 * tile can pick any resident - directions are a per-tile resource - and
 * the pick is uniform among the edge's valid pairs.
 * @typedef {{cell: Number, pipeIndex: Number, direction: Number, neighbour: Number,
 * neighbourPipeIndex: Number, completing: boolean}} LinkCandidate
 */

/**
 * The merge phase, see docs/multipipes-generator-forest.md. After growth
 * ends the forest holds one component per tree; this phase links and
 * fuses them into a single spanning tree over all pipe nodes:
 *
 * 1. plain links - cross-component pipe pairs across free-free edges
 *    that complete no tile's pipe union, shuffled, applied until one
 *    component remains;
 * 2. union-completing links - same, but the link would finish a tile's
 *    union (the clean-full last resort, mirroring the growth tiers);
 * 3. fusions - two pipes of one shared tile in different components
 *    combined into one pipe, no free direction needed.
 *
 * Hard-banned links (a fully connected union containing a deadend) are
 * never candidates, in any tier. If components remain and no candidate
 * exists at all, the board is unmergeable (in practice only a
 * wall-sealed seam) and UnmergeableBoardError is thrown; the tiles keep
 * whatever partial merges already fired - always a valid forest, never
 * a malformed board - and the caller retries with a fresh growth pass.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles - mutated in place
 * @param {ForestEvent[]} [events] - collects this merge's events after
 * any growth events already there
 * @returns {Number[][]} tiles, mutated
 */
export function mergeForest(grid, tiles, events = []) {
	/** @type {UnionFind} */
	let uf = unionFindFromBoard(grid, tiles);
	const opposite = grid.OPPOSITE;
	/** @param {Number} cell */
	const fullyConnected = (cell) => grid.polygonAt(cell).fullyConnected;

	/**
	 * A link's hard-ban state: whether either touched tile would be a
	 * fully connected union containing a deadend after it
	 * @param {LinkCandidate} candidate
	 */
	const bannedLink = (candidate) => {
		const back = /** @type {Number} */ (opposite.get(candidate.direction));
		const source = tileStateAfter(
			tiles[candidate.cell],
			fullyConnected(candidate.cell),
			candidate.pipeIndex,
			candidate.direction
		);
		const target = tileStateAfter(
			tiles[candidate.neighbour],
			fullyConnected(candidate.neighbour),
			candidate.neighbourPipeIndex,
			back
		);
		return (source.full && source.deadend) || (target.full && target.deadend);
	};

	/**
	 * Collects the current link candidates bucketed into the plain tier
	 * and the union-completing tier
	 * @returns {{plain: LinkCandidate[], completing: LinkCandidate[]}}
	 */
	const collectLinks = () => {
		/** @type {LinkCandidate[]} */
		const plain = [];
		/** @type {LinkCandidate[]} */
		const completing = [];
		for (let cell = 0; cell < grid.total; cell++) {
			for (const direction of grid.polygonAt(cell).directions) {
				const back = /** @type {Number} */ (opposite.get(direction));
				// every other direction is the same edge seen from the
				// neighbour's side - keep each edge once
				if (direction >= back) {
					continue;
				}
				if (directionState(grid, tiles, cell, direction) !== CLAIM_STATE.FREE) {
					continue;
				}
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				if (empty || directionState(grid, tiles, neighbour, back) !== CLAIM_STATE.FREE) {
					continue;
				}
				for (let pipeIndex = 0; pipeIndex < tiles[cell].length; pipeIndex++) {
					const sourceRoot = uf.find(grid.pipeNodeId(cell, pipeIndex));
					for (let otherIndex = 0; otherIndex < tiles[neighbour].length; otherIndex++) {
						if (uf.find(grid.pipeNodeId(neighbour, otherIndex)) === sourceRoot) {
							continue;
						}
						const source = tileStateAfter(tiles[cell], fullyConnected(cell), pipeIndex, direction);
						const target = tileStateAfter(
							tiles[neighbour],
							fullyConnected(neighbour),
							otherIndex,
							back
						);
						// hard ban: never a candidate, in any tier
						if ((source.full && source.deadend) || (target.full && target.deadend)) {
							continue;
						}
						const candidate = {
							cell,
							pipeIndex,
							direction,
							neighbour,
							neighbourPipeIndex: otherIndex,
							completing: source.full || target.full
						};
						(candidate.completing ? completing : plain).push(candidate);
					}
				}
			}
		}
		return { plain, completing };
	};

	/**
	 * Re-derives a candidate's validity at apply time: earlier links of
	 * the same sweep may have consumed its directions, merged its
	 * components or shifted its ban state
	 * @param {LinkCandidate} candidate
	 */
	const linkStillValid = (candidate) => {
		const back = /** @type {Number} */ (opposite.get(candidate.direction));
		return (
			directionState(grid, tiles, candidate.cell, candidate.direction) === CLAIM_STATE.FREE &&
			directionState(grid, tiles, candidate.neighbour, back) === CLAIM_STATE.FREE &&
			uf.find(grid.pipeNodeId(candidate.cell, candidate.pipeIndex)) !==
				uf.find(grid.pipeNodeId(candidate.neighbour, candidate.neighbourPipeIndex)) &&
			!bannedLink(candidate)
		);
	};

	/**
	 * Applies one link: both pipe ends come into existence at the same
	 * instant, the components merge, one link event joins the stream
	 * @param {LinkCandidate} candidate
	 */
	const applyLink = (candidate) => {
		const back = /** @type {Number} */ (opposite.get(candidate.direction));
		tiles[candidate.cell][candidate.pipeIndex] |= candidate.direction;
		tiles[candidate.neighbour][candidate.neighbourPipeIndex] |= back;
		if (
			!uf.union(
				grid.pipeNodeId(candidate.cell, candidate.pipeIndex),
				grid.pipeNodeId(candidate.neighbour, candidate.neighbourPipeIndex)
			)
		) {
			throw new Error('Merge: a link closed a cycle');
		}
		events.push({
			type: 'move',
			kind: MOVE_KIND.LINK,
			fromCell: candidate.cell,
			fromPipeIndex: candidate.pipeIndex,
			direction: candidate.direction,
			neighbour: candidate.neighbour,
			neighbourPipeIndex: candidate.neighbourPipeIndex
		});
	};

	/**
	 * Collects the current fusion candidates: any two pipes of one tile in
	 * two different components. No free direction is needed - the two
	 * pipes simply become one (the bitwise or), which is why fusion can
	 * merge what no link can reach. Fusion never creates a banned shape
	 * (the tile's union is unchanged and the fused pipe has at least two
	 * ends, so deadends only disappear), but the cheap check stays as
	 * defense.
	 * @returns {FuseCandidate[]}
	 */
	const collectFusions = () => {
		/** @type {FuseCandidate[]} */
		const fusions = [];
		for (let cell = 0; cell < grid.total; cell++) {
			const pipes = tiles[cell];
			if (pipes.length < 2) {
				continue;
			}
			for (let first = 0; first < pipes.length; first++) {
				for (let second = first + 1; second < pipes.length; second++) {
					if (uf.find(grid.pipeNodeId(cell, first)) === uf.find(grid.pipeNodeId(cell, second))) {
						continue;
					}
					const fused = [...pipes];
					fused[first] |= fused[second];
					fused.splice(second, 1);
					const after = tileStateAfter(fused, fullyConnected(cell), fused.length, 0);
					if (after.full && after.deadend) {
						continue;
					}
					fusions.push({ cell, firstPipeIndex: first, secondPipeIndex: second });
				}
			}
		}
		return fusions;
	};

	/**
	 * Applies one fusion: the two pipes become one, the surviving pipe
	 * keeps firstPipeIndex, the other disappears and everything above it
	 * shifts down. The splice invalidates pipe node ids from this tile
	 * on, so the union-find is rebuilt from the board - the ground truth
	 * of pipe connectivity. The board mutation itself goes through the
	 * shared applyForestEvent, so the engine and every replay agree.
	 * @param {FuseCandidate} fusion
	 */
	const applyFusion = (fusion) => {
		const event = /** @type {ForestFuse} */ ({ type: 'fuse', ...fusion });
		applyForestEvent(grid, tiles, event);
		uf = unionFindFromBoard(grid, tiles);
		events.push(event);
	};

	while (uf.count > 1) {
		const { plain, completing } = collectLinks();
		const tier = plain.length > 0 ? plain : completing;
		if (tier.length > 0) {
			shuffleInPlace(tier);
			for (const candidate of tier) {
				if (uf.count === 1) {
					break;
				}
				if (linkStillValid(candidate)) {
					applyLink(candidate);
				}
			}
			continue;
		}
		const fusions = collectFusions();
		if (fusions.length === 0) {
			throw new UnmergeableBoardError(
				`Pregeneration: cannot merge the board - ${uf.count} components remain ` +
					'with no link or fusion candidate (a sealed seam)'
			);
		}
		// one fusion per round: a splice shifts pipe indices of its tile,
		// so the other collected candidates' indices would go stale. The
		// next round recollects against the rebased board
		applyFusion(fusions[Math.floor(Math.random() * fusions.length)]);
	}
	return tiles;
}

/**
 * Grows treeCount independent trees from spatially balanced seeds until
 * none of them can move anymore, using atomic edge moves only, then
 * merges the forest into a single spanning tree over all pipe nodes:
 * when a tip reaches a cell held by another tree it may birth a new pipe
 * there instead of connecting to the foreign pipe - a sharing event,
 * gated per pick by the sharing knob - so trees braid through each
 * other's territory while every tile's pipes stay mutually unconnected
 * until the merge phase links and fuses the trees into one. Only the
 * successful attempt's events reach onMove, so a replay of the stream
 * mirrors the returned tiles exactly.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {ForestKnobs} [knobs]
 * @param {(event: ForestEvent) => void} [onEvent] - receives growth and merge events
 * @returns {Number[][]} - unrandomized multipipes tiles
 */
export function pregenerateForest(grid, knobs = {}, onEvent = undefined) {
	/** @param {Number|undefined} value */
	const clamp = (value) => Math.min(1, Math.max(0, value || 0));
	/** @type {Required<ForestKnobs>} */
	const full = {
		sharingAmount: clamp(knobs.sharingAmount),
		branchingAmount: clamp(knobs.branchingAmount === undefined ? 0.5 : knobs.branchingAmount),
		avoidObvious: clamp(knobs.avoidObvious),
		avoidStraights: clamp(knobs.avoidStraights),
		treeCount: knobs.treeCount && knobs.treeCount > 0 ? Math.round(knobs.treeCount) : 0
	};
	/** @type {ForestEvent[]} */
	const events = [];
	for (let attempt = 0; ; attempt++) {
		events.length = 0;
		try {
			const tiles = growAttempt(grid, full, events);
			mergeForest(grid, tiles, events);
			for (let event of events) {
				onEvent?.(event);
			}
			return tiles;
		} catch (error) {
			// a board defect no roll of the dice can fix: fail now, the
			// message already names the cell
			if (error instanceof IsolatedCellError || attempt >= MAX_ATTEMPTS) {
				throw error;
			}
		}
	}
}
