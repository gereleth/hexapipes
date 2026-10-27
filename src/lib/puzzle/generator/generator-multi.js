import { Solver } from '#lib/puzzle/solver/solver.js';
import { popcount } from '#lib/puzzle/grids/bitmasks.js';

/**
 * @typedef {'unique'|'multiple'|'whatever'} SolutionsNumber
 */

/**
 * @typedef {object} GeneratorProgress
 * @property {Number} attempt
 * @property {Number} iteration
 */

/**
 * @typedef {object} GeneratorOptions
 * @property {Number} branchingAmount
 * @property {Number} avoidObvious
 * @property {SolutionsNumber} solutionsNumber
 * @property {Number} [sharingAmount] - probability of growing into a visited
 * cell again, values in range [0,1], 0 produces classic puzzles,
 * 0 or undefined means the default 0.6 = FIXME 0 should mean 0!
 * @property {Number} [maxAmbiguousTiles] - cap on ambiguities searched per iteration,
 * 0 or undefined means the default max(100, 0.1 * total)
 */

/**
 * Returns a random element from an array
 * @param {Array<any>} array
 */
function getRandomElement(array) {
	const index = Math.floor(Math.random() * array.length);
	return array[index];
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
 * Adds or removes one cell from one frontier list
 * @param {Number[]} list
 * @param {Number} cell
 * @param {boolean} member - whether the cell should be listed
 */
function syncFrontierList(list, cell, member) {
	const index = list.indexOf(cell);
	if (member && index < 0) {
		list.push(cell);
	} else if (!member && index >= 0) {
		list.splice(index, 1);
	}
}

/**
 * Number of subtrees grown simultaneously on fresh boards, scaling with
 * the board size: three on small boards, one more per 50 tiles.
 * Reused components count toward it, fresh subtrees top it up,
 * see pregenerate_multi_attempt
 * @param {Number} total
 * @returns {Number}
 */
function subtreeCountFor(total) {
	return Math.max(3, Math.floor(total / 50));
}

/**
 * Multitiles for pregeneration reuse: a keepable cell holds its pipes,
 * a cell that should be regenerated holds null
 * @typedef {(Number[]|null)[]} StartTiles
 */

/**
 * Finds the pipe node id of the pipe at index that connects in backDirection
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {StartTiles} startTiles
 * @param {Number} index
 * @param {Number} backDirection
 * @returns {Number}
 */
function findBackNode(grid, startTiles, index, backDirection) {
	const pipes = startTiles[index];
	if (!pipes) {
		return -1;
	}
	for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
		if ((pipes[pipeIndex] & backDirection) > 0) {
			return grid.pipeNodeId(index, pipeIndex);
		}
	}
	return -1;
}

/**
 * Reuse fate of one keepable tile, see planReuse
 * @typedef {object} ReusePlanTile
 * @property {'live'|'island'|'dissolved'} role
 * @property {Number[]} pipes - pruned pipes to seed (empty when dissolved)
 */

/**
 * The reuse plan computed from startTiles, see planReuse
 * @typedef {object} ReusePlan
 * @property {Map<Number, ReusePlanTile>} tiles - keepable tiles only
 * @property {Map<Number, Set<Number>>} islands - dormant island cell index => all cells of the island
 * @property {ReusePlanStats} stats - fate accounting for research
 */

/**
 * Fate accounting of one reuse plan, see planReuse.
 * Cell and pipe node counts per role; losses are pipe node counts because
 * dissolved material is pipe node components.
 * @typedef {object} ReusePlanStats
 * @property {Number} keepableCells - playable cells with non-null startTiles
 * @property {Number} keepableNodes - nodes hosted by keepable cells
 * @property {Number} liveCells - cells hosting the live seed component
 * @property {Number} liveNodes - nodes actually seeded with the live component
 * @property {Number} islandCells - cells hosting dormant islands
 * @property {Number} islandNodes - nodes registered as dormant islands
 * @property {Number} conflictIslands - islands that needed carving around claimed cells
 * @property {Number} conflictWithLive - of these, sharing cells with the live seed
 * @property {Number} conflictWithIsland - sharing cells with a bigger island
 *  (an island can count in both, so the sum can exceed conflictIslands)
 * @property {Number} conflictLostNodes - nodes given up at claimed cells while carving
 * @property {Number} conflictMaxIslandSize - size of the biggest island that needed carving
 * @property {Number} fragmentLostNodes - nodes in carve pieces below the minimum island size
 * @property {Number} tooSmallLostNodes - nodes in whole components below the minimum island size
 */

/**
 * Computes which parts of startTiles survive into the next generation:
 * the largest keepable pipe nodes component seeds the growing tree ('live'),
 * smaller ones become dormant 'island's, carved around cells already
 * claimed by bigger components instead of dissolving entirely (bigger
 * components win the shared cells; surviving pieces of at least
 * minIslandSize nodes register as their own islands), everything
 * else 'dissolves' (too small, or only connected to erased cells).
 * Every registered component owns its cells exclusively, which keeps
 * the per-cell seeding and island absorption machinery correct.
 * Pipe masks are pruned to edges staying within their component.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {StartTiles} startTiles
 * @param {Number} reuseMinCount - minimum count of nodes to leave dormant
 * @returns {ReusePlan}
 */
