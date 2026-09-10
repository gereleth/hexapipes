/* Constraint Violation Exceptions */

/**
 * A cell has no more viable pictures (rotation states)
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
 * @property {Number} cell
 * @property {Number} rotation - representative rotation of the picture
 * @property {Boolean} final - true if this picture is the only one left
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
 * Counts set bits in a bitmask
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
 * Returns a canonical id for a picture: the sorted list of layer masks.
 * Rotations of a cell that draw the same picture (same multiset of
 * per-layer masks) share an id, mirroring how the classic solver
 * deduplicates orientation bitmasks.
 * @param {Number[]} masks - rotated layer masks
 * @returns {String}
 */
function pictureId(masks) {
	const sorted = [...masks].sort((a, b) => a - b);
	return sorted.join('-') || '0';
}

/**
 * Builds the possible states of a cell: map of rotation
 * to the rotated layers at that rotation
 * States are deduplicated
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
		const id = pictureId(masks);
		if (!seen.has(id)) {
			seen.add(id);
			possible.set(rotation, masks);
		}
	}
	return possible;
}

/**
 * Constraint state for a single grid cell of a layered puzzle.
 * The decision variable is the cell rotation (all layers rotate together),
 * so the possible states are pictures: equivalence classes of rotations
 * that produce the same multiset of layer masks.
 * Walls/connections are direction bitmask facts, same as in the classic solver.
 * @constructor
 * @param {Number[]} layers - layer bitmasks at rotation 0
 * @param {import('$lib/puzzle/grids/polygonutils').RegularPolygonTile} polygon
 * @param {Number} [index = -1] - grid cell index, only used for error messages
 */
