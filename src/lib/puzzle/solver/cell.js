import { popcount, iterate_directions } from '#lib/puzzle/grids/bitmasks.js';

/**
 * A cell has no more viable rotation states
 * @param {Cell} cell
 */
export function NoOrientationsPossibleException(cell) {
	this.name = 'NoOrientationsPossible';
	this.message = `No orientations possible at cell ${cell.index}`;
}

/**
 * Returns a canonical id for a rotation state: the sorted list of layer masks.
 * Rotations of a cell that have the same multiset of
 * per-layer masks share an id,
 * letting us deduplicate indistinguishable rotations.
 * @param {Number[]} masks - rotated layer masks
 * @returns {String}
 */
function visualId(masks) {
	const sorted = [...masks].sort((a, b) => a - b);
	return sorted.join('-') || '0';
}
/**
 * Builds the possible states of a cell: map of rotation
 * to the rotated layers at that rotation
 * States are deduplicated using visualId
 * @param {Number[]} layers - layer bitmasks at rotation 0
 * @param {import('#lib/puzzle/grids/polygonutils.js').RegularPolygonTile} polygon
 * @returns {Map<Number, Number[]>}
 */
function buildPossible(layers, polygon) {
	/** @type {Set<String>} */
	const seen = new Set();
	/** @type {Map<Number, Number[]>} */
	const possible = new Map();
	const numDirections = polygon.num_directions;
	for (let rotation = 0; rotation < numDirections; rotation++) {
		const masks = layers.map((layer) => polygon.rotate(layer, rotation));
		const id = visualId(masks);
		if (!seen.has(id)) {
			seen.add(id);
			possible.set(rotation, masks);
		}
	}
	return possible;
}
/**
 * Constraint state for a single grid cell of a layered puzzle.
 * The decision variable is the cell rotation (all layers rotate together).
 * Possible states are deduplicated using visualId.
 * Walls/connections are direction bitmask facts, same as in the classic solver.
 */

