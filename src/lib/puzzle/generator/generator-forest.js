import { computeCellObviousTiles } from './generator.js';
import { Solver } from '#lib/puzzle/solver/solver.js';
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
 * Sharing has no tier of its own: the sharing knob gates whether share
 * candidates are considered at all, and considered shares rank with moves
 * into fresh cells, so trees braid during growth instead of as an
 * afterthought once boxed.
 */
export const TIER = Object.freeze({
	NORMAL: 0,
	STRAIGHT: 1,
	OBVIOUS: 2,
	CLEAN_FULL: 3
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
 * Tier of a candidate move: demotion flags raise it, the worst wins. Every
 * move kind starts normal - preference between kinds is not a tier matter.
 * @param {{straight?: boolean, obvious?: boolean, cleanFull?: boolean}} [demotions]
 * @returns {Number} one of TIER values
 */
export function moveTier(demotions = {}) {
	/** @type {Number} */
	let tier = TIER.NORMAL;
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
 * BFS hop-distance relaxation from the queued cells over playable
 * cells, kept as the minimum over all sources processed so far;
 * unreachable cells stay at Infinity (they belong to other regions
 * behind walls). The queue is consumed and extended in place: a caller
 * may seed it with any cells whose distances are already set.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[]} queue - cells to relax from, grown during the run
 * @param {Number[]} distances - result buffer, -1 marks empty cells
 */
function relaxDistances(grid, queue, distances) {
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
 * Farthest-point sampling over the playable cells of the grid, measured
 * by BFS hop distance from the sources: every next pick is the playable
 * cell with the greatest distance to everything chosen so far (sources
 * included), which keeps the picks spatially balanced. Unreachable
 * cells (other regions) win the next pick, so every region gets seeded
 * as long as the count allows. Picks never repeat a source or each
 * other: any not-yet-chosen playable cell sits at distance >= 1 while
 * the sources rest at 0.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number} count - wanted pick count
 * @param {Number[]} sources - cells at distance 0, never picked
 * @returns {Number[]} picked cells, at most count
 */
function farthestPointPicks(grid, count, sources) {
	/** @type {Number[]} */
	const picks = [];
	const distances = Array.from({ length: grid.total }, (_, index) =>
		grid.emptyCells.has(index) ? -1 : Infinity
	);
	/** @type {Number[]} */
	const queue = [];
	for (const cell of sources) {
		distances[cell] = 0;
		queue.push(cell);
	}
	relaxDistances(grid, queue, distances);
	while (picks.length < count) {
		let farthest = -1;
		let farthestDistance = -Infinity;
		for (let index = 0; index < grid.total; index++) {
			if (distances[index] > farthestDistance) {
				farthest = index;
				farthestDistance = distances[index];
			}
		}
		if (farthest < 0 || distances[farthest] <= 0) {
			// nothing pickable remains - every playable cell is chosen
			break;
		}
		picks.push(farthest);
		distances[farthest] = 0;
		relaxDistances(grid, [farthest], distances);
	}
	return picks;
}

/**
 * Farthest-point sampling of seed cells over the playable cells of the
 * grid, which keeps the K trees spatially balanced: the first seed is
 * given, every next one is the playable cell with the greatest BFS hop
 * distance to the seeds chosen so far. Unreachable cells (other
 * regions) win the next pick, so every region gets seeded as long as
 * the count allows.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number} count - wanted seed count, capped at playable cells
 * @param {Number} firstSeed - playable cell to start from
 * @returns {Number[]} chosen seed cells, firstSeed included
 */
export function farthestPointSeeds(grid, count, firstSeed) {
	if (grid.emptyCells.has(firstSeed)) {
		throw new Error(`farthestPointSeeds: first seed ${firstSeed} is an empty cell`);
	}
	return [firstSeed, ...farthestPointPicks(grid, count - 1, [firstSeed])];
}

/**
 * Multitiles for reuse, see planReusedComponents: a keepable cell holds
 * its pipes in solved orientation, a cell that should be regenerated
 * holds null
 * @typedef {(Number[]|null)[]} StartTiles
 */

/**
 * Prepares a solved board for reuse: tiles whose marked rotation is a
 * solver sentinel (ambiguous or unresolved) become null, the others get
 * their pipes rotated to the solver's frame - all pipes of a tile
 * together, the rotation the solver certified
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles - solved multipipes tiles in any frame
 * @param {Number[]} marked - rotation per tile, possibly with sentinel values
 * @returns {StartTiles}
 */
export function buildStartTiles(grid, tiles, marked) {
	return tiles.map((pipes, index) => {
		const rotation = marked[index];
		if (pipes.length === 0 || typeof rotation !== 'number' || rotation < 0) {
			return null;
		}
		const polygon = grid.polygonAt(index);
		return pipes.map((pipe) => polygon.rotate(pipe, rotation));
	});
}

/**
 * Reuse material of one kept component: cell index => the pipes it
 * contributes, ends already stripped to the component's interior (a
 * cell can host pipes of several components, so several entries can
 * share a cell)
 * @typedef {Map<Number, Number[]>} ReusedComponent
 */

/**
 * The reuse plan computed from start tiles, see planReusedComponents
 * @typedef {object} ReusePlan
 * @property {ReusedComponent[]} components - kept components, largest first
 * @property {Number} keptCount - cells hosting at least one kept pipe
 */

/**
 * Computes what survives of the previous iteration's board: connected
 * components of determined tiles, linked by mutual pipe edges in their
 * solved orientation. The largest component is always kept, smaller
 * ones only when they span at least reuseMinCount cells. Every kept
 * pipe is stripped of the ends pointing outside its own component - a
 * pipe left with no ends disappears, a cell left with no pipes is not
 * reused. Rotation-invariant tiles (fully connected single pipes) need
 * no special handling: they carry no orientation information, but
 * keeping them is harmless [skipped per ticket 05, agreed with the
 * user].
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {StartTiles} startTiles
 * @param {Number} [reuseMinCount=3] - minimum cell count for the
 * smaller components
 * @returns {ReusePlan}
 */
export function planReusedComponents(grid, startTiles, reuseMinCount = 3) {
	const total = grid.total;
	const opposite = grid.OPPOSITE;

	/**
	 * Pipe node id (in start-tile indexing) answering backDirection at
	 * cell, or -1 when the cell is erased or no pipe answers
	 * @param {Number} cell
	 * @param {Number} backDirection
	 * @returns {Number}
	 */
	const matchingNode = (cell, backDirection) => {
		const pipes = startTiles[cell];
		if (!pipes) {
			return -1;
		}
		for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
			if ((pipes[pipeIndex] & backDirection) > 0) {
				return grid.pipeNodeId(cell, pipeIndex);
			}
		}
		return -1;
	};

	/**
	 * One component mid-collection: the flood fill's node set plus the
	 * pipe indices each visited cell contributed
	 * @typedef {{nodes: Set<Number>, cells: Map<Number, Number[]>}} RawComponent
	 */
	/** @type {RawComponent[]} */
	const components = [];
	/** @type {Set<Number>} pipe node ids already assigned to a component */
	const seen = new Set();
	for (let cell = 0; cell < total; cell++) {
		const pipes = startTiles[cell];
		if (!pipes || pipes.length === 0 || grid.emptyCells.has(cell)) {
			continue;
		}
		for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
			const start = grid.pipeNodeId(cell, pipeIndex);
			if (seen.has(start)) {
				continue;
			}
			/** @type {RawComponent} */
			const component = { nodes: new Set(), cells: new Map() };
			/** @type {Number[]} */
			const queue = [start];
			seen.add(start);
			while (queue.length > 0) {
				const node = /** @type {Number} */ (queue.pop());
				component.nodes.add(node);
				const [nodeCell, nodePipe] = grid.cellIndexPipeIndexOf(node);
				const members = component.cells.get(nodeCell);
				if (members) {
					members.push(nodePipe);
				} else {
					component.cells.set(nodeCell, [nodePipe]);
				}
				// follow the pipe's locked ends to the pipes they mutual-
				// match: pipes of one cell never connect, but one cell
				// can host pipes of several components and one component
				// can revisit a cell with several pipes (through-paths)
				const mask = /** @type {Number[]} */ (startTiles[nodeCell])[nodePipe];
				for (const direction of grid.polygonAt(nodeCell).directions) {
					if ((mask & direction) === 0) {
						continue;
					}
					const { neighbour, empty } = grid.findNeighbour(nodeCell, direction);
					if (empty) {
						continue;
					}
					const next = matchingNode(neighbour, /** @type {Number} */ (opposite.get(direction)));
					if (next < 0 || seen.has(next)) {
						continue;
					}
					seen.add(next);
					queue.push(next);
				}
			}
			components.push(component);
		}
	}
	// the largest component is keepable whatever its size, smaller ones
	// need the minimum cell count; sorted descending, the first
	// undersized component ends the run
	components.sort((a, b) => -(a.cells.size - b.cells.size));

	/** @type {ReusedComponent[]} */
	const kept = [];
	/** @type {Set<Number>} */
	const keptCells = new Set();
	for (let index = 0; index < components.length; index++) {
		const component = components[index];
		// sizes are measured before stripping, in keep-then-strip order;
		// stripping can only empty singleton components, never shrink a
		// multi-node one (its defining edges are mutual and stay)
		if (index > 0 && component.cells.size < reuseMinCount) {
			break;
		}
		/** @type {ReusedComponent} */
		const stripped = new Map();
		for (const [cell, pipeIndices] of component.cells) {
			const pipes = /** @type {Number[]} */ (startTiles[cell]);
			/** @type {Number[]} */
			const masks = [];
			for (const pipeIndex of pipeIndices) {
				let mask = pipes[pipeIndex];
				for (const direction of grid.polygonAt(cell).directions) {
					if ((mask & direction) === 0) {
						continue;
					}
					const { neighbour, empty } = grid.findNeighbour(cell, direction);
					const match = empty
						? -1
						: matchingNode(neighbour, /** @type {Number} */ (opposite.get(direction)));
					// keep an end only when its mutual match stays inside
					// this component - stripping never disconnects a
					// component (its defining edges are mutual), so only
					// pipes with no interior edges at all can vanish
					if (match < 0 || !component.nodes.has(match)) {
						mask ^= direction;
					}
				}
				if (mask > 0) {
					masks.push(mask);
				}
			}
			if (masks.length > 0) {
				stripped.set(cell, masks);
				keptCells.add(cell);
			}
		}
		if (stripped.size > 0) {
			kept.push(stripped);
		}
	}
	return { components: kept, keptCount: keptCells.size };
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

/**
 * A reuse event of regrowth: one kept component's cells arriving with
 * their pipes, ends already stripped to the component's interior (see
 * planReusedComponents). The component lands as one pre-unioned tree:
 * every kept end mutual-matches inside it and no foreign component is
 * joined, so a replay can lock it in as a unit. Reuse events open the
 * event stream whenever pregenerateForest regrows from start tiles.
 * @typedef {{type: 'reuse', cells: {cell: Number, pipes: Number[]}[]}} ForestReuse
 */

/** @typedef {ForestMove | ForestFuse | ForestReuse} ForestEvent */

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
	if (event.type === 'reuse') {
		for (const entry of event.cells) {
			board[entry.cell].push(...entry.pipes);
		}
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
 * @property {Number} [sharingAmount=0.35] - probability that a pick considers
 * share candidates at all: entering an occupied foreign cell (no pipe of the
 * tip's tree there) by birthing a new pipe in it, values in range [0,1].
 * Considered shares rank with moves into fresh cells, so trees braid during
 * growth. Zero hard-guarantees boards where every tile holds exactly one
 * pipe [default 0.35 agreed 2026-11-01, ticket 04: the linear part of the
 * knob's response curve, calibrated visually across grid kinds].
 * @property {Number} [branchingAmount=0.5] - frontier selection only: 0 picks
 * the most recent growth point (winding), 1 a uniform random one (bushy)
 * @property {Number} [avoidObvious=0] - demotes moves that would make a tile
 * instantly solvable from walls, values in range [0,1]
 * @property {Number} [avoidStraights=0] - demotes moves that make a straight
 * pipe, values in range [0,1]
 * @property {Number} [treeCount=0] - number of trees to grow from seeds;
 * 0 means the default max(3, floor(playable cells / 20)), see
 * defaultTreeCount. During regrowth K caps fresh seeds only - more than
 * K qualifying reuse components all load
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
 * Default number of trees: constant tree size - about twenty playable
 * cells per tree, with a floor of three trees so sharing has foreign
 * territory to braid into even on small boards. Linear scaling keeps the
 * sharing knob's meaning size-invariant: seam length per cell goes as
 * sqrt(K/N), which stays constant when K grows with N [agreed 2026-11-01,
 * ticket 04 - the earlier 1 + round(sqrt(N)) starting point made bigger
 * boards mildly calmer at the same sharing setting]
 * @param {Number} playableCount
 * @returns {Number}
 */
export function defaultTreeCount(playableCount) {
	return Math.max(3, Math.floor(playableCount / 20));
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
 * One growth attempt, see pregenerateForest. Fresh boards grow treeCount
 * independent trees from farthest-point seeds; boards with startTiles
 * first load their kept reuse components as trees - pipes pre-unioned
 * over their intra-component edges, every pipe a frontier tip - and
 * fresh seeds top the count up to treeCount, chosen by farthest-point
 * sampling over the erased region around the reused cells (K caps fresh
 * seeds, not reuse: more than K qualifying components all load). A tip
 * reaching a cell held by another tree may birth a new pipe there (a
 * sharing event) per the sharing knob, so trees braid through each
 * other's territory - reused tiles included - without their pipes ever
 * connecting. A tip whose best move sits in the obvious or clean-full
 * tier is not acted on - it parks in classic's avoiding/lastResort
 * lists, and parked moves fire only when no active tip anywhere can
 * move. Throws when cells remain uncovered (degenerate boards).
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Required<ForestKnobs>} knobs
 * @param {ForestEvent[]} events - collects this attempt's growth events
 * @param {StartTiles} [startTiles] - reused material, empty on fresh boards
 * @param {Number} [reuseMinCount] - minimum component size to reuse
 * @returns {Number[][]} - unrandomized multipipes tiles
 */
function growAttempt(grid, knobs, events, startTiles = [], reuseMinCount = 3) {
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

	/** @type {Tree[]} */
	const trees = [];
	/** @type {Number[]} cells holding reused pipes */
	const reusedCells = [];
	/** cells hosting at least one kept pipe - components can share a cell,
	 * so the set dedupes. The reuse set is fixed at load time: reused
	 * pipes never leave their cell, so it stays valid through growth */
	const reusedCellSet = new Set();

	// reused components load as some of the K trees: pipes land on the
	// board together with their locked edges, pre-unioned, and every
	// pipe joins its tree's frontier - reused trees grow like any tree,
	// their boundary pipes extending into the erased region around them
	if (startTiles.length === total) {
		const { components } = planReusedComponents(grid, startTiles, reuseMinCount);
		for (const component of components) {
			/** @type {Tree} */
			const tree = { frontier: [], avoiding: [], lastResort: [] };
			trees.push(tree);
			/** @type {{cell: Number, pipes: Number[]}[]} */
			const cells = [];
			/** @type {Number[]} placed pipe node ids of this component */
			const placed = [];
			for (const [cell, masks] of component) {
				/** @type {Number[]} */
				const pipes = [];
				for (const mask of masks) {
					tiles[cell].push(mask);
					const node = grid.pipeNodeId(cell, tiles[cell].length - 1);
					uf.add(node);
					tree.frontier.push(node);
					placed.push(node);
					pipes.push(mask);
				}
				reusedCells.push(cell);
				reusedCellSet.add(cell);
				cells.push({ cell, pipes });
			}
			events.push({ type: 'reuse', cells });
			// pre-union over the intra-component locked edges: every kept
			// end's match sits in this component (stripping), so each
			// edge unions exactly once and its second visit is the cycle
			// guard's no-op
			for (const node of placed) {
				const [cell, pipeIndex] = grid.cellIndexPipeIndexOf(node);
				for (const direction of grid.polygonAt(cell).directions) {
					if ((tiles[cell][pipeIndex] & direction) === 0) {
						continue;
					}
					const { neighbour, empty } = grid.findNeighbour(cell, direction);
					if (empty) {
						continue;
					}
					const back = /** @type {Number} */ (opposite.get(direction));
					const other = tiles[neighbour].findIndex((pipe) => (pipe & back) > 0);
					if (other >= 0) {
						uf.union(node, grid.pipeNodeId(neighbour, other));
					}
				}
			}
		}
	}

	const treeCount = knobs.treeCount > 0 ? knobs.treeCount : defaultTreeCount(playable.length);
	/** @type {Number[]} fresh seed cells for this attempt's new trees */
	let seeds;
	if (trees.length === 0) {
		// fresh board: the first seed is uniformly random, the rest join
		// by farthest point from it
		const firstSeed = getRandomElement(playable);
		seeds = farthestPointSeeds(grid, Math.min(treeCount, playable.length), firstSeed);
	} else {
		// regrow: fresh trees only top the count up to K, seeded by
		// farthest point over the erased region around the reused cells
		// (reused cells at distance 0) - K caps fresh seeds, not reuse.
		// The erased region also caps them at its own tree density: one
		// seed per ~20 erased cells (the fresh-board formula's ratio,
		// floored at one so any regrowable region can open). Without the
		// density cap, a late-loop region of a few dozen cells crams
		// K-minus-loaded trees into itself and the regrown patch grows at
		// several times the calibrated sharing level - the oversharing
		// ratchet of ticket 06's 30x30 measurements (13-17 seeds in a
		// 52-cell region with K = 45)
		const erased = playable.filter((index) => tiles[index].length === 0);
		const freshCount = Math.min(
			Math.max(0, treeCount - trees.length),
			Math.max(1, Math.floor(erased.length / 20)),
			erased.length
		);
		seeds = farthestPointPicks(grid, freshCount, reusedCells);
	}

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
		// one roll per pick: with probability sharingAmount share candidates
		// join this pick at all - and when they join they rank with moves
		// into fresh cells (see TIER)
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
			// a fully connected pipe - the acting pipe alone taking its
			// tile's every direction - is the rotation-invariant freebie
			const pipeFull = (pipe | direction) === polygon.fullyConnected;
			// hard ban: a share move completing the source tile's union is
			// refused on every grid kind, whatever completes - the fully
			// connected pipe or a multi-pipe union, deadend or clean.
			// Sharing gains no coverage, so neither the growth phase nor
			// the drain phase has a reason to mint fully connected tiles;
			// crossings form through the coverage-paying extend exemption
			// below instead
			if (kind === MOVE_KIND.SHARE && sourceAfter.full) {
				continue;
			}
			// regrow ban: no shares between two cells hosting reused
			// pipes. Both sides are certified territory - the share mutates
			// stable regions for zero coverage and nothing ever removes
			// it, so shared tiles ratchet up iteration over iteration
			// until component borders saturate (ticket 06's 30x30 data:
			// 5-26 both-reused shares per regrow, shared tiles climbing
			// 215 -> 270 at sharing 0.35). Foreign tips may still share
			// into reused tiles and reused tips still share into fresh
			// ones - reused trees grow like any tree otherwise
			if (kind === MOVE_KIND.SHARE && reusedCellSet.has(cell) && reusedCellSet.has(neighbour)) {
				continue;
			}
			// soft ban: an extend completing a clean fully connected union
			// demotes to the last-resort tier, except where the completed
			// shape is the payoff. Triangular grids allow a fully
			// connected pipe outright - a triangle's only branching
			// (demoteFullUnion, the classic caveat). And on square cells
			// a multi-pipe union - exactly the X / L+L crossing pair - is
			// completed by an extend into a fresh cell, so the move pays
			// for itself in coverage and ranks normal. Only the source
			// side can complete a clean union here: a fresh target holds
			// nothing but the newborn end, and every share completion at
			// the source is banned above. The last-resort tier therefore
			// exists for one purpose only: an extend that finishes the
			// source's union while covering its target cell
			const cleanFull =
				demoteFullUnion &&
				sourceAfter.full &&
				!sourceAfter.deadend &&
				!(polygon.numDirections === 4 && !pipeFull);
			const demotions = {
				straight:
					polygon.pipeShapes.get(pipe | direction)?.isStraight &&
					Math.random() < knobs.avoidStraights,
				obvious:
					nogo !== undefined && Math.random() < knobs.avoidObvious && nogo.has(pipe | direction),
				cleanFull
			};
			buckets[moveTier(demotions)].push({ direction, neighbour, kind });
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

	// opening round: every fresh tree births its seed pipe with one
	// locked edge into a fresh neighbour cell, in shuffled order for the
	// animation. A seed that cannot open (its cell taken by an earlier
	// opening, walled in, every move banned) never gets a tree - no
	// later phase has an empty tree to wonder about
	/** @type {Number[]} */
	const seedOrder = shuffleInPlace([...seeds]);
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
 * fuses them into a single spanning tree over all pipe nodes, in tiers:
 *
 * 1. plain links - cross-component pipe pairs across free-free edges
 *    that complete no tile's pipe union, shuffled, applied until one
 *    component remains;
 * 2. clean union-completing links - same, but the link would finish a
 *    tile's union (the clean-full last resort, mirroring the growth
 *    tiers);
 * 3. clean fusions - two pipes of one shared tile in different
 *    components combined into one pipe, no free direction needed;
 * 4. plus links - a link giving some pipe its tile's every direction,
 *    the rotation-invariant freebie (a plus), demoted below clean
 *    fusions so an available fusion merges components without minting
 *    one [agreed 2026-10-30];
 * 5. plus fusions - a fusion whose result is that fully connected
 *    single pipe, same demotion.
 *
 * On triangular grids the plus tiers do not exist: triangles need their
 * full connections too often, so completing links stay one tier there -
 * mirroring growth's demoteFullUnion caveat. Sweep candidates are
 * re-validated at apply time (directions, roots, hard ban, plus state):
 * two clean links collected in one sweep can stack onto the same pipe
 * and would mint a plus that no tier ever chose.
 *
 * Hard-banned links (a fully connected union containing a deadend) are
 * never candidates, in any tier. If components remain and no candidate
 * exists at all, the board is unmergeable (in practice only a
 * wall-sealed seam) and UnmergeableBoardError is thrown; the tiles keep
 * whatever partial merges already fired - always a valid forest, never
 * a malformed board - and the caller retries with a fresh growth pass.
 * Plus moves are demoted, never banned, for the same reason: a board
 * whose only merge mints a plus must still merge.
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
	// triangular-grid caveat mirroring growth's full-union demotion
	// (demoteFullUnion there): triangles need their full connections too
	// often, so plus demotions are skipped there - completing links stay
	// one tier on triangular grids
	const demotePlus = grid.KIND !== 'triangular';

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
	 * Whether a link would create a fully connected single pipe (a plus)
	 * on either side - the rotation-invariant freebie growth refuses to
	 * hand out for free. Such links are demoted to the merge's last
	 * resort, not banned: a board whose only merge makes a plus must
	 * still merge (retrying would just reshuffle the same geometry)
	 * @param {LinkCandidate} candidate
	 */
	const plusLink = (candidate) => {
		const back = /** @type {Number} */ (opposite.get(candidate.direction));
		return (
			(tiles[candidate.cell][candidate.pipeIndex] | candidate.direction) ===
				fullyConnected(candidate.cell) ||
			(tiles[candidate.neighbour][candidate.neighbourPipeIndex] | back) ===
				fullyConnected(candidate.neighbour)
		);
	};

	/**
	 * Collects the current link candidates bucketed into the plain tier,
	 * the clean union-completing tier and the plus tier (a link giving
	 * some pipe its tile's every direction)
	 * @returns {{plain: LinkCandidate[], completing: LinkCandidate[], completingPlus: LinkCandidate[]}}
	 */
	const collectLinks = () => {
		/** @type {LinkCandidate[]} */
		const plain = [];
		/** @type {LinkCandidate[]} */
		const completing = [];
		/** @type {LinkCandidate[]} */
		const completingPlus = [];
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
						// a plus implies completing (a full-mask pipe fills the
						// union), so the plus check subsumes the tier split
						if (demotePlus && plusLink(candidate)) {
							completingPlus.push(candidate);
						} else if (candidate.completing) {
							completing.push(candidate);
						} else {
							plain.push(candidate);
						}
					}
				}
			}
		}
		return { plain, completing, completingPlus };
	};

	/**
	 * Re-derives a candidate's validity at apply time: earlier links of
	 * the same sweep may have consumed its directions, merged its
	 * components, shifted its ban state - or made it a plus (two clean
	 * links can stack onto one pipe, completing its every direction).
	 * Plus links stay valid in the plus tier's own sweep (allowPlus) and
	 * wherever the demotion is off (triangular grids)
	 * @param {LinkCandidate} candidate
	 * @param {boolean} [allowPlus]
	 */
	const linkStillValid = (candidate, allowPlus = false) => {
		const back = /** @type {Number} */ (opposite.get(candidate.direction));
		return (
			directionState(grid, tiles, candidate.cell, candidate.direction) === CLAIM_STATE.FREE &&
			directionState(grid, tiles, candidate.neighbour, back) === CLAIM_STATE.FREE &&
			uf.find(grid.pipeNodeId(candidate.cell, candidate.pipeIndex)) !==
				uf.find(grid.pipeNodeId(candidate.neighbour, candidate.neighbourPipeIndex)) &&
			!bannedLink(candidate) &&
			(allowPlus || !demotePlus || !plusLink(candidate))
		);
	};

	/**
	 * Shuffles a tier and applies its still-valid links, one board sweep
	 * @param {LinkCandidate[]} tier
	 * @param {boolean} allowPlus - the plus tier accepts plus links
	 */
	const applyLinkSweep = (tier, allowPlus) => {
		shuffleInPlace(tier);
		for (const candidate of tier) {
			if (uf.count === 1) {
				break;
			}
			if (linkStillValid(candidate, allowPlus)) {
				applyLink(candidate);
			}
		}
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
	 * defense. A fusion whose result is a fully connected single pipe (a
	 * plus) is demoted to its own tier, mirroring the plus link demotion.
	 * @returns {{fusions: FuseCandidate[], plusFusions: FuseCandidate[]}}
	 */
	const collectFusions = () => {
		/** @type {FuseCandidate[]} */
		const fusions = [];
		/** @type {FuseCandidate[]} */
		const plusFusions = [];
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
					if (demotePlus && (pipes[first] | pipes[second]) === fullyConnected(cell)) {
						plusFusions.push({ cell, firstPipeIndex: first, secondPipeIndex: second });
					} else {
						fusions.push({ cell, firstPipeIndex: first, secondPipeIndex: second });
					}
				}
			}
		}
		return { fusions, plusFusions };
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

	// tier order, each round taking the first non-empty bucket: plain
	// links, clean completing links, clean fusions, plus links, plus
	// fusions. Plus moves are demoted, not banned, so a board whose only
	// merge makes a plus still merges - and the staleness guard can
	// never wedge the loop: a plus link skipped in a clean sweep is
	// re-collected into the plus tier next round, and that tier's own
	// sweep accepts them
	while (uf.count > 1) {
		const { plain, completing, completingPlus } = collectLinks();
		if (plain.length > 0) {
			applyLinkSweep(plain, false);
			continue;
		}
		if (completing.length > 0) {
			applyLinkSweep(completing, false);
			continue;
		}
		const { fusions, plusFusions } = collectFusions();
		if (fusions.length > 0) {
			// one fusion per round: a splice shifts pipe indices of its
			// tile, so the other collected candidates' indices would go
			// stale. The next round recollects against the rebased board
			applyFusion(fusions[Math.floor(Math.random() * fusions.length)]);
			continue;
		}
		if (completingPlus.length > 0) {
			applyLinkSweep(completingPlus, true);
			continue;
		}
		if (plusFusions.length > 0) {
			applyFusion(plusFusions[Math.floor(Math.random() * plusFusions.length)]);
			continue;
		}
		throw new UnmergeableBoardError(
			`Pregeneration: cannot merge the board - ${uf.count} components remain ` +
				'with no link or fusion candidate (a sealed seam)'
		);
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
 * until the merge phase links and fuses the trees into one. With
 * startTiles the pass regrows instead: the kept reuse components load
 * as some of the trees (pipes pre-unioned) and the erased region grows
 * around them, see growAttempt. Only the successful attempt's events
 * reach onEvent, so a replay of the stream mirrors the returned tiles
 * exactly.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {ForestKnobs} [knobs]
 * @param {(event: ForestEvent) => void} [onEvent] - receives growth and merge events
 * @param {StartTiles} [startTiles] - reused material from a previous
 * uniqueness iteration, empty or short arrays grow a fresh board
 * @param {Number} [reuseMinCount] - minimum component size to reuse
 * @returns {Number[][]} - unrandomized multipipes tiles
 */
export function pregenerateForest(
	grid,
	knobs = {},
	onEvent = undefined,
	startTiles = [],
	reuseMinCount = 3
) {
	/** @param {Number|undefined} value */
	const clamp = (value) => Math.min(1, Math.max(0, value || 0));
	/** @type {Required<ForestKnobs>} */
	const full = {
		sharingAmount: clamp(knobs.sharingAmount === undefined ? 0.35 : knobs.sharingAmount),
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
			const tiles = growAttempt(grid, full, events, startTiles, reuseMinCount);
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

/**
 * OR of all pipe bitmasks = directions already used by some pipe of this tile
 * @param {Number[]} pipes
 * @returns {Number}
 */
function usedDirections(pipes) {
	let used = 0;
	for (let pipe of pipes) {
		used |= pipe;
	}
	return used;
}

/**
 * Randomize rotations of multipipes tiles: one random rotation per tile,
 * applied to all of its pipes together - the tile stays a pure rotation of
 * its solved shape, the puzzle the player receives
 * @param {Number[][]} tiles
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @returns {Number[][]}
 */
export function randomRotate(tiles, grid) {
	return tiles.map((pipes, index) => {
		if (pipes.length === 0) {
			return [];
		}
		const polygon = grid.polygonAt(index);
		const rotations = Math.floor(Math.random() * polygon.numDirections);
		return pipes.map((pipe) => polygon.rotate(pipe, rotations));
	});
}

/**
 * Applies solved rotations to multipipes tiles,
 * Solver sentinel rotations (negative numbers) count as no rotation
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 * @param {Number[]} rotations - rotation per cell
 * @returns {Number[][]}
 */
export function applyRotations(grid, tiles, rotations) {
	return tiles.map((pipes, index) => {
		if (pipes.length === 0) {
			return [];
		}
		const rotation = rotations[index];
		const amount = typeof rotation === 'number' && rotation > 0 ? rotation : 0;
		const polygon = grid.polygonAt(index);
		return pipes.map((pipe) => polygon.rotate(pipe, amount));
	});
}

/**
 * Checks that multipipes tiles form a valid puzzle network. Throws an Error
 * naming the first broken rule: coverage, direction exclusivity, mutual edge
 * matching, one spanning tree over all pipe nodes
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles
 */
export function validateMulti(grid, tiles) {
	const total = grid.total;
	const playable = total - grid.emptyCells.size;
	/** @type {Map<String, String[]>} adjacency between nodes */
	const adjacency = new Map();
	/** @type {(cell: Number, pipeIndex: Number) => String} */
	const key = (cell, pipeIndex) => `${cell}_${pipeIndex}`;
	let nodes = 0;
	let connectionEnds = 0;
	let first = null;

	for (let index = 0; index < total; index++) {
		const pipes = tiles[index];
		if (grid.emptyCells.has(index)) {
			if (pipes.length > 0) {
				throw new Error(`Tile ${index} is empty but has pipes`);
			}
			continue;
		}
		if (pipes.length === 0 && playable > 1) {
			throw new Error(`Tile ${index} has no pipes`);
		}
		const polygon = grid.polygonAt(index);
		const used = usedDirections(pipes);
		const xored = pipes.reduce((a, b) => a ^ b, 0);
		if (used !== xored) {
			throw new Error(`Tile ${index} uses a direction in more than one pipe`);
		}
		for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
			const pipe = pipes[pipeIndex];
			if (pipe === 0) {
				throw new Error(`Tile ${index} pipe ${pipeIndex} has no connections`);
			}
			if ((pipe | polygon.fullyConnected) !== polygon.fullyConnected) {
				throw new Error(`Tile ${index} pipe ${pipeIndex} has invalid direction bits`);
			}
			const from = key(index, pipeIndex);
			adjacency.set(from, []);
			if (first === null) {
				first = from;
			}
			nodes += 1;
			let bits = pipe;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				connectionEnds += 1;
				const { neighbour, empty } = grid.findNeighbour(index, direction);
				if (empty || neighbour < 0) {
					throw new Error(`Tile ${index} connects outside the board in direction ${direction}`);
				}
				const opposite = grid.OPPOSITE.get(direction) || 0;
				const neighbourPipes = tiles[neighbour];
				let matched = -1;
				for (let j = 0; j < neighbourPipes.length; j++) {
					if ((neighbourPipes[j] & opposite) > 0) {
						matched = j;
						break;
					}
				}
				if (matched === -1) {
					throw new Error(
						`Tile ${index} direction ${direction} has no matching connection at tile ${neighbour}`
					);
				}
				adjacency.get(from)?.push(key(neighbour, matched));
			}
		}
	}

	if (connectionEnds !== 2 * (nodes - 1)) {
		throw new Error(
			`Node graph is not a tree: ${nodes} nodes have ${connectionEnds / 2} connections`
		);
	}
	if (nodes === 0) {
		return;
	}
	const seen = new Set([first]);
	const queue = [first];
	while (queue.length > 0) {
		const current = /** @type {String} */ (queue.pop());
		for (let next of adjacency.get(current) || []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	if (seen.size !== nodes) {
		throw new Error(`Node graph is disconnected: reached ${seen.size} of ${nodes}`);
	}
}

/**
 * @typedef {'unique'|'multiple'|'whatever'} SolutionsNumber
 */

/**
 * @typedef {object} GeneratorProgress
 * @property {Number} attempt
 * @property {Number} iteration
 */

/**
 * Worker-facing generation options, the channel every knob flows through
 * @typedef {object} GeneratorOptions
 * @property {Number} [sharingAmount] - the forest sharing knob, values in
 * range [0,1], see ForestKnobs (the engine default 0.35 applies when unset)
 * @property {Number} [branchingAmount] - frontier selection blend, [0,1]
 * @property {Number} [avoidObvious] - demotes obviously solvable border
 * orientations, [0,1]
 * @property {Number} [avoidStraights] - demotes straight-making moves, [0,1]
 * @property {SolutionsNumber} [solutionsNumber]
 * @property {Number} [treeCount] - number of trees to grow, 0 = the default
 * max(3, floor(playable cells / 20)), see defaultTreeCount
 * @property {Number} [maxAmbiguousTiles] - cap on ambiguities searched per
 * uniqueness iteration, 0 or undefined means the default max(100, 0.1 * total)
 */

/**
 * Cells a regrowth actually loaded from its start tiles: the reuse plan's
 * kept count, 0 on fresh boards. Recomputes the plan pregenerateForest
 * builds internally - a cheap pipe flood fill next to the solver run it
 * accompanies, and the price of keeping pregenerateForest's signature
 * plan-free
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {StartTiles} startTiles
 * @param {Number} reuseMinCount
 * @returns {Number}
 */
function keptCellCount(grid, startTiles, reuseMinCount) {
	if (startTiles.length !== grid.total) {
		return 0;
	}
	return planReusedComponents(grid, startTiles, reuseMinCount).keptCount;
}

/**
 * Snapshot of one uniqueness iteration, see MultiGenerator.uniqueIterations
 * @typedef {object} IterationSnapshot
 * @property {Number} attempt
 * @property {Number} iteration
 * @property {Number[][]} tiles - the freshly generated (unscrambled) board
 * @property {Number[]} marked - solver-frame rotations per tile, AMBIGUOUS/UNSOLVED sentinels for bad tiles
 * @property {Number} numAmbiguous
 * @property {boolean} unique - the search finished and found a unique solution
 * @property {Number} keptCount - tiles this board reused from the previous iteration
 * @property {Number} elapsedMs - time spent in the solver for this iteration
 */

/** @param {GeneratorProgress} progress */
const emptyGeneratorCallback = (progress) => {};

/**
 * Generates multipipes puzzles on the forest engine, mirroring the classic
 * generator's uniqueness loop: solve with the solver's ambiguity marking;
 * unique → scramble and return; otherwise reuse the determined tiles and
 * regrow around them (see pregenerateForest), with classic's patience and
 * attempt budgets
 */ export class MultiGenerator {
	/**
	 * @constructor
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number} [reuse_tiles_min_count = 3] minimum count of connected cells to reuse when erasing ambiguities
	 * @param {Number} [uniqueness_patience = 5] abandon generation attempt if the count of ambiguous cells did not decrease in this many iterations
	 * @param {Number} [max_attempts = 100] abandon generation if no attempt produced a unique puzzle
	 * @param {Number} [max_uniqueness_iterations = 100] abandon an attempt after this many uniqueness iterations
	 * @param {(progress: import('#lib/puzzle/solver/solver.js').SolverProgress) => void} [solver_progress_callback] reports solver progress
	 * @param {(progress: GeneratorProgress) => void} [generator_progress_callback] reports generation progress
	 */
	constructor(
		grid,
		reuse_tiles_min_count = 3,
		uniqueness_patience = 5,
		max_attempts = 100,
		max_uniqueness_iterations = 100,
		solver_progress_callback = undefined,
		generator_progress_callback = undefined
	) {
		this.grid = grid;
		this.reuse_tiles_min_count = reuse_tiles_min_count;
		this.uniqueness_patience = uniqueness_patience;
		this.max_attempts = max_attempts;
		this.max_uniqueness_iterations = max_uniqueness_iterations;
		this.solver_progress_callback = solver_progress_callback;
		this.generator_progress_callback = generator_progress_callback || emptyGeneratorCallback;
	}

	/**
	 * Builds the forest knobs object the engine consumes
	 * @param {Number} sharingAmount
	 * @param {Number} branchingAmount
	 * @param {Number} avoidObvious
	 * @param {Number} avoidStraights
	 * @param {Number} treeCount
	 * @returns {ForestKnobs}
	 */
	knobs(sharingAmount, branchingAmount, avoidObvious, avoidStraights, treeCount) {
		return { sharingAmount, branchingAmount, avoidObvious, avoidStraights, treeCount };
	}

	/**
	 * A solver wired to this generator's progress reporting
	 * @param {Number[][]} tiles
	 * @returns {Solver}
	 */
	makeSolver(tiles) {
		const solver = new Solver(tiles, this.grid);
		if (this.solver_progress_callback) {
			solver.progressCallback = this.solver_progress_callback;
		}
		return solver;
	}

	/**
	 * Grows one board from reuse material, reporting what it kept: the
	 * pregenerate plus the kept cell count of its start tiles, the pair
	 * every iteration of the loop needs
	 * @param {ForestKnobs} knobs
	 * @param {StartTiles} startTiles
	 * @returns {{tiles: Number[][], keptCount: Number}}
	 */
	regrow(knobs, startTiles) {
		return {
			tiles: pregenerateForest(this.grid, knobs, undefined, startTiles, this.reuse_tiles_min_count),
			keptCount: keptCellCount(this.grid, startTiles, this.reuse_tiles_min_count)
		};
	}

	/**
	 * Runs the uniqueness generation loop step by step, yielding a snapshot
	 * of every solver iteration. The snapshot describes the freshly generated
	 * (unscrambled) board: non-sentinel `marked` tiles are the ones the solver
	 * certified, they feed the next iteration as reused start tiles (reported
	 * as this board's `keptCount`). Stops after yielding a unique snapshot,
	 * or when the attempts are exhausted. Classic's patience logic: an
	 * iteration without an ambiguity decrease costs patience; the search cap
	 * climbs to the true count once the cap is hit, so the patience tracks
	 * real numbers there too
	 * @param {Number} sharingAmount - see ForestKnobs
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {Number} [ambiguousLimitOverride = 0] - cap on ambiguities searched per iteration,
	 * 0 means the default max(100, 0.1 * total). A limit >= total marks every ambiguity
	 * and lets the patience tracking work on the true counts.
	 * @param {Number} [avoidStraights = 0] - value in range [0, 1], higher values lead to fewer straight pipes
	 * @param {Number} [treeCount = 0] - number of trees to grow, 0 = defaultTreeCount
	 * @returns {Generator<IterationSnapshot, void, void>}
	 */
	*uniqueIterations(
		sharingAmount = 0.35,
		branchingAmount = 0.5,
		avoidObvious = 0.0,
		ambiguousLimitOverride = 0,
		avoidStraights = 0.0,
		treeCount = 0
	) {
		const knobs = this.knobs(
			sharingAmount,
			branchingAmount,
			avoidObvious,
			avoidStraights,
			treeCount
		);
		/** @type {StartTiles} */
		let startTiles = [];
		let attempt = 0;
		const ambiguousLimit =
			ambiguousLimitOverride > 0 ? ambiguousLimitOverride : Math.max(100, 0.1 * this.grid.total); // don't look for more ambiguous tiles than this
		while (attempt < this.max_attempts) {
			attempt += 1;
			let { tiles, keptCount } = this.regrow(knobs, startTiles);
			let iteration = 0;
			let patienceLeft = this.uniqueness_patience;
			let ambiguous = this.grid.total;
			while (iteration < this.max_uniqueness_iterations) {
				iteration += 1;
				const started = performance.now();
				this.generator_progress_callback({ attempt, iteration });
				const { solvable, marked, unique, numAmbiguous } = this.makeSolver(
					tiles
				).markAmbiguousTiles(Math.min(ambiguous, ambiguousLimit));
				const elapsedMs = performance.now() - started;
				if (!solvable) {
					throw 'Pregeneration returned an unsolvable puzzle';
				}
				/** @type {IterationSnapshot} */
				const snapshot = {
					attempt,
					iteration,
					tiles,
					marked,
					numAmbiguous,
					unique,
					keptCount,
					elapsedMs
				};
				if (snapshot.unique) {
					yield snapshot;
					return;
				}
				if (ambiguous > ambiguousLimit && numAmbiguous >= ambiguousLimit) {
					// the cap saturated: climb it by reusing from the true
					// markings without spending patience
					startTiles = buildStartTiles(this.grid, tiles, marked);
				} else if (numAmbiguous >= ambiguous) {
					patienceLeft -= 1;
				} else {
					ambiguous = numAmbiguous;
					patienceLeft = this.uniqueness_patience;
					startTiles = buildStartTiles(this.grid, tiles, marked);
				}
				yield snapshot;
				if (patienceLeft === 0) {
					break;
				}
				({ tiles, keptCount } = this.regrow(knobs, startTiles));
			}
		}
	}

	/**
	 * Generate a puzzle according to settings
	 * @param {Number} sharingAmount - see ForestKnobs
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {SolutionsNumber} solutionsNumber - unique/multiple solutions or disable this check
	 * @param {Number} [avoidStraights = 0] - value in range [0, 1], higher values lead to fewer straight pipes
	 * @param {Number} [treeCount = 0] - number of trees to grow, 0 = defaultTreeCount
	 * @returns {Number[][]} - generated tiles, random rotated
	 */
	generate(
		sharingAmount = 0.35,
		branchingAmount = 0.5,
		avoidObvious = 0.0,
		solutionsNumber = 'unique',
		avoidStraights = 0.0,
		treeCount = 0
	) {
		if (solutionsNumber === 'unique') {
			for (const step of this.uniqueIterations(
				sharingAmount,
				branchingAmount,
				avoidObvious,
				0,
				avoidStraights,
				treeCount
			)) {
				if (step.unique) {
					return randomRotate(step.tiles, this.grid);
				}
			}
			throw 'Could not generate a multipipes puzzle with a unique solution. Maybe try again.';
		} else if (solutionsNumber === 'whatever') {
			const tiles = pregenerateForest(
				this.grid,
				this.knobs(sharingAmount, branchingAmount, avoidObvious, avoidStraights, treeCount)
			);
			return randomRotate(tiles, this.grid);
		} else if (solutionsNumber === 'multiple') {
			let attempt = 0;
			while (attempt < this.max_attempts) {
				attempt += 1;
				this.generator_progress_callback({ attempt, iteration: 1 });
				const tiles = pregenerateForest(
					this.grid,
					this.knobs(sharingAmount, branchingAmount, avoidObvious, avoidStraights, treeCount)
				);
				const { unique } = this.makeSolver(tiles).markAmbiguousTiles(1);
				if (!unique) {
					return randomRotate(tiles, this.grid);
				}
			}
			throw `Could not generate a multipipes puzzle with multiple solutions in ${this.max_attempts} attempts. Maybe try again.`;
		} else {
			throw 'Unknown setting for solutionsNumber';
		}
	}
}
