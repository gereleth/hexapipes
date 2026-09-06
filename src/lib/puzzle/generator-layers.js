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
			return cell + layerIndex * grid.total;
		}
	}
	return -1;
}

/**
 * Fills a grid with layered tiles using GrowingTree algorithm
 * Every cell can hold several independent layers (up to one per direction),
 * layers within a cell never connect to each other.
 * A direction can be used by at most one layer of a cell.
 * Growing into an already visited cell adds a new layer there,
 * so the graph of sub-cells (cell + layer) always stays a tree.
 * Moves that would make any tile's layers union fully connected are a last resort.
 * Moves that would make a border tile's layers union an obvious
 * (orientation forced by the border walls) shape are demoted too.
 * Non-null startLayers regions of connected keepable cells are reused
 * verbatim (pruned to their internal edges): the largest one seeds the
 * growing tree, smaller ones stay dormant as islands until the tree grows
 * into them and absorbs them with a single connection. Layers of reused
 * components that end up without connections (e.g. they only connected
 * to ambiguous cells) are dropped.
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {Number} branchingAmount - value in range [0, 1],
 * 0 is like recursive backtracking, 1 is like Prim's algorithm
 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
 * @param {StartLayers} startLayers - solved layers of non-ambiguous cells, null for cells to regenerate
 * @param {Number} reuseMinCount - minimum count of sub-cells to leave dormant when erasing ambiguities
 * @returns {LayeredTiles} - unrandomized layered tiles
 */