export function planReuse(grid, startTiles, reuseMinCount = 3) {
	const total = grid.total;
	/** @type {Map<Number, ReusePlanTile>} */
	const tiles = new Map();
	/** @type {Map<Number, Set<Number>>} cell index => cells of the dormant island containing it */
	const islands = new Map();

	/** @type {Set<Number>} playable cells worth keeping */
	const keepable = new Set();
	let keepableNodes = 0;
	for (let index = 0; index < total; index++) {
		if (!grid.emptyCells.has(index) && startTiles[index]) {
			keepable.add(index);
			keepableNodes += /** @type {Number[]} */ (startTiles[index]).length;
		}
	}

	/**
	 * Floods the pipe node component containing startId over mutual edges,
	 * visiting only nodes from the allowed set (which also excludes
	 * empty and non-keepable neighbours: their tiles are null so
	 * findBackNode returns -1).
	 * @param {Number} startId - pipe node id
	 * @param {Set<Number>} allowed - nodess that may join the component
	 * @param {Set<Number>} seen - nodes already assigned; the new component is added
	 * @returns {Set<Number>}
	 */
	const collectComponent = (startId, allowed, seen) => {
		const component = new Set([startId]);
		seen.add(startId);
		const queue = [startId];
		while (queue.length > 0) {
			const current = /** @type {Number} */ (queue.pop());
			const [cellIndex, pipeIndex] = grid.cellIndexPipeIndexOf(current);
			const pipe = /** @type {Number[]} */ (startTiles[cellIndex])[pipeIndex];
			let bits = pipe;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				const { neighbour, empty } = grid.findNeighbour(cellIndex, direction);
				if (empty) {
					continue;
				}
				const backId = findBackNode(grid, startTiles, neighbour, grid.OPPOSITE.get(direction) || 0);
				if (backId < 0 || !allowed.has(backId) || component.has(backId)) {
					continue;
				}
				component.add(backId);
				seen.add(backId);
				queue.push(backId);
			}
		}
		return component;
	};

	// find connected components of keepable pipe nodes.
	// pipes within a cell never connect to each other,
	// so one cell can host nodes of several different components.
	// A component can also hold several nodes of one cell
	// (a path through the cell enters/exits via different pipes)
	/** @type {Set<Number>} all pipe node ids of keepable cells */
	const allNodes = new Set();
	for (let cell of keepable) {
		const pipes = /** @type {Number[]} */ (startTiles[cell]);
		for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
			allNodes.add(grid.pipeNodeId(cell, pipeIndex));
		}
	}
	/** @type {Set<Number>[]} sets of pipe node ids */
	const components = [];
	/** @type {Set<Number>} pipe node ids already assigned to a component */
	const seen = new Set();
	for (let id of allNodes) {
		if (seen.has(id)) {
			continue;
		}
		components.push(collectComponent(id, allNodes, seen));
	}
	components.sort((a, b) => -(a.size - b.size));

	/**
	 * Builds the pipes list of one reused tile: only pipes belonging to
	 * the component, each pruned to edges staying within the component.
	 * Pipes that lose all connections this way are dropped.
	 * @param {Number} cell
	 * @param {Set<Number>} component
	 * @returns {Number[]}
	 */
	const pruneTilePipes = (cell, component) => {
		const pipes = /** @type {Number[]} */ (startTiles[cell]);
		const result = [];
		for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
			if (!component.has(grid.pipeNodeId(cell, pipeIndex))) {
				continue;
			}
			let mask = pipes[pipeIndex];
			let bits = mask;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				const backId = empty
					? -1
					: findBackNode(grid, startTiles, neighbour, grid.OPPOSITE.get(direction) || 0);
				if (backId < 0 || !component.has(backId)) {
					mask ^= direction;
				}
			}
			if (mask > 0) {
				result.push(mask);
			}
		}
		return result;
	};

	/** @type {Set<Number>} cells already claimed by a reused component */
	const claimed = new Set();
	/** @type {Set<Number>} cells claimed by the live component */
	const liveClaimed = new Set();
	// the largest component seeds the growing tree
	const live = components[0];
	/** @type {ReusePlanStats} */
	const stats = {
		keepableCells: keepable.size,
		keepableNodes: keepableNodes,
		liveCells: 0,
		liveNodes: 0,
		islandCells: 0,
		islandNodes: 0,
		conflictIslands: 0,
		conflictWithLive: 0,
		conflictWithIsland: 0,
		conflictLostNodes: 0,
		conflictMaxIslandSize: 0,
		fragmentLostNodes: 0,
		tooSmallLostNodes: 0
	};
	if (live) {
		/** @type {Set<Number>} cells hosting live pipe nodes */
		const liveCells = new Set();
		for (let id of live) {
			liveCells.add(grid.cellIndexPipeIndexOf(id)[0]);
		}
		for (let cell of liveCells) {
			const pruned = pruneTilePipes(cell, live);
			if (pruned.length > 0) {
				claimed.add(cell);
				liveClaimed.add(cell);
				tiles.set(cell, { role: 'live', pipes: pruned });
				stats.liveCells += 1;
				stats.liveNodes += pruned.length;
			} else {
				tiles.set(cell, { role: 'dissolved', pipes: [] });
			}
		}
		// a single-pipe-node live component has no internal edges to seed
		stats.tooSmallLostNodes += live.size - stats.liveNodes;
	}
	// reuse good smaller regions too, they stay dormant
	// until the growing tree touches them
	const minIslandSize = Math.max(2, reuseMinCount);
	for (let compIndex = 1; compIndex < components.length; compIndex++) {
		const component = components[compIndex];
		if (component.size < minIslandSize) {
			// this and all smaller components are too small to reuse
			for (let rest = compIndex; rest < components.length; rest++) {
				stats.tooSmallLostNodes += components[rest].size;
				for (let id of components[rest]) {
					const cell = grid.cellIndexPipeIndexOf(id)[0];
					if (!tiles.has(cell)) {
						tiles.set(cell, { role: 'dissolved', pipes: [] });
					}
				}
			}
			break;
		}
		/** @type {Set<Number>} cells hosting this island's nodes */
		const islandCells = new Set();
		for (let id of component) {
			islandCells.add(grid.cellIndexPipeIndexOf(id)[0]);
		}
		// carve the island around cells already claimed by bigger
		// components instead of dissolving it: bigger components win
		// the shared cells, the rest re-floods into smaller islands
		let withLive = false;
		let withIsland = false;
		for (let cell of islandCells) {
			if (!claimed.has(cell)) {
				continue;
			}
			if (liveClaimed.has(cell)) {
				withLive = true;
			} else {
				withIsland = true;
			}
		}
		/** @type {Set<Number>[]} */
		let pieces = [component];
		if (withLive || withIsland) {
			stats.conflictIslands += 1;
			if (withLive) {
				stats.conflictWithLive += 1;
			}
			if (withIsland) {
				stats.conflictWithIsland += 1;
			}
			stats.conflictMaxIslandSize = Math.max(stats.conflictMaxIslandSize, component.size);
			/** @type {Set<Number>} nodes of this island not at claimed cells */
			const carved = new Set();
			for (let id of component) {
				if (!claimed.has(grid.cellIndexPipeIndexOf(id)[0])) {
					carved.add(id);
				}
			}
			stats.conflictLostNodes += component.size - carved.size;
			pieces = [];
			/** @type {Set<Number>} nodes already assigned to a piece */
			const piecesSeen = new Set();
			for (let id of carved) {
				if (!piecesSeen.has(id)) {
					pieces.push(collectComponent(id, carved, piecesSeen));
				}
			}
			// pieces are node connected, but one component can hold
			// several nodes of one cell (paths through the cell), so
			// pieces can share cells. Registered pieces must own cells
			// exclusively: a piece sharing a cell with an already
			// registered (bigger) piece dissolves into fragments
			pieces.sort((a, b) => -(a.size - b.size));
		}
		/** @type {Set<Number>} cells claimed by this component's registered pieces */
		const pieceClaims = new Set();
		for (let piece of pieces) {
			if (piece.size < minIslandSize) {
				stats.fragmentLostNodes += piece.size;
				for (let id of piece) {
					const cell = grid.cellIndexPipeIndexOf(id)[0];
					if (!tiles.has(cell)) {
						tiles.set(cell, { role: 'dissolved', pipes: [] });
					}
				}
				continue;
			}
			/** @type {Set<Number>} cells hosting this piece's nodes */
			const pieceCells = new Set();
			for (let id of piece) {
				pieceCells.add(grid.cellIndexPipeIndexOf(id)[0]);
			}
			let pieceConflict = false;
			for (let cell of pieceCells) {
				if (pieceClaims.has(cell)) {
					pieceConflict = true;
					break;
				}
			}
			if (pieceConflict) {
				stats.fragmentLostNodes += piece.size;
				for (let id of piece) {
					const cell = grid.cellIndexPipeIndexOf(id)[0];
					if (!tiles.has(cell)) {
						tiles.set(cell, { role: 'dissolved', pipes: [] });
					}
				}
				continue;
			}
			stats.islandCells += pieceCells.size;
			stats.islandNodes += piece.size;
			for (let cell of pieceCells) {
				pieceClaims.add(cell);
				claimed.add(cell);
				tiles.set(cell, { role: 'island', pipes: pruneTilePipes(cell, piece) });
				islands.set(cell, pieceCells);
			}
		}
	}
	return { tiles, islands, stats };
}