export function LayeredCell(layers, polygon, index = -1) {
	let self = this;
	self.index = index;
	self.layers = layers;
	self.polygon = polygon;

	/** @type {Map<Number, Number[]>} rotation => layers at that rotation */
	self.possible = buildPossible(layers, polygon);
	self.walls = 0;
	self.connections = 0;
	/**
	 * Directions d such that every surviving picture connecting in direction d
	 * does so via a single-connection (deadend) layer. Derived fact, re-computed
	 * from scratch on every applyConstraints pass: the property depends on HOW
	 * a direction is used, not just whether, so the mask is not monotone under
	 * picture set replacement. Bit is meaningful only for directions that some
	 * surviving picture actually uses.
	 * @type {Number}
	 */
	self.deadends = 0;
	/** Static: whether any layer of this cell is a deadend layer. Cells
	 * without deadend layers can never have a deadends bit, which lets the
	 * derivation (and neighbour-side pair checks) skip them entirely.
	 * @type {Boolean} */
	self.hasDeadends = layers.some((x) => popcount(x) === 1);
	self.layerPopcounts = layers.map((x) => popcount(x));

	/**
	 * Union of all layer masks at a rotation
	 * @param {Number} rotation
	 * @returns {Number}
	 */
	self.unionAt = function (rotation) {
		let union = 0;
		for (let layer of self.possible.get(rotation) || []) {
			union |= layer;
		}
		return union;
	};

	/**
	 * @param {Number} direction
	 */
	self.addWall = function (direction) {
		self.walls += direction - ((self.connections + self.walls) & direction);
	};

	/**
	 * @param {Number} direction
	 */
	self.addConnection = function (direction) {
		self.connections += direction - ((self.connections + self.walls) & direction);
	};

	/**
	 * Removes pictures whose union uses any of the mentioned directions
	 * @param {Number} directions
	 */
	self.mustHaveAllWalls = function (directions) {
		for (let [rotation, layers] of [...self.possible]) {
			for (let layer of layers) {
				if ((layer & directions) > 0) {
					self.possible.delete(rotation);
					break;
				}
			}
		}
	};

	/**
	 * Removes pictures that only connect the mentioned directions
	 * @param {Number} directions
	 * @returns {Boolean} - true if removed some pictures
	 */
	self.mustHaveOtherConnections = function (directions) {
		let removed = false;
		for (let [rotation, _] of [...self.possible]) {
			const union = self.unionAt(rotation);
			if (union !== 0 && (union & directions) === union) {
				self.possible.delete(rotation);
				removed = true;
			}
		}
		return removed;
	};

	/**
	 * Filters out pictures that contradict known constraints
	 * @throws {NoOrientationsPossible}
	 * @returns {{addedWalls:Number, addedConnections: Number, addedDeadends: Number}}
	 */
	self.applyConstraints = function () {
		const full = polygon.fully_connected;
		const newPossible = new Map();
		let newWalls = full;
		let newConnections = full;
		// cells without deadend layers can never have a deadend direction
		let newDeadends = self.hasDeadends ? full : 0;
		for (let [rotation, layers] of self.possible) {
			const union = self.unionAt(rotation);
			if (
				// respects known walls
				(union & self.walls) !== 0 ||
				// respects known connections if any
				(union & self.connections) !== self.connections
			) {
				continue;
			}
			newPossible.set(rotation, layers);
			newWalls = newWalls & (full - union);
			newConnections = newConnections & union;
			if (self.hasDeadends) {
				layers.forEach((layer, index) => {
					if (self.layerPopcounts[index] > 1) {
						newDeadends &= full - layer;
					}
				});
			}
		}
		self.possible = newPossible;
		if (newPossible.size === 0) {
			throw new NoOrientationsPossibleException(self);
		}
		// restrict the mask to directions some surviving picture actually uses
		newDeadends &= full - newWalls;
		const addedWalls = newWalls - self.walls;
		const addedConnections = newConnections - self.connections;
		// unlike walls and connections, the deadends mask is not monotone
		// (the property depends on HOW a direction is used, not just whether):
		// replacing the picture set (short trial probes) can remove bits, so
		// the delta must be a proper bit intersection, not numeric subtraction
		const addedDeadends = newDeadends & (full ^ self.deadends);
		self.walls = newWalls;
		self.connections = newConnections;
		self.deadends = newDeadends;
		return { addedWalls, addedConnections, addedDeadends };
	};

	/**
	 * Finds a layer whose mask at the given rotation contains the direction
	 * @param {Number} rotation
	 * @param {Number} direction
	 * @returns {Number} - layer number or -1 if there is no such layer
	 */
	self.findLayerWithDirection = function (rotation, direction) {
		const layers = self.possible.get(rotation) || [];
		for (let index = 0; index < layers.length; index++) {
			if ((layers[index] & direction) > 0) {
				return index;
			}
		}
		return -1;
	};

	/**
	 * Removes pictures that connect `direction` via a single-connection layer.
	 * Called when the neighbour across `direction` can only answer with a
	 * deadend itself: two facing deadend sub-cells would be sealed off from
	 * the rest of the tree.
	 * @param {Number} direction
	 * @returns {Number} - how many pictures were removed
	 */
	self.removeDeadendPairs = function (direction) {
		if (!self.hasDeadends) {
			return 0;
		}
		let removed = 0;
		for (let [rotation, layers] of [...self.possible]) {
			if (layers.some((layer) => layer === direction)) {
				self.possible.delete(rotation);
				removed += 1;
			}
		}
		return removed;
	};

	/**
	 * Returns a copy of the cell
	 * @returns {LayeredCell}
	 */
	self.clone = function () {
		const clone = new LayeredCell(layers, polygon, index);
		clone.possible = new Map(self.possible);
		clone.walls = self.walls;
		clone.connections = self.connections;
		clone.deadends = self.deadends;
		return clone;
	};

	return self;
}

const emptyCallback = (/**@type {SolverProgress} */ progress) => {};