export function pregenerate_layers(
	grid,
	branchingAmount = 0.5,
	avoidObvious = 0,
	startLayers = [],
	reuseMinCount = 3
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

	/** @type {Number[]} cells that still have free directions */
	const visited = [];
	/** @type {Number[]} cells whose only remaining moves make some tile's layers union an obvious shape */
	const avoiding = [];
	/** @type {Number[]} cells whose only remaining moves make some tile's layers union fully connected */
	const lastResort = [];

	/** @type {Map<Number, Set<Number>>} cell index => cells of the dormant island containing it */
	const islands = new Map();

	// reuse non-ambiguous portions of startLayers
	if (startLayers.length === total) {
		/** @type {Set<Number>} playable cells worth keeping */
		const keepable = new Set();
		for (let index of unvisited) {
			if (startLayers[index]) {
				keepable.add(index);
			}
		}
		// find connected components of keepable sub-cells.
		// layers within a cell never connect to each other,
		// so one cell can host sub-cells of several different components
		/** @type {Set<Number>[]} sets of sub-cell ids (cell + layer * total) */
		const components = [];
		/** @type {Set<Number>} sub-cells already assigned to a component */
		const seen = new Set();
		for (let cell of keepable) {
			const cellLayers = /** @type {Number[]} */ (startLayers[cell]);
			for (let layerIndex = 0; layerIndex < cellLayers.length; layerIndex++) {
				const id = cell + layerIndex * total;
				if (seen.has(id)) {
					continue;
				}
				const component = new Set([id]);
				seen.add(id);
				const queue = [id];
				while (queue.length > 0) {
					const current = /** @type {Number} */ (queue.pop());
					const currentCell = current % total;
					const layerMask = /** @type {Number[]} */ (startLayers[currentCell])[
						Math.floor(current / total)
					];
					let bits = layerMask;
					while (bits > 0) {
						const direction = bits & -bits;
						bits ^= direction;
						const { neighbour, empty } = grid.find_neighbour(currentCell, direction);
						if (empty || !keepable.has(neighbour)) {
							continue;
						}
						const backId = findBackSubCell(
							grid,
							startLayers,
							neighbour,
							grid.OPPOSITE.get(direction) || 0
						);
						if (backId < 0 || component.has(backId)) {
							continue;
						}
						component.add(backId);
						seen.add(backId);
						queue.push(backId);
					}
				}
				components.push(component);
			}
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
				if (!component.has(cell + layerIndex * total)) {
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
		// the largest component seeds the growing tree
		const live = components[0];
		if (live) {
			/** @type {Set<Number>} cells hosting live sub-cells */
			const liveCells = new Set();
			for (let id of live) {
				liveCells.add(id % total);
			}
			for (let cell of liveCells) {
				const pruned = pruneCellLayers(cell, live);
				if (pruned.length > 0) {
					claimed.add(cell);
					layers[cell] = pruned;
					visited.push(cell);
					unvisited.delete(cell);
				}
			}
		}
		// reuse good smaller regions too, they stay dormant
		// until the growing tree touches them
		// (islands smaller than 2 sub-cells have no internal edges
		// to preserve, so they are never worth registering)
		const minIslandSize = Math.max(2, reuseMinCount);
		for (let component of components.slice(1)) {
			if (component.size < minIslandSize) {
				break;
			}
			/** @type {Set<Number>} cells hosting this island's sub-cells */
			const islandCells = new Set();
			for (let id of component) {
				islandCells.add(id % total);
			}
			let conflict = false;
			for (let cell of islandCells) {
				if (claimed.has(cell)) {
					// the island would mix with another reused component
					// at this cell, dissolve it entirely
					conflict = true;
					break;
				}
			}
			if (conflict) {
				continue;
			}
			for (let cell of islandCells) {
				claimed.add(cell);
				layers[cell] = pruneCellLayers(cell, component);
				islands.set(cell, islandCells);
			}
		}
	}

	/** @type {Map<Number, Set<Number>>} tile index => forbidden union masks */
	const tileForbidden = new Map();
	if (avoidObvious > 0) {
		/** @type {Map<import('$lib/puzzle/grids/polygonutils').RegularPolygonTile, Map<Number, Set<Number>>>}
		 * polygon => (tile walls => set of forbidden types-orientations) */
		const polygonForbidden = new Map();
		for (let tileIndex of unvisited) {
			const polygon = grid.polygon_at(tileIndex);
			let walls = 0;
			for (let direction of polygon.directions) {
				const { empty } = grid.find_neighbour(tileIndex, direction);
				if (empty) {
					walls += direction;
				}
			}
			if (walls === 0) {
				continue;
			}
			const forbidden = polygonForbidden.get(polygon) || new Map();
			if (!polygonForbidden.has(polygon)) {
				polygonForbidden.set(polygon, forbidden);
			}
			let wallForbidden = forbidden.get(walls);
			if (!wallForbidden) {
				wallForbidden = new Set();
				forbidden.set(walls, wallForbidden);
				/** @type {Map<String, Number[]>} shape string => orientations respecting the walls */
				const orientationsByShape = new Map();
				for (let orientation of polygon.tileTypes.keys()) {
					if ((orientation & walls) > 0) {
						continue;
					}
					const str = polygon.tileTypes.get(orientation)?.str || '';
					const orientations = orientationsByShape.get(str) || [];
					if (orientations.length === 0) {
						orientationsByShape.set(str, orientations);
					}
					orientations.push(orientation);
				}
				for (let orientations of orientationsByShape.values()) {
					if (orientations.length === 1) {
						wallForbidden.add(orientations[0]);
					}
				}
			}
			if (wallForbidden.size > 0) {
				tileForbidden.set(tileIndex, wallForbidden);
			}
		}
	}

	if (visited.length === 0) {
		// the start cell must not be a dormant island cell:
		// seeding a zero layer there would leave the island stranded
		let candidates = [...unvisited].filter((cell) => !islands.has(cell));
		if (candidates.length === 0) {
			// nothing to grow from: dissolve the dormant islands and start fresh
			for (let cell of islands.keys()) {
				layers[cell] = [];
			}
			islands.clear();
			candidates = [...unvisited];
		}
		const startIndex = candidates[Math.floor(Math.random() * candidates.length)];
		visited.push(startIndex);
		unvisited.delete(startIndex);
		// create the first layer on starting tile
		layers[startIndex].push(0);
	}

	const checkFullyConnected = grid.KIND !== 'triangular';

	while (unvisited.size > 0) {
		const usePrims = Math.random() < branchingAmount;
		/** @type {Number[]} */
		let sourceList = visited;
		let fromNode = -1;
		for (let nodes of [visited, avoiding, lastResort]) {
			if (nodes.length === 0) {
				continue;
			}
			sourceList = nodes;
			fromNode = usePrims ? getRandomElement(nodes) : nodes[nodes.length - 1];
			break;
		}
		if (fromNode === -1) {
			throw 'Error in layered pregeneration: no frontier cells left while unvisited cells remain';
		}

		const polygon = grid.polygon_at(fromNode);
		const cellLayers = layers[fromNode];
		const used = usedDirections(cellLayers);
		const opposite = grid.OPPOSITE;

		/** @type {{layerIndex: Number, direction: Number, neighbour: Number}[]} */
		const moves = [];
		/** @type {{layerIndex: Number, direction: Number, neighbour: Number}[]} */
		const obviousMoves = [];
		/** @type {{layerIndex: Number, direction: Number, neighbour: Number}[]} */
		const fullyConnectedMoves = [];
		const numLayers = cellLayers.length;
		for (let direction of polygon.directions) {
			if ((used & direction) > 0) {
				continue;
			}
			const { neighbour, empty } = grid.find_neighbour(fromNode, direction);
			if (empty) {
				continue;
			}
			const backDirection = opposite.get(direction) || 0;
			const neighbourUsed = usedDirections(layers[neighbour]);
			if ((neighbourUsed & backDirection) > 0) {
				throw 'Error in layered pregeneration: neighbour already connects back';
			}
			const fullyConnected =
				checkFullyConnected &&
				((used | direction) === polygon.fully_connected ||
					(neighbourUsed | backDirection) === polygon.fully_connected);
			let obvious = false;
			if (
				!fullyConnected &&
				(tileForbidden.has(fromNode) || tileForbidden.has(neighbour)) &&
				Math.random() < avoidObvious
			) {
				const nogo = tileForbidden.get(fromNode);
				const neighbourNogo = tileForbidden.get(neighbour);
				obvious = Boolean(
					(nogo && nogo.has(used | direction)) ||
						(neighbourNogo && neighbourNogo.has(neighbourUsed | backDirection))
				);
			}
			for (let layerIndex = 0; layerIndex < numLayers; layerIndex++) {
				const move = { layerIndex, direction, neighbour };
				if (fullyConnected) {
					fullyConnectedMoves.push(move);
				} else if (obvious) {
					obviousMoves.push(move);
				} else {
					moves.push(move);
				}
			}
		}

		const bestMoves =
			moves.length > 0 ? moves : obviousMoves.length > 0 ? obviousMoves : fullyConnectedMoves;
		if (bestMoves.length === 0) {
			// all directions of this cell are used up, remove it from the frontier
			if (usePrims) {
				sourceList.splice(sourceList.indexOf(fromNode), 1);
			} else {
				sourceList.pop();
			}
			continue;
		}
		if (bestMoves === fullyConnectedMoves && visited.length > 0) {
			// wants to make a fully connected union, try other cells first
			const index = visited.indexOf(fromNode);
			if (index >= 0) {
				visited.splice(index, 1);
			}
			lastResort.push(fromNode);
			continue;
		}
		if (bestMoves === obviousMoves && visited.length > 0) {
			// wants to make an obvious tile, try other cells first
			const index = visited.indexOf(fromNode);
			if (index >= 0) {
				visited.splice(index, 1);
			}
			avoiding.push(fromNode);
			continue;
		}

		const { layerIndex, direction, neighbour } = getRandomElement(bestMoves);
		cellLayers[layerIndex] |= direction;
		const island = unvisited.has(neighbour) ? islands.get(neighbour) : undefined;
		if (island !== undefined) {
			// growing into a dormant island: absorb it by extending one of its
			// existing layers with the new connection. Pushing a fresh layer
			// would not connect to the island's sub-cells (layers within a
			// cell never connect to each other)
			layers[neighbour][0] |= opposite.get(direction) || 0;
			for (let cell of island) {
				unvisited.delete(cell);
				visited.push(cell);
			}
		} else {
			layers[neighbour].push(opposite.get(direction) || 0);
			if (unvisited.has(neighbour)) {
				unvisited.delete(neighbour);
				visited.push(neighbour);
			}
		}
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
	 * @param {Number} [max_solver_iterations = 0] cap on solver search iterations per uniqueness check, 0 means no cap
	 * @param {(progress: import('$lib/puzzle/solver-layers').SolverProgress) => void} [solver_progress_callback] reports solver progress
	 * @param {(progress: GeneratorProgress) => void} [generator_progress_callback] reports generation progress
	 */
	constructor(
		grid,
		reuse_tiles_min_count = 3,
		uniqueness_patience = 5,
		max_attempts = 100,
		max_uniqueness_iterations = 100,
		max_solver_iterations = 0,
		solver_progress_callback = undefined,
		generator_progress_callback = undefined
	) {
		this.grid = grid;
		this.reuse_tiles_min_count = reuse_tiles_min_count;
		this.uniqueness_patience = uniqueness_patience;
		this.max_attempts = max_attempts;
		this.max_uniqueness_iterations = max_uniqueness_iterations;
		this.max_solver_iterations = max_solver_iterations;
		this.solver_progress_callback = solver_progress_callback;
		this.generator_progress_callback = generator_progress_callback || emptyCallback;
	}

	/**
	 * Generate a puzzle according to settings
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {SolutionsNumber} solutionsNumber - unique/multiple solutions or disable this check
	 * @returns {LayeredTiles} - generated tiles
	 */
	generate(branchingAmount = 0.6, avoidObvious = 0.0, solutionsNumber = 'unique') {
		if (solutionsNumber === 'unique') {
			/** @type {StartLayers} */
			let startLayers = [];
			let attempt = 0;
			const ambiguousLimit = Math.max(100, 0.1 * this.grid.total); // don't look for more ambiguous tiles than this
			while (attempt < this.max_attempts) {
				attempt += 1;
				let tiles = pregenerate_layers(
					this.grid,
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
					this.generator_progress_callback({ attempt, iteration });
					const solver = new LayeredSolver(tiles, this.grid);
					if (this.solver_progress_callback) {
						solver.progress_callback = this.solver_progress_callback;
					}
					const { solvable, marked, unique, numAmbiguous, complete } = solver.markAmbiguousTiles(
						Math.min(ambiguous, ambiguousLimit),
						this.max_solver_iterations
					);
					if (!solvable) {
						throw 'Pregeneration returned an unsolvable puzzle';
					}
					if (unique && complete) {
						return randomRotate(applyRotations(this.grid, tiles, marked), this.grid);
					}
					if (!complete) {
						// the solver hit its iteration cap,
						// these results can not be trusted.
						// keep startLayers and retry with a fresh board
						break;
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
					if (patienceLeft === 0) {
						break;
					}
					tiles = pregenerate_layers(
						this.grid,
						branchingAmount,
						avoidObvious,
						startLayers,
						this.reuse_tiles_min_count
					);
				}
			}
			throw 'Could not generate a layered puzzle with a unique solution. Maybe try again.';
		} else if (solutionsNumber === 'whatever') {
			const tiles = pregenerate_layers(this.grid, branchingAmount, avoidObvious);
			return randomRotate(tiles, this.grid);
		} else if (solutionsNumber === 'multiple') {
			let attempt = 0;
			while (attempt < this.max_attempts) {
				attempt += 1;
				this.generator_progress_callback({ attempt, iteration: 1 });
				const tiles = pregenerate_layers(this.grid, branchingAmount, avoidObvious);
				const solver = new LayeredSolver(tiles, this.grid);
				if (this.solver_progress_callback) {
					solver.progress_callback = this.solver_progress_callback;
				}
				const { unique, complete } = solver.markAmbiguousTiles(1, this.max_solver_iterations);
				if (!unique && complete) {
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