/**
 * A pregeneration growth event, see pregenerate_multi.
 * seed/move/merge mirror the board mutations exactly, demote/pop are
 * frontier bookkeeping without board effects; erase/absorb are handled by
 * the replay helpers and the debug page but currently never emitted
 * @typedef {{type: 'seed', cell: Number, role: String, pipes: Number[]}|
 * {type: 'erase', cell: Number}|
 * {type: 'move', fromCell: Number, pipeIndex: Number, direction: Number, neighbour: Number}|
 * {type: 'merge', fromCell: Number, pipeIndex: Number, direction: Number, neighbour: Number, neighbourPipeIndex: Number}|
 * {type: 'absorb', fromCell: Number, pipeIndex: Number, direction: Number, neighbour: Number, islandCells: Number[]}|
 * {type: 'demote', fromCell: Number, tier: String}|
 * {type: 'pop', fromCell: Number}} GrowthMove
 */

/**
 * Frontier lists of one subtree split by growth kind, holding node ids:
 * each entry's kind is its own pipe's degree. A
 * reused component can host several nodes per cell (through-paths), so
 * nodes — not cells — are the frontier unit. `cells` is the set of cells
 * the subtree occupies, for the own-tree move check
 * @typedef {{extending: Number[], branching: Number[], lastResort: Number[], cells: Set<Number>}} Subtree
 */

/**
 * A connection joining two subtrees grown by pregenerate_multi
 * @typedef {{fromCell: Number, pipeIndex: Number, direction: Number, neighbour: Number, neighbourPipeIndex: Number}} MergeCandidate
 */