export class Cell {
	/**
	 *
	 * @param {Number[]} layers
	 * @param {import('#lib/puzzle/grids/polygonutils.js').RegularPolygonTile} polygon
	 * @param {Number} index
	 * @param {ReturnType<buildPossible>|undefined} possible
	 * @param {Number|undefined} repeatLayersMask - precomputed for a superset
	 * of possible, e.g. passed down by clone; computed here when omitted
	 * @param {Uint32Array|undefined} answerRotations - birth table for a
	 * superset of possible, e.g. passed down by clone; computed here when omitted
	 */
	constructor(
		layers,
		polygon,
		index,
		possible = undefined,
		repeatLayersMask = undefined,
		answerRotations = undefined
	) {
		this.layers = layers;
		this.polygon = polygon;
		this.index = index; // only for error messages
		this.possible = possible || buildPossible(layers, polygon);
		this.walls = 0;
		this.connections = 0;
		this.layerPopcounts = layers.map((x) => popcount(x));
		this.hasDeadends = this.layerPopcounts.some((x) => x === 1);
		/** Deadend constraints pushed into us by neighbours - all our
		 * directions where the neighbour either has a wall or a deadend layer
		 */
		this.neighbourDeadends = 0;
		/** @type {Map<Number,Number>} - how many subcells might be hiding behind this deadend*/
		this.neighbourDeadendWeights = new Map();
		/**
		 * Deadend constraints we push into neighbours - all our directions
		 * where we either have a wall or a deadend layer
		 */
		this.ownDeadends = 0;
		// /**@type {Map<Number,Set<Number>>} for each direction - which layers might answer the connection*/
		/** @type {Map<Number,Number>} - how many subcells might be hiding behind this deadend*/
		this.ownDeadendWeights = new Map();
		/** Bitmask of layer indices whose masks repeat across the rotations in
		 * this.possible - only these layers can be solved (all surviving
		 * rotations agreeing) while possible.size > 1. */
		if (repeatLayersMask !== undefined) {
			this.repeatLayersMask = repeatLayersMask;
		} else {
			this.repeatLayersMask = 0;
			const masksPerRotation = [...this.possible.values()];
			for (let layerIndex = 0; layerIndex < this.layers.length; layerIndex++) {
				const distinct = new Set(masksPerRotation.map((layers) => layers[layerIndex]));
				if (distinct.size < masksPerRotation.length) {
					this.repeatLayersMask |= 1 << layerIndex;
				}
			}
		}
		/** Per (grid direction bit position, layer index): bitmask of rotation
		 * numbers whose mask connects that direction through that layer.
		 * Fixed at birth - rotation numbers are the stable keys of possible,
		 * and filtering only shrinks the survivor set, so a table computed
		 * for a map stays sound for any subset of it. Rows for directions
		 * the polygon never uses stay zero: nothing can ever answer them.
		 * Single-layer cells skip the table: getAnsweringLayer resolves them
		 * to layer 0 directly, so nothing descends into the table
		 * @type {Uint32Array|undefined} */
		this.answerRotations = undefined;
		if (answerRotations !== undefined) {
			this.answerRotations = answerRotations;
		} else if (this.layers.length > 1) {
			const layerCount = this.layers.length;
			// grid direction space spanned by this shape: bit positions 0
			// through the highest bit of the union of all its directions
			const rows = 32 - Math.clz32(this.polygon.fully_connected);
			this.answerRotations = new Uint32Array(rows * layerCount);
			for (let [rotation, masks] of this.possible) {
				for (let i = 0; i < layerCount; i++) {
					let mask = masks[i];
					while (mask) {
						const low = mask & -mask;
						const k = 31 - Math.clz32(low);
						this.answerRotations[k * layerCount + i] |= 1 << rotation;
						mask ^= low;
					}
				}
			}
		}
	}
	/**
	 * Clone this cell assigning new possible states
	 * @param {ReturnType<buildPossible>|undefined} newPossible
	 * @returns {Cell}
	 */
	clone(newPossible = undefined) {
		// the parent's repeatLayersMask and answerRotations were computed for
		// a superset of newPossible, which keeps them sound - pass them down
		// to skip the birth computations
		const copy = new Cell(
			this.layers,
			this.polygon,
			this.index,
			newPossible,
			this.repeatLayersMask,
			this.answerRotations
		);
		copy.walls = this.walls;
		copy.connections = this.connections;
		copy.neighbourDeadends = this.neighbourDeadends;
		copy.neighbourDeadendWeights = new Map(this.neighbourDeadendWeights);
		copy.ownDeadends = this.ownDeadends;
		copy.ownDeadendWeights = new Map(this.ownDeadendWeights);
		return copy;
	}

	/**
	 * Union of all layer masks at a given rotation
	 * @param {Number} rotation
	 * @returns {Number}
	 */
	unionAt(rotation) {
		let union = 0;
		for (let layer of this.possible.get(rotation) || []) {
			union |= layer;
		}
		return union;
	}

	/**
	 * @param {Number} direction
	 */
	addWall(direction) {
		this.walls |= direction - ((this.connections | this.walls) & direction);
		this.neighbourDeadends |= this.walls;
		this.ownDeadends |= this.walls;
	}

	/**
	 * @param {Number} direction
	 */
	addConnection(direction) {
		this.connections |= direction - ((this.connections | this.walls) & direction);
	}

	/**
	 * Inform this cell that the neighbour in direction could only answer a connection
	 * with a deadend layer (if at all). Weight is how many subcells belong to the
	 * deadend portion (it might be a whole island with one free link left).
	 * @param {Number} direction
	 * @param {Number} weight
	 */
	addNeighbourDeadend(direction, weight) {
		this.neighbourDeadends |= direction & ~(this.neighbourDeadends & direction);
		this.neighbourDeadendWeights.set(
			direction,
			Math.max(weight, this.neighbourDeadendWeights.get(direction) || 0)
		);
	}

