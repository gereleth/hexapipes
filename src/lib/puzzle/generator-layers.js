import { LayeredSolver } from '$lib/puzzle/solver-layers';

/**
 * @typedef {Number[][]} LayeredTiles - for every grid cell a list of layers,
 * each layer is a tile bitmask of its connections;
 * cells that are empty on the board have no layers
 */

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
 * @property {Number} [layeringAmount] - probability of growing into a visited
 * cell again, values in range [0,1], 0 produces classic puzzles,
 * 0 or undefined means the default 0.6
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
 * OR of all layer bitmasks = directions already used by some layer of this cell
 * @param {Number[]} cellLayers
 * @returns {Number}
 */
function usedDirections(cellLayers) {
	let used = 0;
	for (let layer of cellLayers) {
		used |= layer;
	}
	return used;
}

/**
 * Counts the set bits in a mask
 * @param {Number} mask
 * @returns {Number}
 */
function popcount(mask) {
	let bits = mask;
	let count = 0;
	while (bits > 0) {
		bits ^= bits & -bits;
		count += 1;
	}
	return count;
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
 * see pregenerate_layers_attempt
 * @param {Number} total
 * @returns {Number}
 */
function subtreeCountFor(total) {
	return Math.max(3, Math.floor(total / 50));
}

/**
 * Layered tiles for pregeneration reuse: a keepable cell holds its solved
 * layers already rotated to the solver's representative rotation,
 * a cell that should be regenerated holds null
 * @typedef {(Number[]|null)[]} StartLayers
 */

/**
 * Finds the sub-cell id of the layer at cell that connects in backDirection
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {StartLayers} startLayers
 * @param {Number} cell
 * @param {Number} backDirection
 * @returns {Number} - sub-cell id (cell + layer * grid.total) or -1 if there is none
 */
function findBackSubCell(grid, startLayers, cell, backDirection) {
	const cellLayers = startLayers[cell];
	if (!cellLayers) {
		return -1;
	}
	for (let layerIndex = 0; layerIndex < cellLayers.length; layerIndex++) {
		if ((cellLayers[layerIndex] & backDirection) > 0) {
			return grid.subcellId(cell, layerIndex);
		}
	}
	return -1;
}

/**
 * Reuse fate of one keepable cell, see planReuse
 * @typedef {object} ReusePlanCell
 * @property {'live'|'island'|'dissolved'} role
 * @property {Number[]} layers - pruned layer masks to seed (empty when dissolved)
 */

/**
 * The reuse plan computed from startLayers, see planReuse
 * @typedef {object} ReusePlan
 * @property {Map<Number, ReusePlanCell>} cells - keepable cells only
 * @property {Map<Number, Set<Number>>} islands - dormant island cell => all cells of the island
 * @property {ReusePlanStats} stats - fate accounting for research
 */

/**
 * Fate accounting of one reuse plan, see planReuse.
 * Cell and sub-cell counts per role; losses are sub-cell counts because
 * dissolved material is sub-cell components.
 * @typedef {object} ReusePlanStats
 * @property {Number} keepableCells - playable cells with non-null startLayers
 * @property {Number} keepableSubCells - sub-cells hosted by keepable cells
 * @property {Number} liveCells - cells hosting the live seed component
 * @property {Number} liveSubCells - sub-cells actually seeded with the live component
 * @property {Number} islandCells - cells hosting dormant islands
 * @property {Number} islandSubCells - sub-cells registered as dormant islands
 * @property {Number} conflictIslands - islands that needed carving around claimed cells
 * @property {Number} conflictWithLive - of these, sharing cells with the live seed
 * @property {Number} conflictWithIsland - sharing cells with a bigger island
 *  (an island can count in both, so the sum can exceed conflictIslands)
 * @property {Number} conflictLostSubCells - sub-cells given up at claimed cells while carving
 * @property {Number} conflictMaxIslandSize - size of the biggest island that needed carving
 * @property {Number} fragmentLostSubCells - sub-cells in carve pieces below the minimum island size
 * @property {Number} tooSmallLostSubCells - sub-cells in whole components below the minimum island size
 */

/**
 * Computes which parts of startLayers survive into the next generation:
 * the largest keepable sub-cell component seeds the growing tree ('live'),
 * smaller ones become dormant 'island's, carved around cells already
 * claimed by bigger components instead of dissolving entirely (bigger
 * components win the shared cells; surviving pieces of at least
 * minIslandSize sub-cells register as their own islands), everything
 * else 'dissolves' (too small, or only connected to erased cells).
 * Every registered component owns its cells exclusively, which keeps
 * the per-cell seeding and island absorption machinery correct.
 * Layer masks are pruned to edges staying within their component.
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {StartLayers} startLayers
 * @param {Number} reuseMinCount - minimum count of sub-cells to leave dormant
 * @returns {ReusePlan}
 */
export function planReuse(grid, startLayers, reuseMinCount = 3) {
	const total = grid.total;
	/** @type {Map<Number, ReusePlanCell>} */
	const cells = new Map();
	/** @type {Map<Number, Set<Number>>} cell index => cells of the dormant island containing it */
	const islands = new Map();

	/** @type {Set<Number>} playable cells worth keeping */
	const keepable = new Set();
	let keepableSubCells = 0;
	for (let index = 0; index < total; index++) {
		if (!grid.emptyCells.has(index) && startLayers[index]) {
			keepable.add(index);
			keepableSubCells += /** @type {Number[]} */ (startLayers[index]).length;
		}
	}

	/**
	 * Floods the sub-cell component containing startId over mutual edges,
	 * visiting only sub-cells from the allowed set (which also excludes
	 * empty and non-keepable neighbours: their layers are null so
	 * findBackSubCell returns -1).
	 * @param {Number} startId - sub-cell id (cell + layer * total)
	 * @param {Set<Number>} allowed - sub-cells that may join the component
	 * @param {Set<Number>} seen - sub-cells already assigned; the new component is added
	 * @returns {Set<Number>}
	 */
	const collectComponent = (startId, allowed, seen) => {
		const component = new Set([startId]);
		seen.add(startId);
		const queue = [startId];
		while (queue.length > 0) {
			const current = /** @type {Number} */ (queue.pop());
			const [currentCell, currentLayer] = grid.cellLayerOf(current);
			const layerMask = /** @type {Number[]} */ (startLayers[currentCell])[currentLayer];
			let bits = layerMask;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				const { neighbour, empty } = grid.find_neighbour(currentCell, direction);
				if (empty) {
					continue;
				}
				const backId = findBackSubCell(
					grid,
					startLayers,
					neighbour,
					grid.OPPOSITE.get(direction) || 0
				);
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

	// find connected components of keepable sub-cells.
	// layers within a cell never connect to each other,
	// so one cell can host sub-cells of several different components.
	// A component can also hold several sub-cells of one cell
	// (a path through the cell enters/exits via different layers)
	/** @type {Set<Number>} all sub-cells of keepable cells */
	const allSubCells = new Set();
	for (let cell of keepable) {
		const cellLayers = /** @type {Number[]} */ (startLayers[cell]);
		for (let layerIndex = 0; layerIndex < cellLayers.length; layerIndex++) {
			allSubCells.add(grid.subcellId(cell, layerIndex));
		}
	}
	/** @type {Set<Number>[]} sets of sub-cell ids (cell + layer * total) */
	const components = [];
	/** @type {Set<Number>} sub-cells already assigned to a component */
	const seen = new Set();
	for (let id of allSubCells) {
		if (seen.has(id)) {
			continue;
		}
		components.push(collectComponent(id, allSubCells, seen));
	}
	components.sort((a, b) => -(a.size - b.size));

	/**
	 * Builds the layer list of one reused cell: only layers belonging to
	 * the component, each pruned to edges staying within the component.
	 * Layers that lose all connections this way are dropped.
	 * @param {Number} cell
	 * @param {Set<Number>} component
	 * @returns {Number[]}
	 */
	const pruneCellLayers = (cell, component) => {
		const cellLayers = /** @type {Number[]} */ (startLayers[cell]);
		const result = [];
		for (let layerIndex = 0; layerIndex < cellLayers.length; layerIndex++) {
			if (!component.has(grid.subcellId(cell, layerIndex))) {
				continue;
			}
			let mask = cellLayers[layerIndex];
			let bits = mask;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				const { neighbour, empty } = grid.find_neighbour(cell, direction);
				const backId = empty
					? -1
					: findBackSubCell(grid, startLayers, neighbour, grid.OPPOSITE.get(direction) || 0);
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
		keepableSubCells,
		liveCells: 0,
		liveSubCells: 0,
		islandCells: 0,
		islandSubCells: 0,
		conflictIslands: 0,
		conflictWithLive: 0,
		conflictWithIsland: 0,
		conflictLostSubCells: 0,
		conflictMaxIslandSize: 0,
		fragmentLostSubCells: 0,
		tooSmallLostSubCells: 0
	};
	if (live) {
		/** @type {Set<Number>} cells hosting live sub-cells */
		const liveCells = new Set();
		for (let id of live) {
			liveCells.add(grid.cellLayerOf(id)[0]);
		}
		for (let cell of liveCells) {
			const pruned = pruneCellLayers(cell, live);
			if (pruned.length > 0) {
				claimed.add(cell);
				liveClaimed.add(cell);
				cells.set(cell, { role: 'live', layers: pruned });
				stats.liveCells += 1;
				stats.liveSubCells += pruned.length;
			} else {
				cells.set(cell, { role: 'dissolved', layers: [] });
			}
		}
		// a single-sub-cell live component has no internal edges to seed
		stats.tooSmallLostSubCells += live.size - stats.liveSubCells;
	}
	// reuse good smaller regions too, they stay dormant
	// until the growing tree touches them
	// (islands smaller than 2 sub-cells have no internal edges
	// to preserve, so they are never worth registering)
	const minIslandSize = Math.max(2, reuseMinCount);
	for (let index = 1; index < components.length; index++) {
		const component = components[index];
		if (component.size < minIslandSize) {
			// this and all smaller components are too small to reuse
			for (let rest = index; rest < components.length; rest++) {
				stats.tooSmallLostSubCells += components[rest].size;
				for (let id of components[rest]) {
					const cell = grid.cellLayerOf(id)[0];
					if (!cells.has(cell)) {
						cells.set(cell, { role: 'dissolved', layers: [] });
					}
				}
			}
			break;
		}
		/** @type {Set<Number>} cells hosting this island's sub-cells */
		const islandCells = new Set();
		for (let id of component) {
			islandCells.add(grid.cellLayerOf(id)[0]);
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
			/** @type {Set<Number>} sub-cells of this island not at claimed cells */
			const carved = new Set();
			for (let id of component) {
				if (!claimed.has(grid.cellLayerOf(id)[0])) {
					carved.add(id);
				}
			}
			stats.conflictLostSubCells += component.size - carved.size;
			pieces = [];
			/** @type {Set<Number>} sub-cells already assigned to a piece */
			const piecesSeen = new Set();
			for (let id of carved) {
				if (!piecesSeen.has(id)) {
					pieces.push(collectComponent(id, carved, piecesSeen));
				}
			}
			// pieces are sub-cell connected, but one component can hold
			// several sub-cells of one cell (paths through the cell), so
			// pieces can share cells. Registered pieces must own cells
			// exclusively: a piece sharing a cell with an already
			// registered (bigger) piece dissolves into fragments
			pieces.sort((a, b) => -(a.size - b.size));
		}
		/** @type {Set<Number>} cells claimed by this component's registered pieces */
		const pieceClaims = new Set();
		for (let piece of pieces) {
			if (piece.size < minIslandSize) {
				stats.fragmentLostSubCells += piece.size;
				for (let id of piece) {
					const cell = grid.cellLayerOf(id)[0];
					if (!cells.has(cell)) {
						cells.set(cell, { role: 'dissolved', layers: [] });
					}
				}
				continue;
			}
			/** @type {Set<Number>} cells hosting this piece's sub-cells */
			const pieceCells = new Set();
			for (let id of piece) {
				pieceCells.add(grid.cellLayerOf(id)[0]);
			}
			let pieceConflict = false;
			for (let cell of pieceCells) {
				if (pieceClaims.has(cell)) {
					pieceConflict = true;
					break;
				}
			}
			if (pieceConflict) {
				stats.fragmentLostSubCells += piece.size;
				for (let id of piece) {
					const cell = grid.cellLayerOf(id)[0];
					if (!cells.has(cell)) {
						cells.set(cell, { role: 'dissolved', layers: [] });
					}
				}
				continue;
			}
			stats.islandCells += pieceCells.size;
			stats.islandSubCells += piece.size;
			for (let cell of pieceCells) {
				pieceClaims.add(cell);
				claimed.add(cell);
				cells.set(cell, { role: 'island', layers: pruneCellLayers(cell, piece) });
				islands.set(cell, pieceCells);
			}
		}
	}
	return { cells, islands, stats };
}

/**
 * A pregeneration growth event, see pregenerate_layers.
 * seed/move/merge mirror the board mutations exactly, demote/pop are
 * frontier bookkeeping without board effects; erase/absorb are handled by
 * the replay helpers and the debug page but currently never emitted
 * @typedef {{type: 'seed', cell: Number, role: String, layers: Number[]}|
 * {type: 'erase', cell: Number}|
 * {type: 'move', fromNode: Number, layerIndex: Number, direction: Number, neighbour: Number}|
 * {type: 'merge', fromNode: Number, layerIndex: Number, direction: Number, neighbour: Number, neighbourLayerIndex: Number}|
 * {type: 'absorb', fromNode: Number, layerIndex: Number, direction: Number, neighbour: Number, islandCells: Number[]}|
 * {type: 'demote', fromNode: Number, tier: String}|
 * {type: 'pop', fromNode: Number}} GrowthMove
 */

/**
 * Frontier lists of one subtree split by growth kind, holding sub-cell ids
 * (cell + layer * total): each entry's kind is its own layer's degree. A
 * reused component can host several sub-cells per cell (through-paths), so
 * entries — not cells — are the frontier unit. `cells` is the set of cells
 * the subtree occupies, for the own-tree move check
 * @typedef {{extending: Number[], branching: Number[], lastResort: Number[], cells: Set<Number>}} Subtree
 */

/**
 * A connection joining two subtrees grown by pregenerate_layers_multitree
 * @typedef {{fromNode: Number, layerIndex: Number, direction: Number, neighbour: Number, neighbourLayerIndex: Number}} MergeCandidate
 */

/**
 * Fills a grid with layered tiles by growing trees of sub-cells
 * Every cell can hold several independent layers (up to one per direction),
 * layers within a cell never connect to each other.
 * A direction can be used by at most one layer of a cell.
 * The result is always a single spanning tree over all sub-cells.
 * Fresh boards grow `min(playable, max(3, floor(total / 50)))` subtrees
 * simultaneously and merge them at the end (see
 * pregenerate_layers_attempt). Boards with reusable startLayers grow their
 * reused components as subtrees among them (see planReuse): the components
 * keep their certified internal structure and simply keep growing, and the
 * merge phase connects everything into one tree.
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {Number} layeringAmount - probability of growing into an already
 * occupied cell, values in range [0,1], 0 produces classic puzzles.
 * @param {Number} branchingAmount - value in range [0, 1], low values grow
 * by extending deadend sub-cells (long corridor-like paths), high values grow
 * by branching busy sub-cells (Prim-like spread over the board)
 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders.
 * Not applied by this growth.
 * @param {StartLayers} startLayers - solved layers of non-ambiguous cells, null for cells to regenerate.
 * Reusable regions become growing subtrees.
 * @param {Number} reuseMinCount - minimum count of sub-cells to leave dormant when erasing ambiguities
 * @param {(move: GrowthMove) => void} [onMove] - reports growth events for animations,
 * each board mutation is mirrored by an event
 * @returns {LayeredTiles} - unrandomized layered tiles
 */
export function pregenerate_layers(
	grid,
	layeringAmount = 0.6,
	branchingAmount = 0.5,
	avoidObvious = 0,
	startLayers = [],
	reuseMinCount = 3,
	onMove = undefined
) {
	// only the successful attempt's events are reported, so replays of the
	// event stream mirror the returned board exactly
	/** @type {GrowthMove[]} */
	const attemptMoves = [];
	for (let attempt = 0; ; attempt++) {
		try {
			const tiles = pregenerate_layers_attempt(
				grid,
				layeringAmount,
				branchingAmount,
				startLayers,
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
 * Runs one growth attempt, see pregenerate_layers. Reusable startLayers
 * components become growing subtrees, fresh ones are seeded until the
 * size-based subtree count is reached. Throws when the growth stalls or
 * the subtrees cannot be merged
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {Number} layeringAmount
 * @param {Number} branchingAmount
 * @param {StartLayers} startLayers
 * @param {Number} reuseMinCount
 * @param {GrowthMove[]} attemptMoves - collects the attempt's growth events
 * @returns {LayeredTiles} - unrandomized layered tiles
 */
function pregenerate_layers_attempt(
	grid,
	layeringAmount,
	branchingAmount,
	startLayers,
	reuseMinCount,
	attemptMoves
) {
	const total = grid.total;

	/** @type {LayeredTiles} */
	const layers = [];
	for (let i = 0; i < total; i++) {
		layers.push([]);
	}

	/** @type {Set<Number>} A set of unvisited cells */
	const unvisited = new Set([...Array(total).keys()]);
	for (let index of grid.emptyCells) {
		unvisited.delete(index);
	}
	if (unvisited.size === 0) {
		return layers;
	}

	const emit = /** @param {GrowthMove} move */ (move) => {
		attemptMoves.push(move);
	};
	const opposite = grid.OPPOSITE;
	const checkFullyConnected = grid.KIND !== 'triangular';

	/** @type {Subtree[]} */
	const trees = [];

	/** @type {Map<Number, Number[]>} cell index => owning subtree ids, aligned with layers[cell] */
	const owners = new Map();

	/**
	 * Syncs a sub-cell's primary frontier memberships within one subtree:
	 * the kind of the sub-cell's own layer decides between extending and
	 * branching. Only called for sub-cells the subtree may grow from.
	 * @param {Subtree} tree
	 * @param {Number} subCell
	 */
	const syncTreeFrontier = (tree, subCell) => {
		const [cell, layerIndex] = grid.cellLayerOf(subCell);
		const wantsExtend = popcount(layers[cell][layerIndex]) <= 1;
		syncFrontierList(tree.extending, subCell, wantsExtend);
		syncFrontierList(tree.branching, subCell, !wantsExtend);
	};

	/**
	 * Removes a sub-cell from all of one subtree's frontier lists
	 * @param {Subtree} tree
	 * @param {Number} subCell
	 */
	const removeFromTreeFrontier = (tree, subCell) => {
		syncFrontierList(tree.extending, subCell, false);
		syncFrontierList(tree.branching, subCell, false);
		syncFrontierList(tree.lastResort, subCell, false);
	};

	/**
	 * Counts the cell's free directions that lead to an in-board neighbour.
	 * Only these can host merge connections later, off-board spares seal a
	 * cell (and its subtrees) away from the merging phase entirely
	 * @param {Number} cell
	 * @returns {Number}
	 */
	const inBoardFreeDirections = (cell) => {
		const polygon = grid.polygon_at(cell);
		const used = usedDirections(layers[cell]);
		let count = 0;
		for (let direction of polygon.directions) {
			if ((used & direction) === 0 && !grid.find_neighbour(cell, direction).empty) {
				count += 1;
			}
		}
		return count;
	};

	/**
	 * Applies one growth move: extends the subtree's layer at the source
	 * sub-cell and pushes a fresh layer at the neighbour cell (fresh or
	 * occupied alike, that is always a new sub-cell for this subtree)
	 * @param {Subtree} tree
	 * @param {Number} treeIndex
	 * @param {Number} fromSubCell
	 * @param {Number} direction
	 * @param {Number} neighbour
	 * @param {boolean} syncSource - whether the source sub-cell's frontier
	 * kind should be re-synced (demoted tier cells are left alone)
	 */
	const applyMove = (tree, treeIndex, fromSubCell, direction, neighbour, syncSource) => {
		// the direction is free for every layer of the cell
		const [fromNode, layerIndex] = grid.cellLayerOf(fromSubCell);
		layers[fromNode][layerIndex] |= direction;
		if (syncSource) {
			syncTreeFrontier(tree, fromSubCell);
		}
		layers[neighbour].push(opposite.get(direction) || 0);
		const fresh = unvisited.has(neighbour);
		if (fresh) {
			unvisited.delete(neighbour);
		}
		tree.cells.add(neighbour);
		syncTreeFrontier(tree, grid.subcellId(neighbour, layers[neighbour].length - 1));
		const neighbourOwners = owners.get(neighbour);
		if (neighbourOwners) {
			neighbourOwners.push(treeIndex);
		} else {
			owners.set(neighbour, [treeIndex]);
		}
		emit({ type: 'move', fromNode, layerIndex, direction, neighbour });
	};

	/**
	 * Makes one growth move for a subtree: picks a frontier sub-cell by the
	 * rolled growth kind, then a random valid direction of its cell.
	 * Sub-cells whose every remaining move makes a fully-connected union
	 * are demoted to the subtree's lastResort tier (if another primary
	 * sub-cell can be tried instead); sub-cells without any remaining move
	 * leave the frontier.
	 * @param {Subtree} tree
	 * @param {Number} treeIndex
	 * @returns {boolean} whether a move was made
	 */
	const growTree = (tree, treeIndex) => {
		for (;;) {
			// roll which kind of growth to use: extending a deadend sub-cell
			// (corridor-like) or branching a busy one (Prim-like spread)
			const useBranch = Math.random() < branchingAmount;
			const tiers = useBranch
				? [tree.branching, tree.extending, tree.lastResort]
				: [tree.extending, tree.branching, tree.lastResort];
			let sourceList = tree.lastResort;
			let fromSubCell = -1;
			for (let nodes of tiers) {
				if (nodes.length === 0) {
					continue;
				}
				sourceList = nodes;
				fromSubCell = getRandomElement(nodes);
				break;
			}
			if (fromSubCell === -1) {
				return false;
			}
			const fromPrimary = sourceList !== tree.lastResort;
			const fromNode = grid.cellLayerOf(fromSubCell)[0];

			const polygon = grid.polygon_at(fromNode);
			const used = usedDirections(layers[fromNode]);
			// a mixed cell (several subtrees share it) must keep a spare
			// in-board free direction for the final merge connections —
			// but expanding into unvisited cells stays always allowed,
			// otherwise mixed cells could wall off unvisited pockets
			const mixedSource = new Set(/** @type {Number[]} */ (owners.get(fromNode))).size > 1;
			const sourceSpares = mixedSource ? inBoardFreeDirections(fromNode) : 2;

			/** @type {{direction: Number, neighbour: Number}[]} */
			const moves = [];
			/** @type {{direction: Number, neighbour: Number}[]} */
			const fullyConnectedMoves = [];
			for (let direction of polygon.directions) {
				if ((used & direction) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.find_neighbour(fromNode, direction);
				if (empty) {
					continue;
				}
				if (tree.cells.has(neighbour)) {
					// own subtree: connecting would close a cycle
					continue;
				}
				const backDirection = opposite.get(direction) || 0;
				const neighbourUsed = usedDirections(layers[neighbour]);
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
					if (Math.random() > layeringAmount) {
						continue;
					}
				}
				if ((neighbourUsed & backDirection) > 0) {
					throw 'Error in layered pregeneration: neighbour already connects back';
				}
				const fullyConnected =
					checkFullyConnected &&
					((used | direction) === polygon.fully_connected ||
						(neighbourUsed | backDirection) === grid.polygon_at(neighbour).fully_connected);
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
				// no usable moves left, remove the sub-cell from the frontier
				emit({ type: 'pop', fromNode });
				removeFromTreeFrontier(tree, fromSubCell);
				continue;
			}
			// demotion needs another primary sub-cell to try instead,
			// otherwise the only frontier entry would just demote instead of
			// moving on
			if (
				fromPrimary &&
				bestMoves === fullyConnectedMoves &&
				tree.extending.length + tree.branching.length > 1
			) {
				// wants to make a fully connected union, try other cells first
				emit({ type: 'demote', fromNode, tier: 'lastResort' });
				syncFrontierList(sourceList, fromSubCell, false);
				tree.lastResort.push(fromSubCell);
				continue;
			}

			const { direction, neighbour } = getRandomElement(bestMoves);
			applyMove(tree, treeIndex, fromSubCell, direction, neighbour, fromPrimary);
			return true;
		}
	};

	// reused startLayers components become the first subtrees: their cells
	// and layers are claimed up front (pruned to intra-component edges by
	// planReuse), each sub-cell joins its component's frontier, and the
	// component keeps growing like any freshly seeded one
	if (startLayers.length === total) {
		const plan = planReuse(grid, startLayers, reuseMinCount);
		/** @type {Map<Set<Number>, Number[]>} island piece cell set => piece cells */
		const islandGroups = new Map();
		for (let [cell, cellPlan] of plan.cells) {
			if (cellPlan.role === 'island') {
				const piece = /** @type {Set<Number>} */ (plan.islands.get(cell));
				const group = islandGroups.get(piece);
				if (group) {
					group.push(cell);
				} else {
					islandGroups.set(piece, [cell]);
				}
			}
		}
		/** @type {Number[][]} cell groups per reused component, live first */
		const reusedGroups = [[]];
		for (let [cell, cellPlan] of plan.cells) {
			if (cellPlan.role === 'live') {
				reusedGroups[0].push(cell);
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
			for (let cell of group) {
				const cellPlan = /** @type {{role: String, layers: Number[]}} */ (plan.cells.get(cell));
				layers[cell] = cellPlan.layers;
				owners.set(
					cell,
					cellPlan.layers.map(() => treeIndex)
				);
				unvisited.delete(cell);
				tree.cells.add(cell);
				for (let layerIndex = 0; layerIndex < cellPlan.layers.length; layerIndex++) {
					syncTreeFrontier(tree, grid.subcellId(cell, layerIndex));
				}
				// the event must snapshot the layers: the board keeps the
				// cellPlan array and later pushes would mutate a shared payload
				emit({ type: 'seed', cell, role: cellPlan.role, layers: [...cellPlan.layers] });
			}
		}
	}

	// fresh subtrees top the count up: three on small boards, one more per
	// 50 tiles, seeded on distinct random unvisited cells
	const freshCount = Math.min(Math.max(0, subtreeCountFor(total) - trees.length), unvisited.size);
	const freshStart = trees.length;
	/** @type {Number[]} seed sub-cell per fresh subtree */
	const seedCells = [];
	{
		/** @type {Number[]} */
		const playable = [...unvisited];
		for (let i = 0; i < freshCount; i++) {
			const pick = i + Math.floor(Math.random() * (playable.length - i));
			[playable[i], playable[pick]] = [playable[pick], playable[i]];
			const cell = playable[i];
			unvisited.delete(cell);
			layers[cell].push(0);
			const treeIndex = trees.length;
			/** @type {Subtree} */
			const tree = { extending: [], branching: [], lastResort: [], cells: new Set() };
			trees.push(tree);
			tree.cells.add(cell);
			const seedId = grid.subcellId(cell, 0);
			syncTreeFrontier(tree, seedId);
			owners.set(cell, [treeIndex]);
			seedCells.push(seedId);
			emit({ type: 'seed', cell, role: 'start', layers: [0] });
		}
	}

	// opening round: every fresh subtree gets one forced expansion into an
	// unvisited cell, so none can lose the opening race and sit out the
	// whole game as a never-grown mask-0 seed that is easily sealed off
	// from all merge connections by its busy co-tenants. Targets are
	// unvisited only (ungated), so layeringAmount 0 keeps its meaning
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
			const cell = grid.cellLayerOf(seedId)[0];
			/** @type {Number[]} */
			const directions = [];
			for (let direction of grid.polygon_at(cell).directions) {
				const { neighbour, empty } = grid.find_neighbour(cell, direction);
				if (!empty && unvisited.has(neighbour)) {
					directions.push(direction);
				}
			}
			if (directions.length > 0) {
				const direction = /** @type {Number} */ (getRandomElement(directions));
				const neighbour = /** @type {Number} */ (grid.find_neighbour(cell, direction).neighbour);
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
			throw 'Error in layered pregeneration: no subtree can grow while unvisited cells remain';
		}
		const treeIndex = getRandomElement(growing);
		if (!growTree(trees[treeIndex], treeIndex)) {
			alive[treeIndex] = false;
		}
	}

	// join the subtrees into one tree over all sub-cells: connect cells of
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
			/** @type {Number[]} */ (owners.get(candidate.fromNode))[candidate.layerIndex]
		);
		const rootB = find(
			/** @type {Number[]} */ (owners.get(candidate.neighbour))[candidate.neighbourLayerIndex]
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
			const used = usedDirections(layers[cell]);
			const polygon = grid.polygon_at(cell);
			for (let direction of polygon.directions) {
				if ((used & direction) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.find_neighbour(cell, direction);
				if (empty) {
					continue;
				}
				if (
					(cell === candidate.fromNode && neighbour === candidate.neighbour) ||
					(cell === candidate.neighbour && neighbour === candidate.fromNode)
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
			const used = usedDirections(layers[cell]);
			const polygon = grid.polygon_at(cell);
			for (let direction of polygon.directions) {
				if ((used & direction) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.find_neighbour(cell, direction);
				if (empty) {
					continue;
				}
				const neighbourOwners = /** @type {Number[]} */ (owners.get(neighbour));
				const neighbourUsed = usedDirections(layers[neighbour]);
				const neighbourFullyConnected = grid.polygon_at(neighbour).fully_connected;
				const backDirection = opposite.get(direction) || 0;
				for (let layerIndex = 0; layerIndex < cellOwners.length; layerIndex++) {
					for (
						let neighbourLayerIndex = 0;
						neighbourLayerIndex < neighbourOwners.length;
						neighbourLayerIndex++
					) {
						if (find(cellOwners[layerIndex]) === find(neighbourOwners[neighbourLayerIndex])) {
							// same component already, connecting would close a loop
							continue;
						}
						const candidate = {
							fromNode: cell,
							layerIndex,
							direction,
							neighbour,
							neighbourLayerIndex
						};
						// a fully connected union is a last resort, as during growth
						const fullyConnected =
							checkFullyConnected &&
							((used | direction) === polygon.fully_connected ||
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
				const index = Math.floor(Math.random() * list.length);
				const candidate = /** @type {MergeCandidate} */ (list[index]);
				if (mergesLeft === 1 || mergeKeepsComponentsConnected(candidate)) {
					chosen = candidate;
				} else {
					list.splice(index, 1);
				}
			}
			if (chosen !== undefined) {
				break;
			}
		}
		if (chosen === undefined) {
			throw 'Error in layered pregeneration: no merge connection found while subtrees remain';
		}
		const merge = chosen;
		layers[merge.fromNode][merge.layerIndex] |= merge.direction;
		layers[merge.neighbour][merge.neighbourLayerIndex] |= opposite.get(merge.direction) || 0;
		const sourceTree = /** @type {Number[]} */ (owners.get(merge.fromNode))[merge.layerIndex];
		const neighbourTree = /** @type {Number[]} */ (owners.get(merge.neighbour))[
			merge.neighbourLayerIndex
		];
		parent[find(sourceTree)] = find(neighbourTree);
		emit({
			type: 'merge',
			fromNode: merge.fromNode,
			layerIndex: merge.layerIndex,
			direction: merge.direction,
			neighbour: merge.neighbour,
			neighbourLayerIndex: merge.neighbourLayerIndex
		});
	}
	return layers;
}

/**
 * Randomize rotations of layered tiles,
 * all layers of a cell rotate by the same random amount
 * @param {LayeredTiles} layers
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @returns {LayeredTiles}
 */
export function randomRotate(layers, grid) {
	return layers.map((cellLayers, index) => {
		if (cellLayers.length === 0) {
			return [];
		}
		const polygon = grid.polygon_at(index);
		const rotations = Math.floor(Math.random() * polygon.num_directions);
		return cellLayers.map((layer) => polygon.rotate(layer, rotations));
	});
}

/**
 * Applies solved rotations to layered tiles,
 * all layers of a cell rotate by the same amount.
 * Solver sentinel rotations (negative numbers) count as no rotation
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {LayeredTiles} layers
 * @param {Number[]} rotations - rotation per cell
 * @returns {LayeredTiles}
 */
export function applyRotations(grid, layers, rotations) {
	return layers.map((cellLayers, index) => {
		if (cellLayers.length === 0) {
			return [];
		}
		const rotation = rotations[index];
		const amount = typeof rotation === 'number' && rotation > 0 ? rotation : 0;
		const polygon = grid.polygon_at(index);
		return cellLayers.map((layer) => polygon.rotate(layer, amount));
	});
}

/**
 * Prepares a solved board for reuse in pregenerate_layers:
 * cells whose marked rotation is a solver sentinel (ambiguous or unresolved)
 * become null, other cells get their layers rotated to the solver's frame
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {LayeredTiles} layers - solved layered tiles
 * @param {Number[]} marked - rotation per cell, possibly with sentinel values
 * @returns {StartLayers}
 */
export function buildStartLayers(grid, layers, marked) {
	return layers.map((cellLayers, index) => {
		const rotation = marked[index];
		if (cellLayers.length === 0 || typeof rotation !== 'number' || rotation < 0) {
			return null;
		}
		const polygon = grid.polygon_at(index);
		return cellLayers.map((layer) => polygon.rotate(layer, rotation));
	});
}

const emptyCallback = (/**@type {GeneratorProgress} */ progress) => {};

/**
 * Snapshot of one uniqueness iteration, see LayeredGenerator.uniqueIterations
 * @typedef {object} IterationSnapshot
 * @property {Number} attempt
 * @property {Number} iteration
 * @property {LayeredTiles} tiles - the freshly generated (unscrambled) board
 * @property {Number[]} marked - solver-frame rotations per cell, AMBIGUOUS/UNSOLVED sentinels for bad cells
 * @property {Number} numAmbiguous
 * @property {boolean} unique - the search finished and found a unique solution
 * @property {Number} keptCount - cells this board reused from the previous iteration
 * @property {Number} elapsedMs - time spent in the solver for this iteration
 */

/**
 * Generates layered puzzles. Mirrors the classic Generator:
 * for a unique solution it repeatedly re-pregenerates the board while
 * reusing non-ambiguous portions of the previous attempt
 * (see pregenerate_layers) and only regrowing the ambiguous parts.
 */
export class LayeredGenerator {
	/**
	 * @constructor
	 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 * @param {Number} [reuse_tiles_min_count = 3] minimum count of connected sub-cells to leave dormant when erasing ambiguities
	 * @param {Number} [uniqueness_patience = 5] abandon generation attempt if the count of ambiguous cells did not decrease in this many iterations
	 * @param {Number} [max_attempts = 100] abandon generation if no attempt produced a unique puzzle
	 * @param {Number} [max_uniqueness_iterations = 100] abandon an attempt after this many uniqueness iterations
	 * @param {(progress: import('$lib/puzzle/solver-layers').SolverProgress) => void} [solver_progress_callback] reports solver progress
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
	 * non-sentinel `marked` cells are the ones the solver certified,
	 * they feed the next iteration as reused `startLayers` (and are
	 * reported as this board's `keptCount`).
	 * Stops after yielding a unique snapshot, or when the attempts
	 * are exhausted.
	 * @param {Number} layeringAmount - probability of growing into a visited cell again, values in range [0,1]
	 * 0 produces classic puzzles.
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {Number} [ambiguousLimitOverride = 0] - cap on ambiguities searched per iteration,
	 * 0 means the default max(100, 0.1 * total). A limit >= total marks every ambiguity
	 * and lets the patience tracking work on the true counts.
	 * @returns {Generator<IterationSnapshot, void, void>}
	 */
	*uniqueIterations(
		layeringAmount = 0.6,
		branchingAmount = 0.6,
		avoidObvious = 0.0,
		ambiguousLimitOverride = 0
	) {
		/** @type {StartLayers} */
		let startLayers = [];
		let attempt = 0;
		const ambiguousLimit =
			ambiguousLimitOverride > 0 ? ambiguousLimitOverride : Math.max(100, 0.1 * this.grid.total); // don't look for more ambiguous tiles than this
		while (attempt < this.max_attempts) {
			attempt += 1;
			let tiles = pregenerate_layers(
				this.grid,
				layeringAmount,
				branchingAmount,
				avoidObvious,
				startLayers,
				this.reuse_tiles_min_count
			);
			let iteration = 0;
			let patienceLeft = this.uniqueness_patience;
			let ambiguous = this.grid.total;
			while (iteration < this.max_uniqueness_iterations) {
				iteration += 1;
				const started = performance.now();
				this.generator_progress_callback({ attempt, iteration });
				const solver = new LayeredSolver(tiles, this.grid);
				if (this.solver_progress_callback) {
					solver.progress_callback = this.solver_progress_callback;
				}
				const { solvable, marked, unique, numAmbiguous } = solver.markAmbiguousTiles(
					Math.min(ambiguous, ambiguousLimit)
				);
				const elapsedMs = performance.now() - started;
				if (!solvable) {
					throw 'Pregeneration returned an unsolvable puzzle';
				}
				const keptCount = startLayers.reduce((n, cellLayers) => (cellLayers ? n + 1 : n), 0);
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
					startLayers = buildStartLayers(this.grid, tiles, marked);
				} else if (numAmbiguous >= ambiguous) {
					patienceLeft -= 1;
				} else {
					ambiguous = numAmbiguous;
					patienceLeft = this.uniqueness_patience;
					startLayers = buildStartLayers(this.grid, tiles, marked);
				}
				yield snapshot;
				if (patienceLeft === 0) {
					break;
				}
				tiles = pregenerate_layers(
					this.grid,
					layeringAmount,
					branchingAmount,
					avoidObvious,
					startLayers,
					this.reuse_tiles_min_count
				);
			}
		}
	}

	/**
	 * Generate a puzzle according to settings
	 * @param {Number} layeringAmount - probability of growing into a visited cell again, values in range [0,1]
	 * 0 produces classic puzzles.
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {SolutionsNumber} solutionsNumber - unique/multiple solutions or disable this check
	 * @returns {LayeredTiles} - generated tiles
	 */
	generate(
		layeringAmount = 0.6,
		branchingAmount = 0.6,
		avoidObvious = 0.0,
		solutionsNumber = 'unique'
	) {
		if (solutionsNumber === 'unique') {
			for (const step of this.uniqueIterations(layeringAmount, branchingAmount, avoidObvious)) {
				if (step.unique) {
					return randomRotate(applyRotations(this.grid, step.tiles, step.marked), this.grid);
				}
			}
			throw 'Could not generate a layered puzzle with a unique solution. Maybe try again.';
		} else if (solutionsNumber === 'whatever') {
			const tiles = pregenerate_layers(this.grid, layeringAmount, branchingAmount, avoidObvious);
			return randomRotate(tiles, this.grid);
		} else if (solutionsNumber === 'multiple') {
			let attempt = 0;
			while (attempt < this.max_attempts) {
				attempt += 1;
				this.generator_progress_callback({ attempt, iteration: 1 });
				const tiles = pregenerate_layers(this.grid, layeringAmount, branchingAmount, avoidObvious);
				const solver = new LayeredSolver(tiles, this.grid);
				if (this.solver_progress_callback) {
					solver.progress_callback = this.solver_progress_callback;
				}
				const { unique } = solver.markAmbiguousTiles(1);
				if (!unique) {
					return randomRotate(tiles, this.grid);
				}
			}
			throw `Could not generate a layered puzzle with multiple solutions in ${this.max_attempts} attempts. Maybe try again.`;
		} else {
			throw 'Unknown setting for solutionsNumber';
		}
	}
}

/**
 * Checks that layered tiles form a valid layered puzzle network
 * Throws an Error when a rule is broken
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {LayeredTiles} layers
 */
export function validateLayers(grid, layers) {
	const total = grid.total;
	const playable = total - grid.emptyCells.size;
	/** @type {Map<String, String[]>} adjacency between sub-cells */
	const adjacency = new Map();
	/** @type {(cell: Number, layer: Number) => String} */
	const key = (cell, layer) => `${cell}_${layer}`;
	let subCells = 0;
	let connectionEnds = 0;
	let first = null;

	for (let index = 0; index < total; index++) {
		const cellLayers = layers[index];
		if (grid.emptyCells.has(index)) {
			if (cellLayers.length > 0) {
				throw new Error(`Cell ${index} is empty but has layers`);
			}
			continue;
		}
		if (cellLayers.length === 0 && playable > 1) {
			throw new Error(`Cell ${index} has no layers`);
		}
		const polygon = grid.polygon_at(index);
		const used = usedDirections(cellLayers);
		const xored = cellLayers.reduce((a, b) => a ^ b, 0);
		if (used !== xored) {
			throw new Error(`Cell ${index} uses a direction in more than one layer`);
		}
		for (let layerIndex = 0; layerIndex < cellLayers.length; layerIndex++) {
			const layer = cellLayers[layerIndex];
			if (layer === 0) {
				throw new Error(`Cell ${index} layer ${layerIndex} has no connections`);
			}
			if ((layer | polygon.fully_connected) !== polygon.fully_connected) {
				throw new Error(`Cell ${index} layer ${layerIndex} has invalid direction bits`);
			}
			const from = key(index, layerIndex);
			adjacency.set(from, []);
			if (first === null) {
				first = from;
			}
			subCells += 1;
			let bits = layer;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				connectionEnds += 1;
				const { neighbour, empty } = grid.find_neighbour(index, direction);
				if (empty || neighbour < 0) {
					throw new Error(`Cell ${index} connects outside the board in direction ${direction}`);
				}
				const opposite = grid.OPPOSITE.get(direction) || 0;
				const neighbourLayers = layers[neighbour];
				let matched = -1;
				for (let j = 0; j < neighbourLayers.length; j++) {
					if ((neighbourLayers[j] & opposite) > 0) {
						matched = j;
						break;
					}
				}
				if (matched === -1) {
					throw new Error(
						`Cell ${index} direction ${direction} has no matching connection at cell ${neighbour}`
					);
				}
				adjacency.get(from).push(key(neighbour, matched));
			}
		}
	}

	if (connectionEnds !== 2 * (subCells - 1)) {
		throw new Error(
			`Sub-cell graph is not a tree: ${subCells} sub-cells have ${connectionEnds / 2} connections`
		);
	}
	if (subCells === 0) {
		return;
	}
	const seen = new Set([first]);
	const queue = [first];
	while (queue.length > 0) {
		const current = queue.pop();
		for (let next of adjacency.get(current) || []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	if (seen.size !== subCells) {
		throw new Error(`Sub-cell graph is disconnected: reached ${seen.size} of ${subCells}`);
	}
}