/**
 * Fills a grid with multipipes tiles by growing trees of pipe nodes
 * The result is always a single spanning tree over all pipe nodes.
 * Fresh boards grow several subtrees simultaneously and merge them at the end
 * (see pregenerate_multi_attempt). Boards with reusable startTiles grow their
 * reused components as subtrees among them (see planReuse): the components
 * keep their certified internal structure and simply keep growing, and the
 * merge phase connects everything into one tree.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number} sharingAmount - probability of growing into an already
 * occupied cell, values in range [0,1], 0 produces classic puzzles.
 * @param {Number} branchingAmount - value in range [0, 1], low values grow
 * by extending deadend nodes (long corridor-like paths), high values grow
 * by branching busy nodes (Prim-like spread over the board)
 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders.
 * Not applied by this growth.
 * @param {StartTiles} startTiles - solved non-ambiguous tiles, null in cells to regenerate.
 * Reusable regions become growing subtrees.
 * @param {Number} reuseMinCount - minimum count of nodes to leave dormant when erasing ambiguities
 * @param {(move: GrowthMove) => void} [onMove] - reports growth events for animations,
 * each board mutation is mirrored by an event
 * @returns {Number[][]} - unrandomized multipipes tiles
 */
export function pregenerate_multi(
	grid,
	sharingAmount = 0.6,
	branchingAmount = 0.5,
	avoidObvious = 0,
	startTiles = [],
	reuseMinCount = 3,
	onMove = undefined
) {
	// only the successful attempt's events are reported, so replays of the
	// event stream mirror the returned board exactly
	/** @type {GrowthMove[]} */
	const attemptMoves = [];
	for (let attempt = 0; ; attempt++) {
		try {
			const tiles = pregenerate_multi_attempt(
				grid,
				sharingAmount,
				branchingAmount,
				startTiles,
				reuseMinCount,
				attemptMoves
			);
			for (let move of attemptMoves) {
				onMove?.(move);
			}
			return tiles;
		} catch (error) {
			attemptMoves.length = 0;
			if (attempt >= 20) {
				throw error;
			}
		}
	}
}

/**
 * Runs one growth attempt, see pregenerate_multi. Reusable startTiles
 * components become growing subtrees, fresh ones are seeded until the
 * size-based subtree count is reached. Throws when the growth stalls or
 * the subtrees cannot be merged
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number} sharingAmount
 * @param {Number} branchingAmount
 * @param {StartTiles} startTiles
 * @param {Number} reuseMinCount
 * @param {GrowthMove[]} attemptMoves - collects the attempt's growth events
 * @returns {Number[][]} - unrandomized multipipes tiles
 */
