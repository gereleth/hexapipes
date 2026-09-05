/**
 * @typedef {Number[][]} LayeredTiles - for every grid cell a list of layers,
 * each layer is a tile bitmask of its connections;
 * cells that are empty on the board have no layers
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
 * Fills a grid with layered tiles using GrowingTree algorithm
 * Every cell can hold several independent layers (up to one per direction),
 * layers within a cell never connect to each other.
 * A direction can be used by at most one layer of a cell.
 * Growing into an already visited cell adds a new layer there,
 * so the graph of sub-cells (cell + layer) always stays a tree.
 * Moves that would make a layer fully connected are a last resort.
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 * @param {Number} branchingAmount - value in range [0, 1],
 * 0 is like recursive backtracking, 1 is like Prim's algorithm
 * @returns {LayeredTiles} - unrandomized layered tiles
 */
export function pregenerate_layers(grid, branchingAmount = 0.5) {
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
	/** @type {Number[]} cells whose only remaining moves create a fully connected layer */
	const lastResort = [];
	const startIndex = [...unvisited][Math.floor(Math.random() * unvisited.size)];
	visited.push(startIndex);
	unvisited.delete(startIndex);

	const checkFullyConnected = grid.KIND !== 'triangular';

	while (unvisited.size > 0) {
		const usePrims = Math.random() < branchingAmount;
		/** @type {Number[]} */
		let sourceList = visited;
		let fromNode = -1;
		for (let nodes of [visited, lastResort]) {
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
		const fullyConnectedMoves = [];
		const numLayers = cellLayers.length === 0 ? 1 : cellLayers.length;
		for (let direction of polygon.directions) {
			if ((used & direction) > 0) {
				continue;
			}
			const { neighbour, empty } = grid.find_neighbour(fromNode, direction);
			if (empty) {
				continue;
			}
			if ((usedDirections(layers[neighbour]) & (opposite.get(direction) || 0)) > 0) {
				throw 'Error in layered pregeneration: neighbour already connects back';
			}
			for (let layerIndex = 0; layerIndex < numLayers; layerIndex++) {
				const layer = layerIndex < cellLayers.length ? cellLayers[layerIndex] : 0;
				const move = { layerIndex, direction, neighbour };
				if (checkFullyConnected && (layer | direction) === polygon.fully_connected) {
					fullyConnectedMoves.push(move);
				} else {
					moves.push(move);
				}
			}
		}

		const bestMoves = moves.length > 0 ? moves : fullyConnectedMoves;
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
			// wants to make a fully connected layer, try other cells first
			const index = visited.indexOf(fromNode);
			if (index >= 0) {
				visited.splice(index, 1);
			}
			lastResort.push(fromNode);
			continue;
		}

		const { layerIndex, direction, neighbour } = getRandomElement(bestMoves);
		if (cellLayers.length === 0) {
			cellLayers.push(0);
		}
		cellLayers[layerIndex] |= direction;
		layers[neighbour].push(opposite.get(direction) || 0);
		if (unvisited.has(neighbour)) {
			unvisited.delete(neighbour);
			visited.push(neighbour);
		}
	}
	return layers;
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