	/**
	 * Filters out orientations that contradict known walls
	 * @param {Number} directions
	 * @return {Number} count of removed orientations
	 */
	mustHaveAllWalls(directions) {
		const remove = [];
		for (let [rotation, layers] of this.possible) {
			if (layers.some((layer) => (layer & directions) > 0)) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Filters out orientations that connect all the mentioned directions, so
	 * every survivor keeps at least one wall among them. Union-based: on
	 * classic one-layer cells this is exactly the classic mustHaveSomeWalls
	 * @param {Number} directions
	 * @return {Number} count of removed orientations
	 */
	mustHaveSomeWalls(directions) {
		const remove = [];
		for (let rotation of this.possible.keys()) {
			if ((this.unionAt(rotation) & directions) === directions) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Filters out orientations that contradict known connections
	 * @param {Number} directions
	 * @return {Number} count of removed orientations
	 */
	mustHaveAllConnections(directions) {
		const remove = [];
		for (let rotation of this.possible.keys()) {
			if ((this.unionAt(rotation) & directions) !== directions) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Filters out orientations that connect only deadend directions
	 * Unlike walls and connections deadends are not mutual - if my
	 * neighbour extends a deadend toward me I must not answer with a
	 * deadend myself.
	 * @param {Number} directions
	 * @param {Number} unlessThisBig - allow orientation if the resulting island is big enough
	 * @returns {Number} count of removed orientations
	 */
	mustNotSealDeadends(directions, unlessThisBig = Infinity) {
		const remove = [];
		for (let [rotation, layers] of this.possible) {
			for (let layer of layers) {
				if ((layer & directions) === layer && this.getDeadendWeight(layer) < unlessThisBig) {
					remove.push(rotation);
					break;
				}
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 *
	 * @param {Number} layer
	 */
	getDeadendWeight(layer) {
		let total = 1;
		for (let direction of iterate_directions(layer)) {
			total += this.neighbourDeadendWeights.get(direction) || 0;
		}
		return total;
	}

	/**
	 * Forbid orientations where a certain layer connects in direction
	 * (use case: layer is in component and direction connects to the same component, avoid loop)
	 * @param {Number} layerIndex
	 * @param {Number} direction
	 */
	forbidLayerConnection(layerIndex, direction) {
		const remove = [];
		for (let [rotation, layers] of this.possible) {
			if ((layers[layerIndex] & direction) > 0) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Forbid orientations where any layer connects at least two of the directions
	 * (use case: all given directions lead to the same component, avoid loop)
	 * @param {Number} directions
	 */
	forbidLayerBridge(directions) {
		const remove = [];
		for (let [rotation, layers] of this.possible) {
			for (let [index, layer] of layers.entries()) {
				const intersection = layer & directions;
				if (popcount(intersection) >= 2) {
					remove.push(rotation);
				}
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Which layers might answer a connection in this direction, as a bitmask
	 * of layer indices: 0 = none, single bit = unique, several = ambiguous.
	 * Directions are single-bit masks, the table row is their bit position.
	 * A layer answers iff any of its birth rotations that connect this
	 * direction is still a survivor
	 * @param {Number} direction
	 * @returns {Number}
	 */
	getAnsweringLayersMask(direction) {
		const rotations = this.answerRotations;
		if (rotations === undefined) {
			// single-layer cell, no birth table: layer 0 answers iff any
			// surviving rotation connects this direction. getAnsweringLayer
			// answers single-layer cells directly and never descends here
			for (let layers of this.possible.values()) {
				if (layers[0] & direction) return 1;
			}
			return 0;
		}
		const row = 31 - Math.clz32(direction);
		let survivors = 0;
		for (let rotation of this.possible.keys()) survivors |= 1 << rotation;
		let answering = 0;
		const layerCount = this.layers.length;
		for (let i = 0; i < layerCount; i++) {
			if (rotations[row * layerCount + i] & survivors) {
				answering |= 1 << i;
			}
		}
		return answering;
	}

	/**
	 * The unique layer index that might answer a connection in this
	 * direction, or undefined when none or several layers answer
	 * @param {Number} direction
	 * @returns {Number|undefined}
	 */
	getAnsweringLayer(direction) {
		if (this.layers.length === 1) return 0;
		const answering = this.getAnsweringLayersMask(direction);
		if (answering !== 0 && popcount(answering) === 1) {
			return 31 - Math.clz32(answering);
		}
		return undefined;
	}

	/**
	 * @returns {Number} our directions where we can only use deadend tiles
	 * or only use layers that connect to neighbour deadends
	 */
	get ownDeadendDirections() {
		if (!(this.hasDeadends || this.neighbourDeadends > 0)) return 0;
		let deadends = this.polygon.fully_connected & ~this.walls & ~this.neighbourDeadends;
		const w = this.ownDeadendWeights;
		for (let [rotation, layers] of this.possible) {
			for (let [index, layer] of layers.entries()) {
				if (this.layerPopcounts[index] === 1) {
					w.set(layer, Math.max(1, w.get(layer) || 0));
					continue;
				}
				const effectiveLayer = layer & ~this.neighbourDeadends;
				if (effectiveLayer === 0) continue;
				else if (popcount(effectiveLayer) === 1) {
					let weight = 1;
					for (let direction of iterate_directions(layer & this.neighbourDeadends)) {
						weight += this.neighbourDeadendWeights.get(direction) || 0;
					}
					w.set(effectiveLayer, Math.max(weight, w.get(effectiveLayer) || 0));
					continue;
				}
				deadends &= ~effectiveLayer;
			}
		}
		return deadends;
	}

	/**
	 * Where this layer definitely connects
	 * @param {Number} layerIndex
	 * @returns {Number}
	 */
	getLayerDefiniteConnections(layerIndex) {
		let connections = this.polygon.fully_connected & ~this.walls;
		for (let layers of this.possible.values()) {
			connections &= layers[layerIndex];
		}
		return connections;
	}

	/**
	 * Where this layer might potentially connect
	 * @param {Number} layerIndex
	 * @returns {Number}
	 */
	getLayerPotentialConnections(layerIndex) {
		let connections = 0;
		for (let layers of this.possible.values()) {
			connections |= layers[layerIndex];
		}
		return connections & ~this.walls;
	}

	/**
	 * Filters out rotations that contradict known constraints
	 * @param {Number} weightLimit - deadend sealing prevented if total sealed weight < weightLimit
	 * @throws {NoOrientationsPossibleException}
	 * @returns {{addedWalls:Number, addedConnections: Number, addedDeadends: Number}}
	 */
	applyConstraints(weightLimit = Infinity) {
		const full = this.polygon.fully_connected;
		const result = {
			addedWalls: 0,
			addedConnections: 0,
			addedDeadends: 0
		};
		let newWalls = full;
		let newConnections = full;
		const removedCount =
			this.mustHaveAllConnections(this.connections) +
			this.mustHaveAllWalls(this.walls) +
			this.mustNotSealDeadends(this.neighbourDeadends, weightLimit);
		// if (removedCount === 0) return result;
		if (this.possible.size === 0) {
			throw new NoOrientationsPossibleException(this);
		}
		for (let rotation of this.possible.keys()) {
			const union = this.unionAt(rotation);
			newWalls = newWalls & (full - union);
			newConnections = newConnections & union;
		}
		result.addedWalls = newWalls - this.walls;
		this.walls = newWalls;
		result.addedConnections = newConnections - this.connections;
		this.connections = newConnections;
		if ((this.hasDeadends || this.neighbourDeadends > 0) && this.ownDeadends !== full) {
			const newDeadends = this.ownDeadendDirections;
			result.addedDeadends = newDeadends & ~this.ownDeadends & ~newWalls;
			this.ownDeadends = newDeadends | newWalls;
		}
		return result;
	}
}
