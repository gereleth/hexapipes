/* Constraint Violation Exceptions */

import { check } from 'prettier';

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
 * Component tracks connections between sub-cells
 * @typedef {Object} LayeredComponent
 * @property {Map<Number,Number>} subCells subCellId => known connection directions
 * @property {Map<Number,Number>} slots cellIndex => directions
 * @property {Number} totalSubcells
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
	 * @param {ReturnType<buildPossible>|null} possible
	 */
	constructor(layers, polygon, index, possible = null) {
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
	}
	/**
	 * Clone this cell assigning new possible states
	 * @param {ReturnType<buildPossible>} newPossible
	 * @returns {LayeredCell}
	 */
	clone(newPossible) {
		const copy = new LayeredCell(this.layers, this.polygon, this.index, newPossible);
		copy.walls = this.walls;
		copy.connections = this.connections;
		copy.neighbourDeadends = this.neighbourDeadends;
		copy.ownDeadends = this.ownDeadends;
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
	 * Which layers might answer a connection in this direction
	 * @param {Number} direction
	 */
	getAnsweringLayers(direction) {
		const answering = new Set();
		for (let [rotation, layers] of this.possible) {
			for (let [index, layer] of layers.entries()) {
				if ((layer & direction) > 0) {
					answering.add(index);
				}
			}
		}
		return answering;
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
			throw NoOrientationsPossibleException(this);
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
	/**
	 *
	 * @param {Number[][]} tiles
	 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 */
	constructor(tiles, grid) {
		this.tiles = tiles;
		this.grid = grid;
		this.progress_callback = emptyCallback;
		this.totalSubcells = 0;

		/** @type {Map<Number, LayeredCell>} */
		this.unsolved = new Map();

		/** @type {Number[]} - rotation per cell, or UNSOLVED */
		this.solution = tiles.map(() => this.UNSOLVED);

		/** @type {Number[][]} - array of found solutions */
		this.solutions = [];

		/** @type {Set<Number>} */
		this.dirty = new Set();

		/**
		 * @type {Map<Number, Map<Number, LayeredComponent>>}
		 * cell index => (direction => component)
		 */
		this.slotComponents = new Map();

		/**
		 * @type {Map<Number, LayeredComponent>}
		 * subcell index => component
		 */
		this.subcellComponents = new Map();

		this.shortTrialsIndex = 0;

		/** @type {any[][]} cells to process components for */
		this.avoidLoopQueue = [];

		/** @type {Set<LayeredComponent>} */
		this.avoidIslandQueue = new Set();
	}

	/**
	 * Sub-cell id for a layer of a cell at index
	 * @param {Number} index
	 * @param {Number} layer
	 * @returns {Number}
	 */
	idOf(index, layer) {
		return index + layer * this.grid.total;
	}

	/**
	 * Cell index and layer from a subcellId
	 * @param {Number} subcellId
	 * @returns {Number[]}
	 */
	indexLayerOf(subcellId) {
		const index = subcellId % this.grid.total;
		const layer = Math.floor(subcellId / this.grid.total);
		return [index, layer];
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
		cell = new LayeredCell(this.tiles[index], this.grid.polygon_at(index), index);
		this.unsolved.set(index, cell);
		this.doLocalDeductions(index, cell);
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
			this.dirty.add(index);
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
			this.dirty.add(index);
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

		// Add a component between them
		/**@type {LayeredComponent} */
		const component = {
			subCells: new Map(),
			slots: new Map([
				[index, direction],
				[neighbour, opposite]
			]),
			totalSubcells: 0
		};
		if (!this.slotComponents.has(index)) {
			this.slotComponents.set(index, new Map([[direction, component]]));
		} else {
			this.slotComponents.get(index)?.set(direction, component);
		}
		if (!this.slotComponents.has(neighbour)) {
			this.slotComponents.set(neighbour, new Map([[opposite, component]]));
		} else {
			this.slotComponents.get(neighbour)?.set(opposite, component);
		}
	}

	/**
	 * Return the component the cell at index would join if it connects
	 * in direction
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {LayeredComponent|undefined}
	 */
	getAnsweringComponent(index, direction) {
		// see if we have a slot in this direction
		const slotComp = this.slotComponents.get(index)?.get(direction);
		if (slotComp) return slotComp;
		// see if some subcell of ours controls this direction
		// do we need this? or do callers take care of not asking about known directions?

		// ask the neighbour
		const { neighbour } = this.grid.find_neighbour(index, direction);
		const opposite = this.grid.OPPOSITE.get(direction) || 0;
		const neighbourCell = this.getCell(neighbour);
		const answering = neighbourCell.getAnsweringLayers(opposite);
		// console.log('neighbour', neighbour, 'direction', opposite, 'answering', answering);
		if (answering && answering.size === 1) {
			const [layerIndex] = answering;
			const subcellId = this.idOf(neighbour, layerIndex);
			// console.log(subcellId, this.subcellComponents);
			return this.subcellComponents.get(subcellId);
		}
		return undefined;
	}
	/**
	 * See if we can deduce any walls when a subcell joins a component
	 * @param {Number} index
	 * @param {Number} layerIndex
	 * @param {LayeredCell} cell
	 * @param {LayeredComponent} component
	 */
	avoidSubcellLoops(index, layerIndex, cell, component) {
		const subCellId = this.idOf(index, layerIndex);
		const potential = cell.getLayerPotentialConnections(layerIndex);
		const known = component.subCells.get(subCellId) || 0;
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
	 * @param {LayeredComponent} component
	 */
	avoidSlotLoops(index, component) {
		const cell = this.getCell(index);
		let directions = cell.polygon.fully_connected & ~cell.walls;
		for (let layerIndex of cell.layers.keys()) {
			const subcellId = this.idOf(index, layerIndex);
			directions &= ~(this.subcellComponents.get(subcellId)?.subCells.get(subcellId) || 0);
			// detect solved layers to avoid resurrecting neighbours
			const possible = new Set(cell.possible.values().map((layers) => layers[layerIndex]));
			if (possible.size === 1) {
				const [layer] = possible;
				directions &= ~layer;
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
		const ourSlots = this.slotComponents.get(index);
		if (ourSlots !== undefined) {
			for (let [direction, component] of ourSlots) {
				this.avoidSlotLoops(index, component);
			}
		}
		for (let layerIndex of cell.layers.keys()) {
			const subCellId = this.idOf(index, layerIndex);
			const component = this.subcellComponents.get(subCellId);
			if (component === undefined) continue;
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
		const ourSlots = this.slotComponents.get(index);
		if (ourSlots !== undefined) {
			const removedDirections = [];
			for (let [direction, component] of ourSlots) {
				const answering = cell.getAnsweringLayers(direction);
				if (answering !== undefined && answering.size === 1) {
					removedDirections.push(direction);
					const [layerIndex] = answering;
					const subCellId = this.idOf(index, layerIndex);
					const otherComponent = this.subcellComponents.get(subCellId);
					if (otherComponent === undefined) {
						this.subcellComponents.set(subCellId, component);
						// component.slots.delete(index);
						const slotsLeft = (component.slots.get(index) || 0) & ~direction;
						if (slotsLeft === 0) {
							component.slots.delete(index);
						} else {
							component.slots.set(index, slotsLeft);
						}
						component.subCells.set(subCellId, direction);
						component.totalSubcells += 1;
						// subcell joined a component - check if it has
						// any neighbours already in component
						this.avoidSubcellLoops(index, layerIndex, cell, component);
						this.avoidIslandQueue.add(component);
					} else if (otherComponent === component) {
						throw LoopDetectedException();
					} else {
						otherComponent.subCells.set(
							subCellId,
							(otherComponent.subCells.get(subCellId) || 0) | direction
						);
						this.mergeComponents(otherComponent, component, subCellId);
						this.avoidIslandQueue.add(otherComponent);
						this.avoidIslandQueue.delete(component); // so we don't process stale components later
					}
				}
			}
			removedDirections.forEach((d) => ourSlots.delete(d));
			if (ourSlots.size === 0) {
				this.slotComponents.delete(index);
			}
		}
		// for our subcells in components see if there are new definite connections to neighbours
		// and creat new slots
		for (let layerIndex of cell.layers.keys()) {
			const subCellId = this.idOf(index, layerIndex);
			const component = this.subcellComponents.get(subCellId);
			if (component === undefined) continue;
			const connections = cell.getLayerDefiniteConnections(layerIndex);
			const known = component.subCells.get(subCellId);
			if (known === undefined) throw 'Component does not have subcell that links it';
			const newDirections = connections & ~known;
			if (newDirections > 0) {
				component.subCells.set(subCellId, connections);
				for (let direction of iterate_directions(newDirections)) {
					const { neighbour } = this.grid.find_neighbour(index, direction);
					const opposite = this.grid.OPPOSITE.get(direction) || 0;
					let neighbourSlots = this.slotComponents.get(neighbour);
					if (neighbourSlots === undefined) {
						neighbourSlots = new Map();
						this.slotComponents.set(neighbour, neighbourSlots);
					}
					const otherComponent = neighbourSlots.get(opposite);
					if (otherComponent === undefined) {
						neighbourSlots.set(opposite, component);
						component.slots.set(neighbour, (component.slots.get(neighbour) || 0) | opposite);
						this.avoidIslandQueue.add(component);
						this.avoidSlotLoops(index, component);
					} else if (otherComponent === component) {
						throw LoopDetectedException();
					} else {
						this.mergeComponents(component, otherComponent, subCellId);
						this.avoidIslandQueue.add(component);
						this.avoidIslandQueue.delete(otherComponent); // so we don't process stale entries later
					}
				}
			}
			if (popcount(connections) === cell.layerPopcounts[layerIndex]) {
				component.subCells.delete(subCellId);
				this.subcellComponents.delete(subCellId);
			}
		}
		this.pruneLoop(index, cell);
	}

	/**
	 * Merge components after a slot and a subcell connect in cell at index
	 * @param {LayeredComponent} subcellComponent
	 * @param {LayeredComponent} slotComponent
	 * @param {Number} subCellId
	 */
	mergeComponents(subcellComponent, slotComponent, subCellId) {
		const index = subCellId % this.grid.total;
		const subCellDirections = subcellComponent.subCells.get(subCellId) || 0;
		const slotDirections = slotComponent.slots.get(index) || 0;
		const slotsLeft = slotDirections & ~subCellDirections;
		if (
			subCellDirections === 0 ||
			slotDirections === 0 ||
			(slotDirections & subCellDirections) === 0
		) {
			throw 'Invalid merge';
		}
		if (slotsLeft === 0) {
			slotComponent.slots.delete(index);
		} else {
			slotComponent.slots.set(index, slotsLeft);
		}
		subcellComponent.totalSubcells += slotComponent.totalSubcells;
		for (let [joinIndex, directions] of slotComponent.slots) {
			subcellComponent.slots.set(
				joinIndex,
				(subcellComponent.slots.get(joinIndex) || 0) | directions
			);
			for (let direction of iterate_directions(directions)) {
				this.slotComponents.get(joinIndex)?.set(direction, subcellComponent);
			}
			this.avoidSlotLoops(joinIndex, subcellComponent);
		}
		for (let [joinSubCellId, connections] of slotComponent.subCells) {
			subcellComponent.subCells.set(joinSubCellId, connections);
			this.subcellComponents.set(joinSubCellId, subcellComponent);
			const [joinIndex, joinLayer] = this.indexLayerOf(joinSubCellId);
			this.avoidSubcellLoops(joinIndex, joinLayer, this.getCell(joinIndex), subcellComponent);
		}
	}

	/**
	 * Process new info on a single cell and propagate constraints
	 * @param {Number} index
	 * @returns {LayeredStep}
	 * @throws {NoOrientationsPossibleException|IslandDetectedException|LoopDetectedException}
	 */
	processDirtyCell(index) {
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
			this.avoidLoopQueue = [];

			for (let component of this.avoidIslandQueue) {
				if (
					component.slots.size === 0 &&
					component.subCells.size === 0 &&
					component.totalSubcells < this.totalSubcells
				) {
					throw new IslandDetectedException();
				} else if (component.slots.size === 1 && component.subCells.size === 0) {
					const [[islandCell, islandConnections]] = component.slots.entries();
					if (popcount(islandConnections) === 1) {
						const c = this.getCell(islandCell);
						const deadendsBefore = c.neighbourDeadends;
						// override weight because component size is exact at this point
						c.addNeighbourDeadend(islandConnections, 0);
						c.neighbourDeadendWeights.set(islandConnections, component.totalSubcells);
						if (c.neighbourDeadends !== deadendsBefore) {
							this.dirty.add(islandCell);
						}
					}
					// 2+ island connections into the same cell should be handled differently.
					// It's enough for one strand to escape, so sealing one connection and
					// continuing another one should be valid.
					// Deadend machinery treats all deadends as independent => doesn't work for this case
					// Valid handling is not implemented yet
				} else if (component.slots.size === 0 && component.subCells.size === 1) {
					const [[islandSubCell, islandConnections]] = component.subCells.entries();
					const islandCell = islandSubCell % this.grid.total;
					const c = this.getCell(islandCell);
					const deadendsBefore = c.neighbourDeadends;
					let weight = component.totalSubcells - 1; // don't count this subcell itself
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
				this.avoidIslandQueue.clear();
			}
		}
		const final = cell.possible.size === 1;
		const [rotation] = cell.possible.keys();
		if (final) {
			this.solution[index] = rotation;
			this.unsolved.delete(index);
		}
		// console.log('end dirty step', index, [...this.dirty]);
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
	 * Solve the puzzle
	 * @param {boolean} allSolutions = false, whether to find all solutions.
	 * If false then stops as soon as the first one is found
	 * @yields {{stage:{SolvingStage}, step:{LayeredStep}}}
	 */
	*solve(allSolutions = false) {
		// Initial processing
		for (let step of this.processInitialDeductions()) {
			yield { stage: /** @type {SolvingStage} */ ('initial'), step };
		}
		// time to guess and check
	}
}
