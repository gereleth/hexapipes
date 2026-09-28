import { ComponentsRegistry } from './components-registry';

/* Constraint Violation Exceptions */

/**
 * A cell has no more viable rotation states
 * @param {LayeredCell} cell
 */
function NoOrientationsPossibleException(cell) {
	this.name = 'NoOrientationsPossible';
	this.message = `No orientations possible at cell ${cell.index}`;
}

function LoopDetectedException() {
	this.name = 'LoopDetected';
	this.message = 'Loop detected';
}

function IslandDetectedException() {
	this.name = 'IslandDetected';
	this.message = 'Island detected';
}

// Shared sentinels: thrown by reference so a throw allocates nothing (and
// captures no stack). Catch sites backtrack on any of these without
// inspecting them.
const LOOP_DETECTED = new LoopDetectedException();
const ISLAND_DETECTED = new IslandDetectedException();

/**
 * Solving stage
 * initial: deductions made about the original puzzle
 * guess: deductions made after a guess
 * aftercheck: steps made after a solution has been found
 * @typedef {'initial'|'guess'|'aftercheck'} SolvingStage
 */

/**
 * Solve step represents processing new info on a single cell
 * @typedef {Object} LayeredStep
 * @property {Number} index
 * @property {Number} rotation - representative rotation that fits currently known facts
 * @property {Boolean} final - true if this state is the only one left
 */

/**
 * Solver progress tracks current counts of solved/guessed/ambiguous tiles
 * @typedef {Object} SolverProgress
 * @property {Number} total
 * @property {Number} solved
 * @property {Number} guessed
 * @property {Number} ambiguous
 */

/**
 * Iterates directions present in a layer mask
 * @param {Number} mask
 * @yields {Number}
 */
function* iterate_directions(mask) {
	let bits = mask;
	while (bits > 0) {
		const direction = bits & -bits;
		yield direction;
		bits ^= direction;
	}
}

/**
 * Counts total directions in a layer mask
 * @param {Number} mask
 * @returns {Number}
 */