function pregenerate_multi_attempt(
	grid,
	sharingAmount,
	branchingAmount,
	startTiles,
	reuseMinCount,
	attemptMoves
) {
	const total = grid.total;

	/** @type {Number[][]} */
	const tiles = [];
	for (let i = 0; i < total; i++) {
		tiles.push([]);
	}

	/** @type {Set<Number>} A set of unvisited cells */
	const unvisited = new Set([...Array(total).keys()]);
	for (let index of grid.emptyCells) {
		unvisited.delete(index);
	}
	if (unvisited.size === 0) {
		return tiles;
	}

	const emit = /** @param {GrowthMove} move */ (move) => {
		attemptMoves.push(move);
	};
	const opposite = grid.OPPOSITE;
	const checkFullyConnected = grid.KIND !== 'triangular';

	/** @type {Subtree[]} */
	const trees = [];

	/** @type {Map<Number, Number[]>} cell index => owning subtree ids, aligned with tiles[cell] */
	const owners = new Map();

	/**
	 * Syncs a node's primary frontier memberships within one subtree:
	 * the kind of the node's own pipe decides between extending and
	 * branching. Only called for nodes the subtree may grow from.
	 * @param {Subtree} tree
	 * @param {Number} pipeNodeId
	 */
	const syncTreeFrontier = (tree, pipeNodeId) => {
		const [cell, pipeIndex] = grid.cellIndexPipeIndexOf(pipeNodeId);
		const wantsExtend = popcount(tiles[cell][pipeIndex]) <= 1;
		syncFrontierList(tree.extending, pipeNodeId, wantsExtend);
		syncFrontierList(tree.branching, pipeNodeId, !wantsExtend);
	};

	/**
	 * Removes a node from all of one subtree's frontier lists
	 * @param {Subtree} tree
	 * @param {Number} pipeNodeId
	 */
	const removeFromTreeFrontier = (tree, pipeNodeId) => {
		syncFrontierList(tree.extending, pipeNodeId, false);
		syncFrontierList(tree.branching, pipeNodeId, false);
		syncFrontierList(tree.lastResort, pipeNodeId, false);
	};

	/**
	 * Counts the tile's free directions that lead to an in-board neighbour.
	 * Only these can host merge connections later
	 * @param {Number} index
	 * @returns {Number}
	 */
	const inBoardFreeDirections = (index) => {
		const polygon = grid.polygonAt(index);
		const used = usedDirections(tiles[index]);
		let count = 0;
		for (let direction of polygon.directions) {
			if ((used & direction) === 0 && !grid.findNeighbour(index, direction).empty) {
				count += 1;
			}
		}
		return count;
	};

	/**
	 * Applies one growth move: extends the subtree's pipe at the source
	 * node and pushes a fresh pipe at the neighbour cell (fresh or
	 * occupied alike, that is always a new node for this subtree)
	 * @param {Subtree} tree
	 * @param {Number} treeIndex
	 * @param {Number} fromNode
	 * @param {Number} direction
	 * @param {Number} neighbour
	 * @param {boolean} syncSource - whether the source node's frontier
	 * kind should be re-synced (demoted tier cells are left alone)
	 */
	const applyMove = (tree, treeIndex, fromNode, direction, neighbour, syncSource) => {
		const [fromCell, pipeIndex] = grid.cellIndexPipeIndexOf(fromNode);
		tiles[fromCell][pipeIndex] |= direction;
		if (syncSource) {
			syncTreeFrontier(tree, fromNode);
		}
		tiles[neighbour].push(opposite.get(direction) || 0);
		const fresh = unvisited.has(neighbour);
		if (fresh) {
			unvisited.delete(neighbour);
		}
		tree.cells.add(neighbour);
		syncTreeFrontier(tree, grid.pipeNodeId(neighbour, tiles[neighbour].length - 1));
		const neighbourOwners = owners.get(neighbour);
		if (neighbourOwners) {
			neighbourOwners.push(treeIndex);
		} else {
			owners.set(neighbour, [treeIndex]);
		}
		emit({ type: 'move', fromCell: fromCell, pipeIndex: pipeIndex, direction, neighbour });
	};

	/**
	 * Makes one growth move for a subtree: picks a frontier node by the
	 * rolled growth kind, then a random valid direction of its tile.
	 * Nodes whose every remaining move makes a fully-connected union
	 * are demoted to the subtree's lastResort tier (if another primary
	 * node can be tried instead); nodes without any remaining move
	 * leave the frontier.
	 * @param {Subtree} tree
	 * @param {Number} treeIndex
	 * @returns {boolean} whether a move was made
	 */
	const growTree = (tree, treeIndex) => {
		for (;;) {
			// roll which kind of growth to use: extending a deadend node
			// (corridor-like) or branching a busy one (Prim-like spread)
			const useBranch = Math.random() < branchingAmount;
			const tiers = useBranch
				? [tree.branching, tree.extending, tree.lastResort]
				: [tree.extending, tree.branching, tree.lastResort];
			let sourceList = tree.lastResort;
			let fromNode = -1;
			for (let nodes of tiers) {
				if (nodes.length === 0) {
					continue;
				}
				sourceList = nodes;
				fromNode = getRandomElement(nodes);
				break;
			}
			if (fromNode === -1) {
				return false;
			}
			const fromPrimary = sourceList !== tree.lastResort;
			const fromCell = grid.cellIndexPipeIndexOf(fromNode)[0];

			const polygon = grid.polygonAt(fromCell);
			const used = usedDirections(tiles[fromCell]);
			// a mixed cell (several subtrees share it) must keep a spare
			// in-board free direction for the final merge connections —
			// but expanding into unvisited cells stays always allowed,
			// otherwise mixed cells could wall off unvisited pockets
			const mixedSource = new Set(/** @type {Number[]} */ (owners.get(fromCell))).size > 1;
			const sourceSpares = mixedSource ? inBoardFreeDirections(fromCell) : 2;

			/** @type {{direction: Number, neighbour: Number}[]} */
			const moves = [];
			/** @type {{direction: Number, neighbour: Number}[]} */
			const fullyConnectedMoves = [];
			for (let direction of polygon.directions) {
				if ((used & direction) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.findNeighbour(fromCell, direction);
				if (empty) {
					continue;
				}
				if (tree.cells.has(neighbour)) {
					// own subtree: connecting would close a cycle
					continue;
				}
				const backDirection = opposite.get(direction) || 0;
				const neighbourUsed = usedDirections(tiles[neighbour]);
				if (!unvisited.has(neighbour)) {
					// entering makes the target a mixed cell: it must keep a
					// spare in-board free direction for the final merge
					// connections
					if (inBoardFreeDirections(neighbour) <= 1) {
						continue;
					}
					// so must the mixed source: a non-expansion move would
					// spend one of its in-board spares
					if (sourceSpares <= 1) {
						continue;
					}
					if (Math.random() > sharingAmount) {
						continue;
					}
				}
				if ((neighbourUsed & backDirection) > 0) {
					throw 'Error in multi pregeneration: neighbour already connects back';
				}
				const fullyConnected =
					checkFullyConnected &&
					((used | direction) === polygon.fullyConnected ||
						(neighbourUsed | backDirection) === grid.polygonAt(neighbour).fullyConnected);
				if (fullyConnected && !unvisited.has(neighbour)) {
					// completely disregard moves that make a tile fully connected
					// without reaching unvisited places
					continue;
				}
				const move = { direction, neighbour };
				if (fullyConnected) {
					fullyConnectedMoves.push(move);
				} else {
					moves.push(move);
				}
			}

			const bestMoves = moves.length > 0 ? moves : fullyConnectedMoves;
			if (bestMoves.length === 0) {
				// no usable moves left, remove the node from the frontier
				emit({ type: 'pop', fromCell: fromNode });
				removeFromTreeFrontier(tree, fromNode);
				continue;
			}
			// demotion needs another primary node to try instead,
			// otherwise the only frontier entry would just demote instead of
			// moving on
			if (
				fromPrimary &&
				bestMoves === fullyConnectedMoves &&
				tree.extending.length + tree.branching.length > 1
			) {
				// wants to make a fully connected union, try other cells first
				emit({ type: 'demote', fromCell, tier: 'lastResort' });
				syncFrontierList(sourceList, fromNode, false);
				tree.lastResort.push(fromNode);
				continue;
			}

			const { direction, neighbour } = getRandomElement(bestMoves);
			applyMove(tree, treeIndex, fromNode, direction, neighbour, fromPrimary);
			return true;
		}
	};

	// reused startTiles components become the first subtrees: their cells
	// and pipes are claimed up front (pruned to intra-component edges by
	// planReuse), each node joins its component's frontier, and the
	// component keeps growing like any freshly seeded one
	if (startTiles.length === total) {
		const plan = planReuse(grid, startTiles, reuseMinCount);
		/** @type {Map<Set<Number>, Number[]>} island piece cell set => piece cells */
		const islandGroups = new Map();
		for (let [index, tilePlan] of plan.tiles) {
			if (tilePlan.role === 'island') {
				const piece = /** @type {Set<Number>} */ (plan.islands.get(index));
				const group = islandGroups.get(piece);
				if (group) {
					group.push(index);
				} else {
					islandGroups.set(piece, [index]);
				}
			}
		}
		/** @type {Number[][]} cell groups per reused component, live first */
		const reusedGroups = [[]];
		for (let [index, tilePlan] of plan.tiles) {
			if (tilePlan.role === 'live') {
				reusedGroups[0].push(index);
			}
		}
		for (let group of islandGroups.values()) {
			reusedGroups.push(group);
		}
		for (let group of reusedGroups) {
			if (group.length === 0) {
				continue;
			}
			const treeIndex = trees.length;
			/** @type {Subtree} */
			const tree = { extending: [], branching: [], lastResort: [], cells: new Set() };
			trees.push(tree);
			for (let index of group) {
				const tilePlan = /** @type {{role: String, pipes: Number[]}} */ (plan.tiles.get(index));
				tiles[index] = tilePlan.pipes;
				owners.set(
					index,
					tilePlan.pipes.map(() => treeIndex)
				);
				unvisited.delete(index);
				tree.cells.add(index);
				for (let pipeIndex = 0; pipeIndex < tilePlan.pipes.length; pipeIndex++) {
					syncTreeFrontier(tree, grid.pipeNodeId(index, pipeIndex));
				}
				// the event must snapshot the pipes: the board keeps the
				// tilePlan array and later pushes would mutate a shared payload
				emit({ type: 'seed', cell: index, role: tilePlan.role, pipes: [...tilePlan.pipes] });
			}
		}
	}

	// fresh subtrees top the count up, seeded on distinct random unvisited cells
	const freshCount = Math.min(Math.max(0, subtreeCountFor(total) - trees.length), unvisited.size);
	const freshStart = trees.length;
	/** @type {Number[]} seed node per fresh subtree */
	const seedCells = [];
	{
		/** @type {Number[]} */
		const playable = [...unvisited];
		for (let i = 0; i < freshCount; i++) {
			const pick = i + Math.floor(Math.random() * (playable.length - i));
			[playable[i], playable[pick]] = [playable[pick], playable[i]];
			const cell = playable[i];
			unvisited.delete(cell);
			tiles[cell].push(0);
			const treeIndex = trees.length;
			/** @type {Subtree} */
			const tree = { extending: [], branching: [], lastResort: [], cells: new Set() };
			trees.push(tree);
			tree.cells.add(cell);
			const seedId = grid.pipeNodeId(cell, 0);
			syncTreeFrontier(tree, seedId);
			owners.set(cell, [treeIndex]);
			seedCells.push(seedId);
			emit({ type: 'seed', cell, role: 'start', pipes: [0] });
		}
	}

	// opening round: every fresh subtree gets one forced expansion into an
	// unvisited cell, so none can lose the opening race and sit out the
	// whole game as a never-grown mask-0 seed that is easily sealed off
	// from all merge connections by its busy co-tenants. Targets are
	// unvisited only (ungated), so sharingAmount 0 keeps its meaning
	{
		/** @type {Number[]} */
		const order = [];
		for (let i = freshStart; i < trees.length; i++) {
			order.push(i);
		}
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		for (const treeIndex of order) {
			const tree = trees[treeIndex];
			const seedId = seedCells[treeIndex - freshStart];
			const cell = grid.cellIndexPipeIndexOf(seedId)[0];
			/** @type {Number[]} */
			const directions = [];
			for (let direction of grid.polygonAt(cell).directions) {
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				if (!empty && unvisited.has(neighbour)) {
					directions.push(direction);
				}
			}
			if (directions.length > 0) {
				const direction = /** @type {Number} */ (getRandomElement(directions));
				const neighbour = /** @type {Number} */ (grid.findNeighbour(cell, direction).neighbour);
				applyMove(tree, treeIndex, seedId, direction, neighbour, true);
			}
		}
	}

	/** @type {boolean[]} whether each subtree still has frontier cells */
	const alive = trees.map(() => true);
	while (unvisited.size > 0) {
		/** @type {Number[]} */
		const growing = [];
		for (let i = 0; i < trees.length; i++) {
			if (alive[i]) {
				growing.push(i);
			}
		}
		if (growing.length === 0) {
			throw 'Error in multi pregeneration: no subtree can grow while unvisited cells remain';
		}
		const treeIndex = getRandomElement(growing);
		if (!growTree(trees[treeIndex], treeIndex)) {
			alive[treeIndex] = false;
		}
	}

	// join the subtrees into one tree over all nodes: connect cells of
	// different components across free edges, once per merged component
	// pair, so no loops are introduced
	/** @type {Number[]} union-find parent over subtree ids */
	const parent = trees.map((_, i) => i);
	/** @type {(i: Number) => Number} */
	const find = (i) => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};

	/**
	 * Checks that after spending the candidate's edge on merging two
	 * components, all components stay connected through the remaining free
	 * edges, so the following merges stay possible
	 * @param {MergeCandidate} candidate
	 * @returns {boolean}
	 */
	const mergeKeepsComponentsConnected = (candidate) => {
		const rootA = find(
			/** @type {Number[]} */ (owners.get(candidate.fromCell))[candidate.pipeIndex]
		);
		const rootB = find(
			/** @type {Number[]} */ (owners.get(candidate.neighbour))[candidate.neighbourPipeIndex]
		);
		/** @type {Map<Number, Set<Number>>} component root => roots adjacent over free edges */
		const adjacency = new Map();
		/**
		 * @param {Number} treeId
		 * @returns {Number} component root after the merge
		 */
		const rootOf = (treeId) => {
			const root = find(treeId);
			return root === rootA || root === rootB ? rootA : root;
		};
		for (let cell = 0; cell < total; cell++) {
			const cellOwners = owners.get(cell);
			if (cellOwners === undefined) {
				continue;
			}
			const used = usedDirections(tiles[cell]);
			const polygon = grid.polygonAt(cell);
			for (let direction of polygon.directions) {
				if ((used & direction) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				if (empty) {
					continue;
				}
				if (
					(cell === candidate.fromCell && neighbour === candidate.neighbour) ||
					(cell === candidate.neighbour && neighbour === candidate.fromCell)
				) {
					// the edge this merge would spend
					continue;
				}
				const neighbourOwners = /** @type {Number[]} */ (owners.get(neighbour));
				for (let sourceTree of cellOwners) {
					for (let neighbourTree of neighbourOwners) {
						const a = rootOf(sourceTree);
						const b = rootOf(neighbourTree);
						if (a === b) {
							continue;
						}
						if (!adjacency.has(a)) {
							adjacency.set(a, new Set());
						}
						if (!adjacency.has(b)) {
							adjacency.set(b, new Set());
						}
						/** @type {Set<Number>} */ (adjacency.get(a)).add(b);
						/** @type {Set<Number>} */ (adjacency.get(b)).add(a);
					}
				}
			}
		}
		/** @type {Set<Number>} */
		const roots = new Set(trees.map((_, i) => rootOf(i)));
		const start = /** @type {Number} */ (roots.values().next().value);
		/** @type {Set<Number>} */
		const seen = new Set([start]);
		/** @type {Number[]} */
		const queue = [start];
		while (queue.length > 0) {
			const node = /** @type {Number} */ (queue.pop());
			for (let next of adjacency.get(node) || []) {
				if (!seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			}
		}
		return seen.size === roots.size;
	};

	for (let mergesLeft = trees.length - 1; mergesLeft > 0; mergesLeft--) {
		/** @type {MergeCandidate[]} */
		const candidates = [];
		/** @type {MergeCandidate[]} */
		const fullyConnectedCandidates = [];
		for (let cell = 0; cell < total; cell++) {
			const cellOwners = owners.get(cell);
			if (cellOwners === undefined) {
				continue;
			}
			const used = usedDirections(tiles[cell]);
			const polygon = grid.polygonAt(cell);
			for (let direction of polygon.directions) {
				if ((used & direction) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.findNeighbour(cell, direction);
				if (empty) {
					continue;
				}
				const neighbourOwners = /** @type {Number[]} */ (owners.get(neighbour));
				const neighbourUsed = usedDirections(tiles[neighbour]);
				const neighbourFullyConnected = grid.polygonAt(neighbour).fullyConnected;
				const backDirection = opposite.get(direction) || 0;
				for (let pipeIndex = 0; pipeIndex < cellOwners.length; pipeIndex++) {
					for (
						let neighbourPipeIndex = 0;
						neighbourPipeIndex < neighbourOwners.length;
						neighbourPipeIndex++
					) {
						if (find(cellOwners[pipeIndex]) === find(neighbourOwners[neighbourPipeIndex])) {
							// same component already, connecting would close a loop
							continue;
						}
						const candidate = {
							fromCell: cell,
							pipeIndex,
							direction,
							neighbour,
							neighbourPipeIndex
						};
						// a fully connected union is a last resort, as during growth
						const fullyConnected =
							checkFullyConnected &&
							((used | direction) === polygon.fullyConnected ||
								(neighbourUsed | backDirection) === neighbourFullyConnected);
						if (fullyConnected) {
							fullyConnectedCandidates.push(candidate);
						} else {
							candidates.push(candidate);
						}
					}
				}
			}
		}
		// pick a random merge that leaves the remaining components connected
		// through free edges; normal candidates first, fully-connected unions
		// as a last resort. The last merge needs no check
		/** @type {MergeCandidate|undefined} */
		let chosen;
		for (let list of candidates.length > 0
			? [candidates, fullyConnectedCandidates]
			: [fullyConnectedCandidates]) {
			while (list.length > 0 && chosen === undefined) {
				const mergeIndex = Math.floor(Math.random() * list.length);
				const candidate = /** @type {MergeCandidate} */ (list[mergeIndex]);
				if (mergesLeft === 1 || mergeKeepsComponentsConnected(candidate)) {
					chosen = candidate;
				} else {
					list.splice(mergeIndex, 1);
				}
			}
			if (chosen !== undefined) {
				break;
			}
		}
		if (chosen === undefined) {
			throw 'Error in multi pregeneration: no merge connection found while subtrees remain';
		}
		const merge = chosen;
		tiles[merge.fromCell][merge.pipeIndex] |= merge.direction;
		tiles[merge.neighbour][merge.neighbourPipeIndex] |= opposite.get(merge.direction) || 0;
		const sourceTree = /** @type {Number[]} */ (owners.get(merge.fromCell))[merge.pipeIndex];
		const neighbourTree = /** @type {Number[]} */ (owners.get(merge.neighbour))[
			merge.neighbourPipeIndex
		];
		parent[find(sourceTree)] = find(neighbourTree);
		emit({
			type: 'merge',
			fromCell: merge.fromCell,
			pipeIndex: merge.pipeIndex,
			direction: merge.direction,
			neighbour: merge.neighbour,
			neighbourPipeIndex: merge.neighbourPipeIndex
		});
	}
	return tiles;
}

/**
 * Randomize rotations of multipipes tiles
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
 * Prepares a solved board for reuse in pregenerate_multi:
 * tiles whose marked rotation is a solver sentinel (ambiguous or unresolved)
 * become null, other tiles get their pipes rotated to the solver's frame
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Number[][]} tiles - solved multipipes tiles
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

const emptyCallback = (/**@type {GeneratorProgress} */ progress) => {};

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

/**
 * Generates multipipes puzzles. Mirrors the classic Generator:
 * for a unique solution it repeatedly re-pregenerates the board while
 * reusing non-ambiguous portions of the previous attempt
 * (see pregenerate_multi) and only regrowing the ambiguous parts.
 */
export class MultiGenerator {
	/**
	 * @constructor
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number} [reuse_tiles_min_count = 3] minimum count of connected nodes to leave dormant when erasing ambiguities
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
		this.generator_progress_callback = generator_progress_callback || emptyCallback;
	}

	/**
	 * Runs the uniqueness generation loop step by step,
	 * yielding a snapshot of every solver iteration.
	 * The snapshot describes the freshly generated (unscrambled) board:
	 * non-sentinel `marked` tiles are the ones the solver certified,
	 * they feed the next iteration as reused `startTiles` (and are
	 * reported as this board's `keptCount`).
	 * Stops after yielding a unique snapshot, or when the attempts
	 * are exhausted.
	 * @param {Number} sharingAmount - probability of growing into a visited cell again, values in range [0,1]
	 * 0 produces classic puzzles.
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {Number} [ambiguousLimitOverride = 0] - cap on ambiguities searched per iteration,
	 * 0 means the default max(100, 0.1 * total). A limit >= total marks every ambiguity
	 * and lets the patience tracking work on the true counts.
	 * @returns {Generator<IterationSnapshot, void, void>}
	 */
	*uniqueIterations(
		sharingAmount = 0.6,
		branchingAmount = 0.6,
		avoidObvious = 0.0,
		ambiguousLimitOverride = 0
	) {
		/** @type {StartTiles} */
		let startTiles = [];
		let attempt = 0;
		const ambiguousLimit =
			ambiguousLimitOverride > 0 ? ambiguousLimitOverride : Math.max(100, 0.1 * this.grid.total); // don't look for more ambiguous tiles than this
		while (attempt < this.max_attempts) {
			attempt += 1;
			let tiles = pregenerate_multi(
				this.grid,
				sharingAmount,
				branchingAmount,
				avoidObvious,
				startTiles,
				this.reuse_tiles_min_count
			);
			let iteration = 0;
			let patienceLeft = this.uniqueness_patience;
			let ambiguous = this.grid.total;
			while (iteration < this.max_uniqueness_iterations) {
				iteration += 1;
				const started = performance.now();
				this.generator_progress_callback({ attempt, iteration });
				const solver = new Solver(tiles, this.grid);
				if (this.solver_progress_callback) {
					solver.progressCallback = this.solver_progress_callback;
				}
				const { solvable, marked, unique, numAmbiguous } = solver.markAmbiguousTiles(
					Math.min(ambiguous, ambiguousLimit)
				);
				const elapsedMs = performance.now() - started;
				if (!solvable) {
					throw 'Pregeneration returned an unsolvable puzzle';
				}
				const keptCount = startTiles.reduce((n, pipes) => (pipes ? n + 1 : n), 0);
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
				tiles = pregenerate_multi(
					this.grid,
					sharingAmount,
					branchingAmount,
					avoidObvious,
					startTiles,
					this.reuse_tiles_min_count
				);
			}
		}
	}

	/**
	 * Generate a puzzle according to settings
	 * @param {Number} sharingAmount - probability of growing into a visited cell again, values in range [0,1]
	 * 0 produces classic puzzles.
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {SolutionsNumber} solutionsNumber - unique/multiple solutions or disable this check
	 * @returns {Number[][]} - generated tiles
	 */
	generate(
		sharingAmount = 0.6,
		branchingAmount = 0.6,
		avoidObvious = 0.0,
		solutionsNumber = 'unique'
	) {
		if (solutionsNumber === 'unique') {
			for (const step of this.uniqueIterations(sharingAmount, branchingAmount, avoidObvious)) {
				if (step.unique) {
					return randomRotate(applyRotations(this.grid, step.tiles, step.marked), this.grid);
				}
			}
			throw 'Could not generate a multipipes puzzle with a unique solution. Maybe try again.';
		} else if (solutionsNumber === 'whatever') {
			const tiles = pregenerate_multi(this.grid, sharingAmount, branchingAmount, avoidObvious);
			return randomRotate(tiles, this.grid);
		} else if (solutionsNumber === 'multiple') {
			let attempt = 0;
			while (attempt < this.max_attempts) {
				attempt += 1;
				this.generator_progress_callback({ attempt, iteration: 1 });
				const tiles = pregenerate_multi(this.grid, sharingAmount, branchingAmount, avoidObvious);
				const solver = new Solver(tiles, this.grid);
				if (this.solver_progress_callback) {
					solver.progressCallback = this.solver_progress_callback;
				}
				const { unique } = solver.markAmbiguousTiles(1);
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

/**
 * Checks that multipipes tiles form a valid puzzle network
 * Throws an Error when a rule is broken
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