/**
 * Solver for layered pipes puzzles.
 * Mirrors the classic Solver, but the state of a cell is its rotation
 * (represented by picture equivalence classes) instead of a tile bitmask.
 * The tree constraint is tracked over sub-cells (cell + layer): when a cell
 * pins down to a single picture, its sub-cell edges become definitive and
 * get merged in a union-find structure; closing a loop or leaving the
 * solved board disconnected raises an exception.
 * @constructor
 * @param {Number[][]} tiles - layered tiles: per cell a list of layer bitmasks
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 */
export function LayeredSolver(tiles, grid) {
	let self = this;
	self.tiles = tiles;
	self.grid = grid;
	self.progress_callback = emptyCallback;

	self.UNSOLVED = -1;
	self.AMBIGUOUS = -2;

	/** @type {Map<Number, LayeredCell>} */
	self.unsolved = new Map([]);

	/**
	 * sub-cell id => set of sub-cell ids of its component.
	 * Only sub-cells of pinned cells participate.
	 * @type {Map<Number, Set<Number>>}
	 */
	self.components = new Map([]);

	/**
	 * cell => pinned links of an unpinned cell, by the cell's own direction:
	 * where pinned neighbours connect into this cell, with the answering
	 * sub-cell on the pinned side and its frozen layer mask. Recorded when
	 * a neighbour pins down, resolved when this cell pins down, and read in
	 * between to prune candidate pictures against pinned components.
	 * @type {Map<Number, Map<Number, {fromId: Number, mask: Number}>>}
	 */
	self.linked = new Map([]);

	/** @type {Number[]} - rotation per cell, or UNSOLVED */
	self.solution = tiles.map(() => self.UNSOLVED);

	/** @type {Number[][]} - rotations of found solutions */
	self.solutions = [];

	/** @type {Set<Number>} */
	self.dirty = new Set([]);

	/**
	 * Counters of search work, shared with all clones (see clone) so that
	 * totals accumulate across the whole trial tree of one solve run
	 * @type {{iterations: Number, trialClones: Number, shortTrials: Number, dirtyProcessings: Number, prunedPictures: Number}}
	 */
	self.stats = {
		iterations: 0,
		trialClones: 0,
		shortTrials: 0,
		dirtyProcessings: 0,
		prunedPictures: 0
	};

	// ruling out orientations connecting only deadends messes up
	// solving very small instances
	// so it's only enabled if there's enough tiles
	self.checkDeadendConnections =
		self.grid.total - self.grid.emptyCells.size > self.grid.DIRECTIONS.length + 1;

	self.shortTrialsIndex = 0;

	// Every complete assignment has the same number of edges: half the
	// total number of layer direction bits (popcounts are rotation invariant).
	// Edges committed by pinned cells (internal + pending) are irreversible,
	// so they can never exceed this budget.
	self.totalSubCells = 0;
	self.totalEdges = 0;
	for (let cellLayers of tiles) {
		self.totalSubCells += cellLayers.length;
		for (let layer of cellLayers) {
			self.totalEdges += popcount(layer);
		}
	}
	self.totalEdges = self.totalEdges / 2;
	self.internalEdges = 0;
	self.pendingCount = 0;

	/**
	 * Sub-cell id for a layer of a cell
	 * @param {Number} cell
	 * @param {Number} layer
	 * @returns {Number}
	 */
	self.idOf = function (cell, layer) {
		return cell + layer * self.grid.total;
	};

	/**
	 * Returns the cell at index. Initializes the cell if necessary.
	 * @param {Number} index
	 * @returns {LayeredCell}
	 */
	self.getCell = function (index) {
		let cell = self.unsolved.get(index);
		if (cell !== undefined) {
			return cell;
		}
		cell = new LayeredCell(self.tiles[index], self.grid.polygon_at(index), index);
		self.unsolved.set(index, cell);
		self.doLocalDeductions(index, cell);
		return cell;
	};

	/**
	 * Merges the components of two sub-cells
	 * @param {Number} a - sub-cell id
	 * @param {Number} b - sub-cell id
	 * @throws {LoopDetected}
	 */
	self.unionSubCells = function (a, b) {
		const componentA = self.components.get(a);
		const componentB = self.components.get(b);
		if (componentA === undefined || componentB === undefined) {
			throw `Component data missing for sub-cells ${a}, ${b}`;
		}
		if (componentA === componentB) {
			throw new LoopDetectedException();
		}
		self.internalEdges += 1;
		const source = componentA.size > componentB.size ? componentB : componentA;
		const target = source === componentA ? componentB : componentA;
		for (let id of source) {
			self.components.set(id, target);
			target.add(id);
		}
	};

	/**
	 * Registers the definitive sub-cell edges of a cell that just pinned down.
	 * Edges to still unpinned neighbours are stored as pending links and get
	 * merged when the neighbour pins down; edges between two pinned cells are
	 * always resolved exactly once, at the pin of the later of the two.
	 * @param {Number} cell
	 * @param {LayeredCell} cellObj
	 * @throws {LoopDetected} when a definitive edge closes a loop
	 */
	self.pinCell = function (cell, cellObj) {
		const [rotation, layers] = cellObj.possible.entries().next().value || [0, []];
		const polygon = self.grid.polygon_at(cell);
		const numLayers = layers.length;
		for (let layer = 0; layer < numLayers; layer++) {
			const id = self.idOf(cell, layer);
			if (!self.components.has(id)) {
				self.components.set(id, new Set([id]));
			}
		}
		const linked = self.linked.get(cell);
		if (linked !== undefined) {
			self.linked.delete(cell);
			self.pendingCount -= linked.size;
			// the key is this cell's direction towards the pinned neighbour
			for (let [direction, { fromId }] of linked) {
				const backLayer = cellObj.findLayerWithDirection(rotation, direction);
				if (backLayer === -1) {
					throw `Pinned tiles ${fromId} and ${cell} do not match`;
				}
				self.unionSubCells(fromId, self.idOf(cell, backLayer));
			}
		}
		for (let [index, layer] of layers.entries()) {
			const fromId = self.idOf(cell, index);
			let bits = layer;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
				if (empty) {
					throw 'Trying to connect to an empty neighbour!';
				}
				if (self.unsolved.has(neighbour)) {
					let neighboursLinks = self.linked.get(neighbour);
					if (neighboursLinks === undefined) {
						neighboursLinks = new Map([]);
						self.linked.set(neighbour, neighboursLinks);
					}
					// at most one layer may use any direction, so the key is unique
					neighboursLinks.set(self.grid.OPPOSITE.get(direction) || 0, { fromId, mask: layer });
					self.pendingCount += 1;
				}
			}
		}
		if (self.internalEdges + self.pendingCount > self.totalEdges) {
			// too many edges committed, the final graph would contain a cycle
			throw new LoopDetectedException();
		}
		self.checkForIslands();
		// neighbours may have pictures that are now definitively contradicted
		// even when no wall/connection facts changed
		for (let direction of polygon.directions) {
			const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
			if (!empty && self.unsolved.has(neighbour)) {
				self.dirty.add(neighbour);
			}
		}
	};

	/**
	 * Checks that all sub-cells ended up in a single component
	 * @throws {IslandDetected}
	 */
	self.checkAllConnected = function () {
		let component = undefined;
		for (let set of self.components.values()) {
			if (component === undefined) {
				component = set;
			} else if (set !== component) {
				throw new IslandDetectedException();
			}
		}
	};

	/**
	 * Checks that no component of pinned sub-cells is sealed off:
	 * a component without pending links to unpinned cells can never
	 * connect to the rest of the board
	 * @throws {IslandDetected}
	 */
	self.checkForIslands = function () {
		if (self.unsolved.size === 0) {
			return;
		}
		/** @type {Set<Set<Number>>} */
		const withPending = new Set([]);
		for (let links of self.linked.values()) {
			for (let { fromId } of links.values()) {
				const component = self.components.get(fromId);
				if (component !== undefined) {
					withPending.add(component);
				}
			}
		}
		for (let component of self.components.values()) {
			if (!withPending.has(component)) {
				throw new IslandDetectedException();
			}
		}
	};

	/**
	 * Removes pictures that definitively contradict pinned structure:
	 * a single layer connecting into the same pinned component twice
	 * (a definite cycle) can never be part of a solution
	 * @param {Number} cell
	 * @param {LayeredCell} cellObj
	 * @returns {Boolean} - true if some pictures were removed
	 */
	self.pruneContradictoryPictures = function (cell, cellObj) {
		if (cellObj.possible.size <= 1) {
			return false;
		}
		const links = self.linked.get(cell);
		let removed = false;
		for (let [rotation, layers] of [...cellObj.possible]) {
			let bad = false;
			for (let layer = 0; layer < cellObj.layers.length && !bad; layer++) {
				const mask = layers[layer];
				/** @type {Set<Set<Number>>} */
				const layerComponents = new Set([]);
				let bits = mask;
				while (bits > 0 && !bad) {
					const direction = bits & -bits;
					bits ^= direction;
					const link = links?.get(direction);
					if (link === undefined) {
						continue;
					}
					const component = self.components.get(link.fromId);
					if (component === undefined) {
						throw `Component data missing for pinned link at cell ${cell}`;
					}
					if (layerComponents.has(component)) {
						bad = true;
						break;
					}
					layerComponents.add(component);
				}
			}
			if (bad) {
				cellObj.possible.delete(rotation);
				self.stats.prunedPictures += 1;
				removed = true;
			}
		}
		return removed;
	};

	/**
	 * Checks if any pictures can be ruled out based on immediate neighbours
	 * @param {Number} index
	 * @param {LayeredCell} cell - cell at index
	 */
	self.doLocalDeductions = function (index, cell) {
		if (cell.possible.size === 1) {
			// either empty or fully connected, is solved right away
			self.dirty.add(index);
			return;
		}
		const polygon = self.grid.polygon_at(index);
		const possibleBefore = cell.possible.size;
		const full = polygon.fully_connected;

		let walls = 0;
		let invalidDirections = 0;
		for (let direction of polygon.directions) {
			if ((full & direction) === 0) {
				// invalid direction that should be disregarded
				invalidDirections += direction;
				continue;
			}
			const { neighbour, empty } = self.grid.find_neighbour(index, direction);
			if (empty) {
				walls += direction;
			}
		}
		// remove pictures that contradict outer walls
		if (walls > 0) {
			cell.addWall(walls);
			cell.mustHaveAllWalls(walls);
		}
		if (invalidDirections > 0) {
			cell.mustHaveAllWalls(invalidDirections);
		}
		if (cell.possible.size < possibleBefore) {
			// deduced something...
			self.dirty.add(index);
		}
	};

	/**
	 * Process new info on cells
	 * Removes pictures that contradict known constraints
	 * Creates new walls/connections if remaining pictures require them
	 * @yields {LayeredStep} - info about the processed cell
	 */
	self.processDirtyCells = function* () {
		while (self.dirty.size > 0) {
			self.stats.dirtyProcessings += 1;
			// get a dirty cell
			const [cell] = self.dirty;
			const cellObj = self.getCell(cell);
			const polygon = self.grid.polygon_at(cell);
			// apply constraints and prune until the picture set is stable,
			// propagating every newly implied wall/connection right away
			/** @type {{addedWalls: Number, addedConnections: Number, addedDeadends: Number}} */
			let deltas = { addedWalls: 0, addedConnections: 0, addedDeadends: 0 };
			for (;;) {
				deltas = cellObj.applyConstraints();
				// add walls to walled off neighbours
				if (deltas.addedWalls > 0) {
					for (let direction of polygon.directions) {
						if ((direction & deltas.addedWalls) > 0) {
							const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
							if (empty) {
								continue;
							}
							const opposite = self.grid.OPPOSITE.get(direction) || 0;
							const neighbourCell = self.getCell(neighbour);
							neighbourCell.addWall(opposite);
							self.dirty.add(neighbour);
						}
					}
				}
				// add connections to connected neighbours
				if (deltas.addedConnections > 0) {
					for (let direction of polygon.directions) {
						if ((direction & deltas.addedConnections) > 0) {
							const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
							if (empty) {
								throw 'Trying to connect to an empty neighbour!';
							}
							const opposite = self.grid.OPPOSITE.get(direction) || 0;
							const neighbourCell = self.getCell(neighbour);
							neighbourCell.addConnection(opposite);
							self.dirty.add(neighbour);
						}
					}
				}
				// neighbours must not answer a deadend with a deadend: two facing
				// single-connection sub-cells would be sealed off from the tree.
				// Same board-size gate as the classic deadend rule: on tiny boards
				// the sealed pair could be the entire puzzle
				if (self.checkDeadendConnections && deltas.addedDeadends > 0) {
					const links = self.linked.get(cell);
					for (let direction of polygon.directions) {
						if ((direction & deltas.addedDeadends) > 0) {
							const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
							if (empty) {
								continue;
							}
							const opposite = self.grid.OPPOSITE.get(direction) || 0;
							const link = links?.get(direction);
							if (link !== undefined) {
								// the pinned neighbour can not lose pictures:
								// if it answers with a deadend, this cell must not
								// connect here with a deadend at all
								if (link.mask === opposite) {
									cellObj.addWall(direction);
									self.dirty.add(cell);
								}
								continue;
							}
							// no link means the neighbour is not pinned yet:
							// a pinned neighbour with a wall here would have pushed
							// the wall into this cell, ruling the deadend fact out
							const neighbourCell = self.getCell(neighbour);
							const removed = neighbourCell.removeDeadendPairs(opposite);
							self.stats.prunedPictures += removed;
							if (removed > 0) {
								self.dirty.add(neighbour);
							}
						}
					}
				}
				// rule out pictures definitively contradicted by pinned neighbours
				if (!self.pruneContradictoryPictures(cell, cellObj)) {
					break;
				}
			}
			// check if cell is solved
			const [rotation, layers] = cellObj.possible.entries().next().value || [0, []];
			const final = cellObj.possible.size === 1;
			if (final) {
				self.unsolved.delete(cell);
				self.pinCell(cell, cellObj);
				self.solution[cell] = rotation;
				if (self.unsolved.size === 0) {
					self.checkAllConnected();
				}
			}
			yield { cell, rotation, final };
			self.dirty.delete(cell);
		}
	};

	/**
	 * Processes border walls and other local deductions for all cells
	 * @yields {LayeredStep}
	 */
	self.processInitialDeductions = function* () {
		if (self.dirty.size > 0) {
			return;
		}
		const toInit = new Set();
		// process empty cells first, then the rest
		for (let cell = 0; cell < self.grid.total; cell++) {
			if (self.grid.emptyCells.has(cell)) {
				self.dirty.add(cell);
			} else {
				toInit.add(cell);
			}
		}
		while (toInit.size > 0) {
			const nextCell = toInit.values().next().value;
			toInit.delete(nextCell);
			if (self.unsolved.has(nextCell)) {
				continue;
			}
			self.dirty.add(nextCell);
			for (let step of self.processDirtyCells()) {
				toInit.delete(step.cell);
				if (self.tiles[step.cell].length === 0) {
					// don't report processing empty cell as a step
					continue;
				}
				yield step;
			}
		}
	};

	/**
	 * Makes a copy of the solver
	 * @return {LayeredSolver}
	 */
	self.clone = function () {
		const clone = new LayeredSolver([], self.grid);
		clone.checkDeadendConnections = self.checkDeadendConnections;
		clone.shortTrialsIndex = self.shortTrialsIndex;
		clone.totalSubCells = self.totalSubCells;
		clone.totalEdges = self.totalEdges;
		clone.internalEdges = self.internalEdges;
		clone.pendingCount = self.pendingCount;
		clone.unsolved = new Map([]);
		self.unsolved.forEach((cell, index) => {
			clone.unsolved.set(index, cell.clone());
		});
		clone.components = new Map([]);
		/** @type {Map<Set<Number>, Set<Number>>} */
		const clonedSets = new Map([]);
		self.components.forEach((set, id) => {
			let clonedSet = clonedSets.get(set);
			if (clonedSet === undefined) {
				clonedSet = new Set([]);
				clonedSets.set(set, clonedSet);
			}
			clone.components.set(id, clonedSet);
		});
		self.components.forEach((set, id) => {
			const clonedSet = /** @type {Set<Number>} */ (clonedSets.get(set));
			for (let element of set) {
				clonedSet.add(element);
			}
		});
		clone.linked = new Map([]);
		self.linked.forEach((links, cell) => {
			// entries are immutable, sharing them between clones is safe
			clone.linked.set(cell, new Map(links));
		});
		clone.solution = [...self.solution];
		clone.solutions = self.solutions.map((solution) => [...solution]);
		clone.dirty = new Set();
		// clones must accumulate their work on the root solver's counters
		clone.stats = self.stats;
		return clone;
	};

	/**
	 * Chooses a cell/picture to try out.
	 * Selects a picture from a cell with the least number of options,
	 * taking its first candidate state
	 * @returns {Number[]} - [cell, rotation]
	 */
	self.makeAGuess = function () {
		let guessCell = -1;
		let minPossibleSize = Number.POSITIVE_INFINITY;
		for (let [cell, cellObj] of self.unsolved.entries()) {
			if (cellObj.possible.size < minPossibleSize) {
				minPossibleSize = cellObj.possible.size;
				guessCell = cell;
				if (minPossibleSize == 2) {
					break;
				}
			}
		}
		const cellObj = self.unsolved.get(guessCell);
		if (cellObj === undefined) {
			throw 'Cell selected for guessing is undefined!';
		}
		const [guessRotation, guessLayers] = cellObj.possible.entries().next().value || [0, []];
		const guessedPictures = new Map();
		guessedPictures.set(guessRotation, guessLayers);
		cellObj.possible = guessedPictures;
		self.dirty.add(guessCell);
		return [guessCell, guessRotation];
	};

	/**
	 * Solve the puzzle
	 * @param {boolean} allSolutions = false, whether to find all solutions.
	 * If false then stops as soon as the first one is found
	 * @yields {{stage:{SolvingStage}, step:{LayeredStep}}}
	 */
	self.solve = function* (allSolutions = false) {
		for (let step of self.processInitialDeductions()) {
			yield { stage: /** @type {SolvingStage} */ ('initial'), step };
		}

		/** @type {{cell: Number, guess: Number, solver:LayeredSolver}[]} */
		const trials = [{ cell: -1, guess: -1, solver: self }];
		while (trials.length > 0) {
			self.stats.iterations += 1;
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) {
				break;
			}
			const { cell, guess, solver } = lastTrial;
			try {
				let stage = trials.length === 1 ? 'initial' : 'guess';
				stage = self.solutions.length === 0 ? stage : 'aftercheck';
				for (let step of solver.processDirtyCells()) {
					yield { stage: /** @type {SolvingStage} */ (stage), step };
				}
			} catch (error) {
				// something went wrong, no solution here
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const parentCell = parent.unsolved.get(cell);
					parentCell?.possible.delete(guess);
					parent.dirty.add(cell);
					continue;
				} else {
					break;
				}
			}
			if (solver.unsolved.size == 0) {
				// got a solution
				self.solution = solver.solution;
				self.solutions.push([...solver.solution]);
				if (!allSolutions) {
					break;
				}
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const parentCell = parent.unsolved.get(cell);
					parentCell?.possible.delete(guess);
					parent.dirty.add(cell);
					continue;
				} else {
					break;
				}
			} else {
				// we have to make a guess
				const clone = solver.clone();
				self.stats.trialClones += 1;
				const [guessCell, guessRotation] = clone.makeAGuess();
				trials.push({
					cell: guessCell,
					guess: guessRotation,
					solver: clone
				});
			}
		}
	};

	/**
	 * Check pictures of unsolved cells to see if they produce contradictions quickly
	 * Returns true if solver manages to exclude some picture, false otherwise
	 * @param {(Number)[]} marked
	 * @returns {boolean}
	 */
	self.doShortTrials = function (marked = []) {
		const tested = new Set();
		for (let i = this.shortTrialsIndex; i < this.shortTrialsIndex + this.grid.total; i++) {
			const cell = i % this.grid.total;
			const cellObj = self.unsolved.get(cell);
			if (cellObj === undefined) {
				continue;
			}
			if (marked[cell] === this.AMBIGUOUS) {
				continue;
			}
			for (let [rotation, layers] of [...cellObj.possible]) {
				const key = `${cell}_${rotation}`;
				if (tested.has(key)) {
					continue;
				}
				const clone = self.clone();
				self.stats.shortTrials += 1;
				const cloneCell = clone.unsolved.get(cell);
				if (cloneCell === undefined) {
					throw 'Clone cell is undefined';
				}
				const probePossible = new Map();
				probePossible.set(rotation, layers);
				cloneCell.possible = probePossible;
				clone.dirty.add(cell);
				try {
					for (let step of clone.processDirtyCells()) {
						if (step.final) {
							tested.add(`${step.cell}_${step.rotation}`);
						}
					}
				} catch (e) {
					cellObj.possible.delete(rotation);
					self.dirty.add(cell);
					self.shortTrialsIndex = cell;
					return true;
				}
			}
		}
		return false;
	};

	/**
	 * Solve the puzzle but mark ambiguous areas with a special value
	 * Does not yield steps
	 * If the solution is unique then marked == solution rotations
	 * @param {Number} [ambiguousTilesLimit = 0] - return if we find at least this many ambiguous cells. Not all ambiguous cells may be marked in this case. Default 0 means no limit, find all ambiguities.
	 * @param {Number} [maxIterations = 0] - give up after this many search iterations and return complete: false. Default 0 means no limit.
	 * @returns {{
	 * 	marked: Number[],
	 *  solvable: boolean,
	 * 	unique: boolean,
	 *  numAmbiguous: Number,
	 *  complete: boolean
	 * }} - marked rotations per cell, whether a puzzle is solvable, whether the solution is unique, number of ambiguous cells, whether the search finished (a false complete means the results can not be trusted)
	 */
	self.markAmbiguousTiles = function (ambiguousTilesLimit = 0, maxIterations = 0) {
		/** @type {Number[]} */
		let marked = [...self.solution];
		let unique = true;
		let numAmbiguous = 0;
		let complete = true;
		const total = self.grid.total - self.grid.emptyCells.size;
		// process what we can for a start
		try {
			for (let step of self.processInitialDeductions()) {
				if (step.final) {
					marked[step.cell] = step.rotation;
				}
			}
		} catch (error) {
			return {
				marked,
				solvable: false,
				unique: false,
				numAmbiguous,
				complete: true
			};
		}
		/** @type {{cell: Number, guess: Number, solver:LayeredSolver}[]} */
		const trials = [{ cell: -1, guess: -1, solver: self }];
		let iterations = 0;
		while (trials.length > 0) {
			iterations += 1;
			self.stats.iterations += 1;
			if (maxIterations > 0 && iterations > maxIterations) {
				complete = false;
				// an incomplete search must never claim uniqueness
				unique = false;
				break;
			}
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) {
				break;
			}
			const { cell, guess, solver } = lastTrial;
			self.progress_callback({
				total,
				ambiguous: numAmbiguous,
				guessed: trials.length - 1,
				solved: total - trials[0].solver.unsolved.size
			});
			try {
				for (let _ of solver.processDirtyCells()) {
				}
				if (trials.length === 1 && solver.doShortTrials(marked)) {
					continue;
				}
			} catch (error) {
				// something went wrong, no solution here
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const parentCell = parent.unsolved.get(cell);
					parentCell?.possible.delete(guess);
					parent.dirty.add(cell);
					continue;
				} else {
					break;
				}
			}
			if (solver.unsolved.size == 0) {
				// got a solution
				numAmbiguous = 0;
				for (let i = 0; i < marked.length; i++) {
					if (marked[i] === self.UNSOLVED) {
						marked[i] = solver.solution[i];
					} else if (marked[i] === self.AMBIGUOUS) {
						numAmbiguous += 1;
						// do nothing
					} else if (marked[i] !== solver.solution[i]) {
						marked[i] = self.AMBIGUOUS;
						unique = false;
						numAmbiguous += 1;
					}
				}
				if (ambiguousTilesLimit > 0 && numAmbiguous >= ambiguousTilesLimit) {
					self.progress_callback({
						total,
						ambiguous: numAmbiguous,
						guessed: trials.length - 1,
						solved:
							trials.length === 1 ? total - numAmbiguous : total - trials[0].solver.unsolved.size
					});
					return {
						marked,
						solvable: true,
						unique,
						numAmbiguous,
						complete: true
					};
				}
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const parentCell = parent.unsolved.get(cell);
					parentCell?.possible.delete(guess);
					parent.dirty.add(cell);
					continue;
				} else {
					break;
				}
			} else {
				// we have to make a guess
				const clone = solver.clone();
				self.stats.trialClones += 1;

				// copypasta of makeAGuess function
				// because I want to ignore ambiguous tiles as guess candidates
				let guessCell = -1;
				let minPossibleSize = Number.POSITIVE_INFINITY;
				for (let [index, cellObj] of clone.unsolved.entries()) {
					if (marked[index] === self.AMBIGUOUS) {
						continue;
					}
					if (cellObj.possible.size < minPossibleSize) {
						minPossibleSize = cellObj.possible.size;
						guessCell = index;
						if (minPossibleSize == 2) {
							break;
						}
					}
				}
				const cellObj = clone.unsolved.get(guessCell);
				if (cellObj === undefined) {
					// can not guess because only ambiguous tiles are left
					solver.unsolved = new Map();
					continue;
				}
				const [rotation, layers] = cellObj.possible.entries().next().value || [0, []];
				const guessedPossible = new Map();
				guessedPossible.set(rotation, layers);
				cellObj.possible = guessedPossible;
				clone.dirty.add(guessCell);

				trials.push({
					cell: guessCell,
					guess: rotation,
					solver: clone
				});
			}
		}
		// an incomplete search has not proven unsolvability,
		// report solvable so that callers retry instead of giving up
		const solvable = complete ? marked.every((tile) => tile !== self.UNSOLVED) : true;
		self.progress_callback({
			total,
			ambiguous: numAmbiguous,
			guessed: 0,
			solved: total - numAmbiguous
		});
		return {
			marked,
			solvable,
			unique,
			numAmbiguous,
			complete
		};
	};
}