function popcount(mask) {
	let count = 0;
	let bits = mask;
	while (bits > 0) {
		bits ^= bits & -bits;
		count += 1;
	}
	return count;
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
 * @param {import('$lib/puzzle/grids/polygonutils').RegularPolygonTile} polygon
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
export class LayeredCell {
	/**
	 *
	 * @param {Number[]} layers
	 * @param {import('$lib/puzzle/grids/polygonutils').RegularPolygonTile} polygon
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
	 * @returns {LayeredCell}
	 */
	clone(newPossible = undefined) {
		// the parent's repeatLayersMask and answerRotations were computed for
		// a superset of newPossible, which keeps them sound - pass them down
		// to skip the birth computations
		const copy = new LayeredCell(
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

const emptyCallback = (/**@type {SolverProgress} */ progress) => {};

export class LayeredSolver {
	UNSOLVED = -1;
	AMBIGUOUS = -2;

	/** @type {ComponentsRegistry} - owns all component/slot/subcell state */
	components;
	/**
	 *
	 * @param {Number[][]} tiles
	 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 * @param {LayeredSolver|null} parent
	 */
	constructor(tiles, grid, parent = null) {
		this.tiles = tiles;
		this.grid = grid;
		this.parent = parent;
		this.progress_callback = emptyCallback;
		/** @type {Number} */
		this.totalSubcells = parent ? parent.totalSubcells : 0;
		/** @type {Number} */
		this.totalUnsolved = parent ? parent.totalUnsolved : grid.total;

		/** @type {Map<Number, LayeredCell>} */
		this.unsolved = new Map();

		/** @type {Number[]} - rotation per cell, or UNSOLVED */
		this.solution = parent ? [...parent.solution] : tiles.map(() => this.UNSOLVED);

		/** @type {Number[][]} - array of found solutions */
		this.solutions = [];

		/** @type {Set<Number>} */
		this.dirty = new Set();

		// components are born in addConnection; the registry owns their rows,
		// member lists and queues (see ComponentsRegistry)
		if (parent) {
			this.components = parent.components.clone();
		} else {
			let maxLayers = 0;
			for (let i = 0; i < tiles.length; i++) {
				if (tiles[i].length > maxLayers) maxLayers = tiles[i].length;
			}
			this.components = new ComponentsRegistry(grid, maxLayers);
		}

		/**
		 * Counters of search work, shared with all clones (see clone) so that
		 * totals accumulate across the whole trial tree of one solve run
		 * @type {{iterations: Number, trialClones: Number, shortTrials: Number, dirtyProcessings: Number}}
		 */
		this.stats = parent
			? parent.stats
			: { iterations: 0, trialClones: 0, shortTrials: 0, dirtyProcessings: 0 };

		this.shortTrialsIndex = 0;

		/** @type {any[][]} cells to process components for */
		this.avoidLoopQueue = [];
	}

	/**
	 * Returns the cell at index. Initializes the cell if necessary.
	 * Throws should never happen when the solver is working correctly
	 * @param {Number} index
	 * @returns {LayeredCell}
	 */
	getCell(index) {
		let cell = this.unsolved.get(index);
		if (cell !== undefined) {
			return cell;
		}
		if (this.solution[index] !== this.UNSOLVED) {
			throw `Attempted resurrection of cell ${index}`;
		}
		if (this.parent) {
			cell = this.parent.getCell(index);
			const clone = cell.clone(new Map(cell.possible));
			this.unsolved.set(index, clone);
			return clone;
		}
		cell = new LayeredCell(this.tiles[index], this.grid.polygon_at(index), index);
		this.unsolved.set(index, cell);
		this.doLocalDeductions(index, cell);
		// a freshly born cell must be dirty-processed even when doLocalDeductions
		// found nothing: its deadend and wall facts only reach neighbours via
		// processDirtyCell, and query paths (getAnsweringComponent etc.)
		// materialize cells without ever dirtying them
		this.dirty.add(index);
		return cell;
	}

	/**
	 * Checks if any orientations can be ruled out based on
	 * walls or empty tiles nearby
	 * @param {Number} index
	 * @param {LayeredCell} cell - cell at index
	 */
	doLocalDeductions(index, cell) {
		if (cell.possible.size === 1) {
			// either empty or fully connected, is solved right away
			return;
		}
		let walls = 0;
		for (let direction of cell.polygon.directions) {
			const { neighbour, empty } = this.grid.find_neighbour(index, direction);
			if (empty) {
				walls += direction;
			}
		}
		// remove orientations that contradict outer walls
		if (walls > 0) {
			cell.addWall(walls);
		}
	}

	/**
	 * Register a connection from cell at index in direction
	 * Creates a new component with two slots at this edge
	 * @param {Number} index
	 * @param {Number} direction
	 */
	addConnection(index, direction) {
		const { neighbour } = this.grid.find_neighbour(index, direction);
		const opposite = this.grid.OPPOSITE.get(direction) || 0;
		const neighbourCell = this.getCell(neighbour);
		neighbourCell.addConnection(opposite);
		this.dirty.add(neighbour);
		// add connection can only be called once per edge between two cells

		// Add a component between them, with two open slot ends
		const component = this.components.create();
		this.components.addSlot(component, index, direction);
		this.components.addSlot(component, neighbour, opposite);
	}

	/**
	 * Return the component id the cell at index would join if it connects
	 * in direction (0 = none)
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {Number}
	 */
	getAnsweringComponent(index, direction) {
		// see if we have a slot in this direction
		const slotComp = this.components.getSlotComponent(index, direction);
		if (slotComp !== 0) return slotComp;
		// ask the neighbour
		const { neighbour } = this.grid.find_neighbour(index, direction);
		const opposite = this.grid.OPPOSITE.get(direction) || 0;
		const neighbourCell = this.getCell(neighbour);
		const layerIndex = neighbourCell.getAnsweringLayer(opposite);
		if (layerIndex !== undefined) {
			return this.components.getSubcellComponent(this.grid.subcellId(neighbour, layerIndex));
		}
		return 0;
	}
	/**
	 * See if we can deduce any walls when a subcell joins a component
	 * @param {Number} index
	 * @param {Number} layerIndex
	 * @param {LayeredCell} cell
	 * @param {Number} component - component id
	 */
	avoidSubcellLoops(index, layerIndex, cell, component) {
		const subCellId = this.grid.subcellId(index, layerIndex);
		const potential = cell.getLayerPotentialConnections(layerIndex);
		const known = this.components.getSubcellDirections(subCellId, component);
		for (let direction of iterate_directions(potential & ~known)) {
			const answering = this.getAnsweringComponent(index, direction);
			if (answering === component) {
				this.avoidLoopQueue.push([cell, layerIndex, direction]);
			}
		}
	}

	/**
	 * See if we can rule out some orientations of cell layers
	 * @param {Number} index
	 * @param {Number} component - component id
	 */
	avoidSlotLoops(index, component) {
		const cell = this.getCell(index);
		if (cell.possible.size === 1) {
			// the cell is solved - every remaining direction is a
			// non-connection of its only rotation, so any bridge constraint
			// derived from probing them would be vacuous
			return;
		}
		let directions = cell.polygon.fully_connected & ~cell.walls;
		for (let layerIndex of cell.layers.keys()) {
			const subcellId = this.grid.subcellId(index, layerIndex);
			// subtract what this cell's subcells already contribute; an unowned
			// subcell contributes nothing
			directions &= ~this.components.getSubcellDirections(subcellId);
			// detect solved layers to avoid resurrecting neighbours: layers
			// without repeated masks differ between any two surviving
			// rotations, so they can only be solved when possible.size === 1,
			// handled by the early return above
			if (((cell.repeatLayersMask >> layerIndex) & 1) === 0) continue;
			let uniqueMask;
			let isUnique = true;
			for (let layers of cell.possible.values()) {
				const mask = layers[layerIndex];
				if (uniqueMask === undefined) {
					uniqueMask = mask;
				} else if (mask !== uniqueMask) {
					isUnique = false;
					break;
				}
			}
			if (isUnique && uniqueMask !== undefined) {
				directions &= ~uniqueMask;
			}
		}
		let forbidden = 0;
		for (let direction of iterate_directions(directions)) {
			const answering = this.getAnsweringComponent(index, direction);
			if (answering === component) {
				forbidden |= direction;
			}
		}
		if (popcount(forbidden) <= 1) return;
		this.avoidLoopQueue.push([cell, null, forbidden]);
	}

	/**
	 *
	 * @param {Number} index
	 * @param {LayeredCell} cell
	 */
	pruneLoop(index, cell) {
		if (cell.possible.size === 1) return;
		this.components.forEachSlot(index, (direction, component) =>
			this.avoidSlotLoops(index, component)
		);
		for (let layerIndex of cell.layers.keys()) {
			const subCellId = this.grid.subcellId(index, layerIndex);
			const component = this.components.getSubcellComponent(subCellId);
			if (component === 0) continue;
			this.avoidSubcellLoops(index, layerIndex, cell, component);
		}
	}

	/**
	 * Check if we can propagate components data through this cell
	 * @param {Number} index
	 * @param {LayeredCell} cell
	 */
	resolveComponents(index, cell) {
		// see if our slots resolved to some layer
		if (this.components.hasOpenSlots(index)) {
			this.components.forEachSlot(index, (direction, component) => {
				const layerIndex = cell.getAnsweringLayer(direction);
				if (layerIndex === undefined) return;
				const subCellId = this.grid.subcellId(index, layerIndex);
				const otherComponent = this.components.getSubcellComponent(subCellId);
				if (otherComponent === 0) {
					this.components.attachSubcell(component, subCellId, direction);
					// subcell joined a component - check if it has
					// any neighbours already in component
					this.avoidSubcellLoops(index, layerIndex, cell, component);
					this.components.islandAdd(component);
				} else if (otherComponent === component) {
					throw LOOP_DETECTED;
				} else {
					this.components.subNodeVal[this.components.subcellNode[subCellId]] |= direction;
					this.mergeComponents(otherComponent, component, subCellId);
					// the resolved slot's end at this cell is consumed by the
					// merge (the absorbed's record was stripped of it): close the
					// row entry - after the merge, so its repoints still see the
					// cell's remaining open ends
					this.components.slotRemove(index, direction);
					this.components.islandAdd(otherComponent);
					this.components.islandDelete(component); // so we don't process stale components later
				}
			});
		}
		// for our subcells in components see if there are new definite connections to neighbours
		// and creat new slots
		for (let layerIndex of cell.layers.keys()) {
			const subCellId = this.grid.subcellId(index, layerIndex);
			const component = this.components.getSubcellComponent(subCellId);
			if (component === 0) continue;
			const connections = cell.getLayerDefiniteConnections(layerIndex);
			const known = this.components.getSubcellDirections(subCellId, component);
			const newDirections = connections & ~known;
			if (newDirections > 0) {
				this.components.setSubcellDirections(subCellId, connections);
				for (let direction of iterate_directions(newDirections)) {
					const { neighbour } = this.grid.find_neighbour(index, direction);
					const opposite = this.grid.OPPOSITE.get(direction) || 0;
					const otherComponent = this.components.getSlotComponent(neighbour, opposite);
					if (otherComponent === 0) {
						this.components.addSlot(component, neighbour, opposite);
						this.components.islandAdd(component);
						this.avoidSlotLoops(index, component);
					} else if (otherComponent === component) {
						throw LOOP_DETECTED;
					} else {
						this.mergeComponents(component, otherComponent, subCellId);
						this.components.islandAdd(component);
						this.components.islandDelete(otherComponent); // so we don't process stale entries later
					}
				}
			}
			if (popcount(connections) === cell.layerPopcounts[layerIndex]) {
				this.components.removeSubcell(component, subCellId);
			}
		}
		this.pruneLoop(index, cell);
	}

	/**
	 * Merge components after a slot and a subcell connect in cell at index.
	 * All of the absorbed component's members and slot ends are MOVED to the
	 * survivor and the absorbed is left empty (its id is never reused, so
	 * stale references can never alias a live component). Moving - rather
	 * than copying - is what maintains the invariant that a live component's
	 * list keys are exactly the sub-cells / cells its registry entries point
	 * at, which subGetVal, subcellNode and slotDirect lookups rely on.
	 * @param {Number} subcellComponent - surviving component id
	 * @param {Number} slotComponent - absorbed component id
	 * @param {Number} subCellId
	 */
	mergeComponents(subcellComponent, slotComponent, subCellId) {
		const index = subCellId % this.grid.total;
		const subCellDirections = this.components.subGetVal(subcellComponent, subCellId);
		const slotNode = this.components.slotMember(slotComponent, index);
		const slotDirections = slotNode !== 0 ? this.components.slotNodeVal[slotNode] : 0;
		const slotsLeft = slotDirections & ~subCellDirections;
		if (
			subCellDirections === 0 ||
			slotDirections === 0 ||
			(slotDirections & subCellDirections) === 0
		) {
			throw 'Invalid merge';
		}
		if (slotsLeft === 0) {
			this.components.unlinkSlotNode(slotComponent, slotNode);
		} else {
			this.components.slotNodeVal[slotNode] = slotsLeft;
		}
		this.components.compTotalSub[subcellComponent] += this.components.compTotalSub[slotComponent];
		// move the absorbed's slot ends, in list order, to the survivor
		for (let n = this.components.compSlotHead[slotComponent]; n !== 0; ) {
			const next = this.components.slotNodeNext[n];
			const joinIndex = this.components.slotNodeKey[n];
			const directions = this.components.slotNodeVal[n];
			this.components.unlinkSlotNode(slotComponent, n);
			this.components.mergeSlotMask(subcellComponent, joinIndex, directions);
			for (let direction of iterate_directions(directions)) {
				this.components.slotRepoint(joinIndex, direction, subcellComponent);
			}
			this.avoidSlotLoops(joinIndex, subcellComponent);
			n = next;
		}
		// move the absorbed's subcell entries
		for (let n = this.components.compSubHead[slotComponent]; n !== 0; ) {
			const next = this.components.subNodeNext[n];
			const joinSubCellId = this.components.subNodeKey[n];
			const connections = this.components.subNodeVal[n];
			this.components.unlinkSubNode(slotComponent, n);
			if (this.components.subcellOwner[joinSubCellId] === subcellComponent) {
				this.components.subNodeVal[this.components.subcellNode[joinSubCellId]] = connections;
			} else {
				const newNode = this.components.subAppend(subcellComponent, joinSubCellId, connections);
				this.components.subcellOwner[joinSubCellId] = subcellComponent;
				this.components.subcellNode[joinSubCellId] = newNode;
			}
			const [joinIndex, joinLayer] = this.grid.cellLayerOf(joinSubCellId);
			this.avoidSubcellLoops(joinIndex, joinLayer, this.getCell(joinIndex), subcellComponent);
			n = next;
		}
	}

	/**
	 * Process new info on a single cell and propagate constraints
	 * @param {Number} index
	 * @returns {LayeredStep}
	 * @throws {NoOrientationsPossibleException|IslandDetectedException|LoopDetectedException}
	 */
	processDirtyCell(index) {
		this.stats.dirtyProcessings += 1;
		const cell = this.getCell(index);
		while (this.dirty.has(index)) {
			// console.log('process dirty cell', index);
			const possibleBefore = cell.possible.size;
			const grid = this.grid;
			// console.log({ index: cell.index, walls: cell.walls, connections: cell.connections });
			let { addedWalls, addedConnections, addedDeadends } = cell.applyConstraints(
				this.totalSubcells
			);
			// console.log({ addedWalls, addedConnections, addedDeadends });
			if (addedWalls > 0) {
				for (let direction of iterate_directions(addedWalls)) {
					const { neighbour, empty } = grid.find_neighbour(index, direction);
					if (empty) continue;
					const opposite = grid.OPPOSITE.get(direction) || 0;
					const neighbourCell = this.getCell(neighbour);
					neighbourCell.addWall(opposite);
					this.dirty.add(neighbour);
				}
			}
			if (addedConnections > 0) {
				for (let direction of iterate_directions(addedConnections)) {
					this.addConnection(index, direction);
				}
			}
			if (addedDeadends > 0) {
				for (let direction of iterate_directions(addedDeadends)) {
					const { neighbour, empty } = grid.find_neighbour(index, direction);
					// avoid telling our deadend facts to solved neighbours
					// possibly needs to be handled in components logic?..
					if (empty || this.solution[neighbour] !== this.UNSOLVED) continue;
					const opposite = grid.OPPOSITE.get(direction) || 0;
					const neighbourCell = this.getCell(neighbour);
					neighbourCell.addNeighbourDeadend(opposite, cell.ownDeadendWeights.get(direction) || 0);
					this.dirty.add(neighbour);
				}
			}
			this.dirty.delete(index);
			// resolving components might cause some merges and trigger loop avoidance logic
			// relevant prunings of possible states should happen after the resolve step completes
			// so the prunings are added to a queue and carried out later
			// re-dirty affected cells if removed any orientations
			this.resolveComponents(index, cell);
			for (let [c, l, d] of this.avoidLoopQueue) {
				if (l === null) {
					// came from slot logic, forbid orientation if any layer bridges any two directions
					const removed = c.forbidLayerBridge(d);
					if (removed > 0) {
						this.dirty.add(c.index);
					}
				} else {
					// came from subcell logic, forbid direction in a specific layer
					const removed = c.forbidLayerConnection(l, d);
					if (removed > 0) {
						this.dirty.add(c.index);
					}
				}
			}
			this.avoidLoopQueue.length = 0;

			for (let i = 0; i < this.components.islandQLen; i++) {
				const component = this.components.islandQ[i];
				// skip deleted entries (their positions stay reserved)
				if (this.components.islandState[component] !== 1) continue;
				if (
					this.components.compSlotCount[component] === 0 &&
					this.components.compSubCount[component] === 0 &&
					this.components.compTotalSub[component] < this.totalSubcells
				) {
					throw ISLAND_DETECTED;
				} else if (
					this.components.compSlotCount[component] === 1 &&
					this.components.compSubCount[component] === 0
				) {
					const head = this.components.compSlotHead[component];
					const islandCell = this.components.slotNodeKey[head];
					const islandConnections = this.components.slotNodeVal[head];
					if (popcount(islandConnections) === 1) {
						const c = this.getCell(islandCell);
						const deadendsBefore = c.neighbourDeadends;
						// override weight because component size is exact at this point
						c.addNeighbourDeadend(islandConnections, 0);
						c.neighbourDeadendWeights.set(
							islandConnections,
							this.components.compTotalSub[component]
						);
						if (c.neighbourDeadends !== deadendsBefore) {
							this.dirty.add(islandCell);
						}
					}
					// 2+ island connections into the same cell should be handled differently.
					// It's enough for one strand to escape, so sealing one connection and
					// continuing another one should be valid.
					// Deadend machinery treats all deadends as independent => doesn't work for this case
					// Valid handling is not implemented yet
				} else if (
					this.components.compSlotCount[component] === 0 &&
					this.components.compSubCount[component] === 1
				) {
					const head = this.components.compSubHead[component];
					const islandSubCell = this.components.subNodeKey[head];
					const islandConnections = this.components.subNodeVal[head];
					const islandCell = islandSubCell % this.grid.total;
					const c = this.getCell(islandCell);
					const deadendsBefore = c.neighbourDeadends;
					let weight = this.components.compTotalSub[component] - 1; // don't count this subcell itself
					for (let direction of iterate_directions(islandConnections)) {
						c.addNeighbourDeadend(direction, weight);
						c.neighbourDeadendWeights.set(direction, weight);
						weight = 0; // prevent double-counting of island
						// it doesn't matter which direction carries the weight
					}
					if (c.neighbourDeadends !== deadendsBefore) {
						this.dirty.add(islandCell);
					}
				}
			}
			this.components.islandClear();
		}
		const final = cell.possible.size === 1;
		const [rotation] = cell.possible.keys();
		if (final) {
			this.solution[index] = rotation;
			this.unsolved.delete(index);
			this.totalUnsolved -= 1;
		}
		return { index, rotation, final };
	}

	/**
	 * Process new info on cells and propagate constraints
	 * @yields {LayeredStep} - info about the processed cell
	 * @throws {NoOrientationsPossibleException}
	 */
	*processDirtyCells() {
		while (this.dirty.size > 0) {
			// console.log('begin dirty step', [...this.dirty]);
			const [index] = this.dirty;
			yield this.processDirtyCell(index);
		}
	}

	/**
	 * Initialize all cells and process any constraints found
	 * @yields {LayeredStep} - info about the processed cell
	 * @throws {NoOrientationsPossibleException}
	 */
	*processInitialDeductions() {
		if (this.dirty.size > 0) return;
		this.totalSubcells = 0;
		const toInit = new Set();
		// process empty cells first, then the rest
		for (let index = 0; index < this.grid.total; index++) {
			if (this.grid.emptyCells.has(index)) {
				this.dirty.add(index);
			} else {
				toInit.add(index);
				this.totalSubcells += this.tiles[index].length;
			}
		}
		while (toInit.size > 0) {
			const [index] = toInit;
			toInit.delete(index);
			// console.log({ toInit, index });
			if (this.unsolved.has(index)) {
				continue;
			}
			this.dirty.add(index);
			for (let step of this.processDirtyCells()) {
				toInit.delete(step.index);
				if (this.tiles[step.index].length === 0) {
					// don't report processing empty cell as a step
					continue;
				}
				yield step;
			}
		}
	}

	/**
	 * Chooses a tile/rotation to try out.
	 * Selects a rotation from a tile with the least number of options
	 * Sets a single rotation as possible and dirties the cell
	 * @param {Number[]} marked - optional marked array to skip ambiguous tiles
	 * @returns {Number[]} - [index, rotation]
	 */
	makeAGuess(marked = []) {
		let minPossibleSize = Number.POSITIVE_INFINITY;
		let guessIndex = -1;
		// with lazy cloning this.unsolved might not have entries for
		// cells we haven't touched yet
		// so check for unsolved entries using (marked or this.solution)
		for (let [index, value] of this.solution.entries()) {
			// skip both ambiguous and solved tiles
			if (value !== this.UNSOLVED || marked[index] === this.AMBIGUOUS) continue;
			const cell = this.getCell(index);
			if (cell.possible.size < minPossibleSize) {
				guessIndex = index;
				minPossibleSize = cell.possible.size;
				if (minPossibleSize === 2) {
					break;
				}
			}
		}
		if (guessIndex === -1) {
			// can't guess because only amb tiles are left
			return [-1, 0];
		}
		const cell = this.getCell(guessIndex);
		if (cell === undefined) {
			throw 'Cell selected for guessing is undefined!';
		}
		const [[rotation, layers]] = cell.possible.entries();
		cell.possible = new Map([[rotation, layers]]);
		this.dirty.add(guessIndex);
		return [guessIndex, rotation];
	}

	/**
	 * Creates a copy of the solver.
	 * Copies components data and solution eagerly,
	 * getCell puts things in unsolved lazily
	 * @returns {LayeredSolver}
	 */
	clone() {
		const clone = new LayeredSolver(this.tiles, this.grid, this);
		return clone;
	}

	/**
	 * Check orientations of unsolved cells to see if they produce contradictions quickly
	 * Returns true if solver manages to exclude some orientation, false otherwise
	 * @param {Number[]} marked
	 * @returns {boolean}
	 */
	doShortTrials(marked = []) {
		const tested = new Set();
		for (let i = this.shortTrialsIndex; i < this.shortTrialsIndex + this.grid.total; i++) {
			const index = i % this.grid.total;
			if (this.solution[index] !== this.UNSOLVED) continue;
			if (marked[index] === this.AMBIGUOUS) continue;
			const cell = this.getCell(index);
			for (let [rotation, layers] of cell.possible) {
				const key = `${index}_${rotation}`;
				if (tested.has(key)) {
					continue;
				}
				const clone = this.clone();
				this.stats.shortTrials += 1;
				const cloneCell = clone.getCell(index);
				cloneCell.possible = new Map([[rotation, layers]]);
				clone.dirty.add(index);
				try {
					for (let step of clone.processDirtyCells()) {
						if (step.final) {
							const key = `${step.index}_${step.rotation}`;
							tested.add(key);
						}
					}
				} catch (e) {
					cell.possible.delete(rotation);
					this.dirty.add(index);
					this.shortTrialsIndex = index;
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Solve the puzzle
	 * @param {boolean} allSolutions = false, whether to find all solutions.
	 * If false then stops as soon as the first one is found
	 * @yields {{stage:{SolvingStage}, step:{LayeredStep}}}
	 */
	*solve(allSolutions = false) {
		// Initial processing, touches every cell
		for (let step of this.processInitialDeductions()) {
			yield { stage: /** @type {SolvingStage} */ ('initial'), step };
		}
		// time to guess and check
		let iter = 0;
		/** @type {{index: Number, guess: Number, solver: LayeredSolver}[]} */
		const trials = [{ index: -1, guess: -1, solver: this }];
		while (trials.length > 0) {
			iter += 1;
			this.stats.iterations += 1;
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) break;
			const { index, guess, solver } = lastTrial;
			try {
				let stage = trials.length === 1 ? 'initial' : 'guess';
				stage = this.solutions.length === 0 ? stage : 'aftercheck';
				for (let step of solver.processDirtyCells()) {
					yield { stage, step };
				}
			} catch (error) {
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const cell = parent.unsolved.get(index);
					cell?.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			}
			if (solver.totalUnsolved === 0) {
				// got a solution
				this.solutions.push([...solver.solution]);
				if (!allSolutions) {
					break;
				}
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const cell = parent.getCell(index);
					cell.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			} else {
				// guess again
				const clone = solver.clone();
				this.stats.trialClones += 1;
				const [index, rotation] = clone.makeAGuess();
				trials.push({
					index,
					guess: rotation,
					solver: clone
				});
			}
		}
		// we rely on `this.solution` to check for solved cells, so assign this only at the end
		if (this.solutions.length > 0) {
			this.solution = this.solutions[0];
		}
	}

	/**
	 * Solve the puzzle but mark ambiguous areas with a special value
	 * Does not yield steps
	 * If the solution is unique then marked == solution
	 * @param {Number} [ambiguousTilesLimit = 0] - return if we find at least this many ambiguous tiles. Not all ambiguous tiles may be marked in this case. Default 0 means no limit, find all ambiguities.
	 * @returns {{
	 * 	marked: Number[],
	 *  solvable: boolean,
	 * 	unique: boolean,
	 *  numAmbiguous: Number
	 * }} - marked tiles, whether a puzzle is solvable, whether the solution is unique, number of ambiguous tiles
	 */
	markAmbiguousTiles(ambiguousTilesLimit = 0) {
		let marked = [...this.solution];
		let unique = true;
		let numAmbiguous = 0;
		const total = this.grid.total - this.grid.emptyCells.size;
		// process what we can for a start
		try {
			// Initial processing, touches every cell
			for (let step of this.processInitialDeductions()) {
				if (step.final) {
					marked[step.index] = step.rotation;
				}
			}
		} catch (error) {
			return { marked, solvable: false, unique: false, numAmbiguous };
		}

		/** @type {{index: Number, guess: Number, solver:LayeredSolver}[]} */
		const trials = [{ index: -1, guess: -1, solver: this }];
		let iter = 0;
		while (trials.length > 0) {
			iter += 1;
			this.stats.iterations += 1;
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) break;
			const { index, guess, solver } = lastTrial;
			this.progress_callback({
				total,
				ambiguous: numAmbiguous,
				guessed: trials.length - 1,
				solved: total - this.totalUnsolved
			});
			try {
				for (let _ of solver.processDirtyCells()) {
				}
				if (trials.length === 1 && solver.doShortTrials()) {
					continue;
				}
			} catch (error) {
				// something went wrong, no solution here
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const cell = parent.getCell(index);
					cell?.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			}
			if (solver.totalUnsolved === 0) {
				// got a solution
				numAmbiguous = 0;
				for (let i = 0; i < marked.length; i++) {
					if (marked[i] === this.AMBIGUOUS) {
						numAmbiguous += 1;
					} else if (marked[i] === this.UNSOLVED) {
						marked[i] = solver.solution[i];
					} else if (marked[i] !== solver.solution[i]) {
						marked[i] = this.AMBIGUOUS;
						unique = false;
						numAmbiguous += 1;
					}
				}
				if (ambiguousTilesLimit > 0 && numAmbiguous >= ambiguousTilesLimit) {
					this.progress_callback({
						total,
						ambiguous: numAmbiguous,
						guessed: trials.length - 1,
						solved:
							trials.length === 1 ? total - numAmbiguous : total - trials[0].solver.totalUnsolved
					});
					return { marked, solvable: true, unique, numAmbiguous };
				}
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const cell = parent.getCell(index);
					cell.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			} else {
				// guess again
				const clone = solver.clone();
				this.stats.trialClones += 1;
				const [index, rotation] = clone.makeAGuess(marked);
				if (index === -1) {
					// This means all potential guesses are in already ambiguous tiles.
					// But this solver may have different rotations in its solved cells
					// so we pretend it's solved and send it to the solution comparison branch.
					// This sometimes causes overcounting of further ambiguous tiles
					// once the first set of them is found.
					// The false positives never affect the `unique` result since they can only
					// appear after the first set of ambiguous tiles is found.
					// Completing a full search instead is much more computationally intensive, so here
					// we explicitly prefer a slightly wrong but fast result.
					// Potential experiment - try undercounting instead, just pop the trial here.
					solver.totalUnsolved = 0;
					continue;
				}
				trials.push({
					index,
					guess: rotation,
					solver: clone
				});
			}
		}
		const solvable = marked.every((tile) => tile !== this.UNSOLVED);
		this.progress_callback({
			total,
			ambiguous: numAmbiguous,
			guessed: 0,
			solved: total - numAmbiguous
		});
		return { marked, solvable, unique, numAmbiguous };
	}
}
