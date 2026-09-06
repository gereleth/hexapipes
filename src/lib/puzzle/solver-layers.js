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
 * @property {String} id - picture id of the cell
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
 * Builds the picture table of a cell: map of picture id
 * to the smallest rotation producing that picture
 * @param {Number[]} layers - layer bitmasks at rotation 0
 * @param {import('$lib/puzzle/grids/polygonutils').RegularPolygonTile} polygon
 * @returns {Map<String, Number>}
 */
function buildPictures(layers, polygon) {
	/** @type {Map<String, Number>} */
	const pictures = new Map();
	const numDirections = polygon.num_directions;
	for (let rotation = 0; rotation < numDirections; rotation++) {
		const masks = layers.map((layer) => polygon.rotate(layer, rotation));
		const id = pictureId(masks);
		if (!pictures.has(id)) {
			pictures.set(id, rotation);
		}
	}
	return pictures;
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

	/** @type {Map<String, Number>} picture id => representative rotation */
	self.pictures = buildPictures(layers, polygon);
	self.walls = 0;
	self.connections = 0;

	/**
	 * Union of all layer masks at a rotation
	 * @param {Number} rotation
	 * @returns {Number}
	 */
	self.unionAt = function (rotation) {
		let union = 0;
		for (let layer of layers) {
			union |= polygon.rotate(layer, rotation);
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
		for (let [id, rotation] of [...self.pictures]) {
			if ((self.unionAt(rotation) & directions) > 0) {
				self.pictures.delete(id);
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
		for (let [id, rotation] of [...self.pictures]) {
			const union = self.unionAt(rotation);
			if (union !== 0 && (union & directions) === union) {
				self.pictures.delete(id);
				removed = true;
			}
		}
		return removed;
	};

	/**
	 * Filters out pictures that contradict known constraints
	 * @throws {NoOrientationsPossible}
	 * @returns {{addedWalls:Number, addedConnections: Number}}
	 */
	self.applyConstraints = function () {
		const full = polygon.fully_connected;
		const newPictures = new Map();
		let newWalls = full;
		let newConnections = full;
		for (let [id, rotation] of self.pictures) {
			const union = self.unionAt(rotation);
			if (
				// respects known walls
				(union & self.walls) !== 0 ||
				// respects known connections if any
				(union & self.connections) !== self.connections
			) {
				continue;
			}
			newPictures.set(id, rotation);
			newWalls = newWalls & (full - union);
			newConnections = newConnections & union;
		}
		self.pictures = newPictures;
		if (newPictures.size === 0) {
			throw new NoOrientationsPossibleException(self);
		}
		const addedWalls = newWalls - self.walls;
		const addedConnections = newConnections - self.connections;
		self.walls = newWalls;
		self.connections = newConnections;
		return { addedWalls, addedConnections };
	};

	/**
	 * Finds a layer whose mask at the given rotation contains the direction
	 * @param {Number} rotation
	 * @param {Number} direction
	 * @returns {Number} - layer number or -1 if there is no such layer
	 */
	self.findLayerWithDirection = function (rotation, direction) {
		for (let layer = 0; layer < layers.length; layer++) {
			if ((polygon.rotate(layers[layer], rotation) & direction) > 0) {
				return layer;
			}
		}
		return -1;
	};

	/**
	 * Returns a copy of the cell
	 * @returns {LayeredCell}
	 */
	self.clone = function () {
		const clone = new LayeredCell(layers, polygon, index);
		clone.pictures = new Map(self.pictures);
		clone.walls = self.walls;
		clone.connections = self.connections;
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

	/** @type {Map<Number, LayeredCell>} cells pinned down to a single picture */
	self.pinned = new Map([]);

	/**
	 * sub-cell id => set of sub-cell ids of its component.
	 * Only sub-cells of pinned cells participate.
	 * @type {Map<Number, Set<Number>>}
	 */
	self.components = new Map([]);

	/**
	 * cell => links from pinned cells waiting for this cell to pin down
	 * @type {Map<Number, {fromId: Number, direction: Number}[]>}
	 */
	self.pendingLinks = new Map([]);

	/** @type {(String|Number)[]} - picture id per cell, or UNSOLVED */
	self.solution = tiles.map(() => self.UNSOLVED);

	/** @type {(String|Number)[][]} - picture ids of found solutions */
	self.solutions = [];

	/** @type {Set<Number>} */
	self.dirty = new Set([]);

	/** @type {Map<String, Number>[]} picture id => representative rotation, per cell */
	self.pictureTable = tiles.map((cellLayers, index) =>
		buildPictures(cellLayers, grid.polygon_at(index))
	);

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
		const rotation = cellObj.pictures.values().next().value || 0;
		const polygon = self.grid.polygon_at(cell);
		const numLayers = cellObj.layers.length;
		for (let layer = 0; layer < numLayers; layer++) {
			const id = self.idOf(cell, layer);
			if (!self.components.has(id)) {
				self.components.set(id, new Set([id]));
			}
		}
		const pending = self.pendingLinks.get(cell);
		if (pending !== undefined) {
			self.pendingLinks.delete(cell);
			self.pendingCount -= pending.length;
			for (let { fromId, direction } of pending) {
				const backLayer = cellObj.findLayerWithDirection(
					rotation,
					self.grid.OPPOSITE.get(direction) || 0
				);
				if (backLayer === -1) {
					throw `Pinned tiles ${fromId} and ${cell} do not match`;
				}
				self.unionSubCells(fromId, self.idOf(cell, backLayer));
			}
		}
		for (let layer = 0; layer < numLayers; layer++) {
			const mask = polygon.rotate(cellObj.layers[layer], rotation);
			const fromId = self.idOf(cell, layer);
			let bits = mask;
			while (bits > 0) {
				const direction = bits & -bits;
				bits ^= direction;
				const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
				if (empty) {
					throw 'Trying to connect to an empty neighbour!';
				}
				if (self.unsolved.has(neighbour)) {
					const neighboursPending = self.pendingLinks.get(neighbour) || [];
					neighboursPending.push({ fromId, direction });
					self.pendingLinks.set(neighbour, neighboursPending);
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
		for (let links of self.pendingLinks.values()) {
			for (let { fromId } of links) {
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
	 * Removes pictures that definitively contradict pinned neighbours:
	 * a picture with a direction towards a pinned cell that does not
	 * point back, or with a single layer connecting into the same pinned
	 * component twice, can never be part of a solution
	 * @param {Number} cell
	 * @param {LayeredCell} cellObj
	 * @returns {Boolean} - true if some pictures were removed
	 */
	self.pruneContradictoryPictures = function (cell, cellObj) {
		if (cellObj.pictures.size <= 1) {
			return false;
		}
		const polygon = self.grid.polygon_at(cell);
		let removed = false;
		for (let [id, rotation] of [...cellObj.pictures]) {
			let bad = false;
			for (let layer = 0; layer < cellObj.layers.length && !bad; layer++) {
				const mask = polygon.rotate(cellObj.layers[layer], rotation);
				/** @type {Set<Set<Number>>} */
				const layerComponents = new Set([]);
				let bits = mask;
				while (bits > 0 && !bad) {
					const direction = bits & -bits;
					bits ^= direction;
					const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
					if (empty) {
						bad = true;
						break;
					}
					const pinnedNeighbour = self.pinned.get(neighbour);
					if (pinnedNeighbour === undefined) {
						continue;
					}
					const opposite = self.grid.OPPOSITE.get(direction) || 0;
					const neighbourRotation = pinnedNeighbour.pictures.values().next().value || 0;
					const backLayer = pinnedNeighbour.findLayerWithDirection(neighbourRotation, opposite);
					if (backLayer === -1) {
						bad = true;
						break;
					}
					const component = self.components.get(self.idOf(neighbour, backLayer));
					if (component === undefined) {
						throw `Component data missing for pinned neighbour ${neighbour}`;
					}
					if (layerComponents.has(component)) {
						bad = true;
						break;
					}
					layerComponents.add(component);
				}
			}
			if (bad) {
				cellObj.pictures.delete(id);
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
		if (cell.pictures.size === 1) {
			// either empty or fully connected, is solved right away
			self.dirty.add(index);
			return;
		}
		const polygon = self.grid.polygon_at(index);
		const possibleBefore = cell.pictures.size;
		const full = polygon.fully_connected;

		// union of neighbour layers, -1 for empty or invalid directions
		/** @type {Number[]} */
		const neighbourUnions = [];
		let walls = 0;
		let invalidDirections = 0;
		for (let direction of polygon.directions) {
			if ((full & direction) === 0) {
				// invalid direction that should be disregarded
				neighbourUnions.push(-1);
				invalidDirections += direction;
				continue;
			}
			const { neighbour, empty } = self.grid.find_neighbour(index, direction);
			if (empty) {
				walls += direction;
				neighbourUnions.push(-1);
			} else {
				let union = 0;
				for (let layer of self.tiles[neighbour]) {
					union |= layer;
				}
				neighbourUnions.push(union);
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
		// remove pictures that connect only deadends
		if (self.checkDeadendConnections) {
			let deadendConnections = 0;
			for (let [i, neighbourUnion] of neighbourUnions.entries()) {
				if (neighbourUnion > 0 && (neighbourUnion & (neighbourUnion - 1)) === 0) {
					deadendConnections += polygon.directions[i];
				}
			}
			cell.mustHaveOtherConnections(deadendConnections);
		}

		if (cell.pictures.size < possibleBefore) {
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
			// get a dirty cell
			const [cell] = self.dirty;
			const cellObj = self.getCell(cell);
			const polygon = self.grid.polygon_at(cell);
			// apply constraints and prune until the picture set is stable,
			// propagating every newly implied wall/connection right away
			/** @type {{addedWalls: Number, addedConnections: Number}} */
			let deltas = { addedWalls: 0, addedConnections: 0 };
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
							const pinnedNeighbour = self.pinned.get(neighbour);
							if (pinnedNeighbour !== undefined) {
								// solved neighbours are not revisited,
								// but a contradiction must be detected
								const neighbourRotation = pinnedNeighbour.pictures.values().next().value || 0;
								if (pinnedNeighbour.findLayerWithDirection(neighbourRotation, opposite) !== -1) {
									throw `Pinned tile ${neighbour} contradicts a new wall`;
								}
								continue;
							}
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
							const pinnedNeighbour = self.pinned.get(neighbour);
							if (pinnedNeighbour !== undefined) {
								const neighbourRotation = pinnedNeighbour.pictures.values().next().value || 0;
								if (pinnedNeighbour.findLayerWithDirection(neighbourRotation, opposite) === -1) {
									throw `Pinned tile ${neighbour} contradicts a new connection`;
								}
								continue;
							}
							const neighbourCell = self.getCell(neighbour);
							neighbourCell.addConnection(opposite);
							self.dirty.add(neighbour);
						}
					}
				}
				// rule out pictures definitively contradicted by pinned neighbours
				if (!self.pruneContradictoryPictures(cell, cellObj)) {
					break;
				}
			}
			// check if cell is solved
			const id = /** @type {String} */ (cellObj.pictures.keys().next().value);
			const final = cellObj.pictures.size === 1;
			if (final) {
				self.unsolved.delete(cell);
				self.pinned.set(cell, cellObj);
				self.pinCell(cell, cellObj);
				self.solution[cell] = id;
				if (self.unsolved.size === 0) {
					self.checkAllConnected();
				}
			}
			yield { cell, id, rotation: cellObj.pictures.get(id) || 0, final };
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
		clone.pinned = new Map([]);
		self.pinned.forEach((cell, index) => {
			clone.pinned.set(index, cell.clone());
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
		clone.pendingLinks = new Map([]);
		self.pendingLinks.forEach((links, cell) => {
			clone.pendingLinks.set(cell, [...links]);
		});
		clone.solution = [...self.solution];
		clone.solutions = self.solutions.map((solution) => [...solution]);
		clone.dirty = new Set();
		return clone;
	};

	/**
	 * Counts the pinned neighbours of a cell
	 * @param {Number} cell
	 * @returns {Number}
	 */
	self.countPinnedNeighbours = function (cell) {
		let count = 0;
		const polygon = self.grid.polygon_at(cell);
		for (let direction of polygon.directions) {
			const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
			if (!empty && self.pinned.has(neighbour)) {
				count += 1;
			}
		}
		return count;
	};

	/**
	 * Counts the directions of a picture that point into pinned cells
	 * @param {Number} cell
	 * @param {Number} rotation
	 * @returns {Number}
	 */
	self.countPinnedConnections = function (cell, rotation) {
		const polygon = self.grid.polygon_at(cell);
		const cellObj = /** @type {LayeredCell} */ (self.unsolved.get(cell));
		let count = 0;
		let union = 0;
		for (let layer of cellObj.layers) {
			union |= polygon.rotate(layer, rotation);
		}
		for (let direction of polygon.directions) {
			if ((union & direction) === 0) {
				continue;
			}
			const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
			if (!empty && self.pinned.has(neighbour)) {
				count += 1;
			}
		}
		return count;
	};

	/**
	 * Chooses a cell/picture to try out.
	 * Selects a picture from a cell with the least number of options,
	 * preferring cells next to pinned structure so that contradictions
	 * surface quickly, and pictures that grow the pinned structure
	 * @returns {(Number|String)[]} - [cell, picture id]
	 */
	self.makeAGuess = function () {
		let minPossibleSize = Number.POSITIVE_INFINITY;
		for (let [, cellObj] of self.unsolved.entries()) {
			if (cellObj.pictures.size < minPossibleSize) {
				minPossibleSize = cellObj.pictures.size;
				if (minPossibleSize == 2) {
					break;
				}
			}
		}
		let guessCell = -1;
		let maxPinnedNeighbours = -1;
		for (let [cell, cellObj] of self.unsolved.entries()) {
			if (cellObj.pictures.size > minPossibleSize) {
				continue;
			}
			const pinnedNeighbours = self.countPinnedNeighbours(cell);
			if (pinnedNeighbours > maxPinnedNeighbours) {
				guessCell = cell;
				maxPinnedNeighbours = pinnedNeighbours;
			}
		}
		const cellObj = self.unsolved.get(guessCell);
		if (cellObj === undefined) {
			throw 'Cell selected for guessing is undefined!';
		}
		let guessId = /** @type {String} */ ('');
		let guessRotation = -1;
		let maxPinnedConnections = -1;
		for (let [id, rotation] of cellObj.pictures) {
			const pinnedConnections = self.countPinnedConnections(guessCell, rotation);
			if (pinnedConnections > maxPinnedConnections) {
				guessId = id;
				guessRotation = rotation;
				maxPinnedConnections = pinnedConnections;
			}
		}
		const guessedPictures = new Map();
		guessedPictures.set(guessId, guessRotation);
		cellObj.pictures = guessedPictures;
		self.dirty.add(guessCell);
		return [guessCell, guessId];
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

		/** @type {{cell: Number, guess: String, solver:LayeredSolver}[]} */
		const trials = [{ cell: -1, guess: '-1', solver: self }];
		while (trials.length > 0) {
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
					parentCell?.pictures.delete(guess);
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
					parentCell?.pictures.delete(guess);
					parent.dirty.add(cell);
					continue;
				} else {
					break;
				}
			} else {
				// we have to make a guess
				const clone = solver.clone();
				const [guessCell, guessId] = clone.makeAGuess();
				trials.push({
					cell: /** @type {Number} */ (guessCell),
					guess: /** @type {String} */ (guessId),
					solver: clone
				});
			}
		}
	};

	/**
	 * Check pictures of unsolved cells to see if they produce contradictions quickly
	 * Returns true if solver manages to exclude some picture, false otherwise
	 * @param {(String|Number)[]} marked
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
			for (let [id, rotation] of [...cellObj.pictures]) {
				const key = `${cell}_${id}`;
				if (tested.has(key)) {
					continue;
				}
				const clone = self.clone();
				const cloneCell = clone.unsolved.get(cell);
				if (cloneCell === undefined) {
					throw 'Clone cell is undefined';
				}
				const probePictures = new Map();
				probePictures.set(id, rotation);
				cloneCell.pictures = probePictures;
				clone.dirty.add(cell);
				try {
					for (let step of clone.processDirtyCells()) {
						if (step.final) {
							tested.add(`${step.cell}_${step.id}`);
						}
					}
				} catch (e) {
					cellObj.pictures.delete(id);
					self.dirty.add(cell);
					self.shortTrialsIndex = cell;
					return true;
				}
			}
		}
		return false;
	};

	/**
	 * Converts marked picture ids to representative rotations,
	 * leaving the UNSOLVED/AMBIGUOUS sentinels as they are
	 * @param {(String|Number)[]} marked
	 * @returns {Number[]}
	 */
	self.convertMarked = function (marked) {
		return marked.map((id, cell) => {
			if (id === self.UNSOLVED || id === self.AMBIGUOUS) {
				return id;
			}
			const rotation = self.pictureTable[cell].get(/** @type {String} */ (id));
			if (rotation === undefined) {
				throw `Unknown picture ${id} at cell ${cell}`;
			}
			return rotation;
		});
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
		/** @type {(String|Number)[]} */
		let marked = [...self.solution];
		let unique = true;
		let numAmbiguous = 0;
		let complete = true;
		const total = self.grid.total - self.grid.emptyCells.size;
		// process what we can for a start
		try {
			for (let step of self.processInitialDeductions()) {
				if (step.final) {
					marked[step.cell] = step.id;
				}
			}
		} catch (error) {
			return {
				marked: self.convertMarked(marked),
				solvable: false,
				unique: false,
				numAmbiguous,
				complete: true
			};
		}
		/** @type {{cell: Number, guess: String, solver:LayeredSolver}[]} */
		const trials = [{ cell: -1, guess: '-1', solver: self }];
		let iterations = 0;
		while (trials.length > 0) {
			iterations += 1;
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
					parentCell?.pictures.delete(guess);
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
						marked: self.convertMarked(marked),
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
					parentCell?.pictures.delete(guess);
					parent.dirty.add(cell);
					continue;
				} else {
					break;
				}
			} else {
				// we have to make a guess
				const clone = solver.clone();

				// copypasta of makeAGuess function
				// because I want to ignore ambiguous tiles as guess candidates
				let minPossibleSize = Number.POSITIVE_INFINITY;
				for (let [index, cellObj] of clone.unsolved.entries()) {
					if (marked[index] === self.AMBIGUOUS) {
						continue;
					}
					if (cellObj.pictures.size < minPossibleSize) {
						minPossibleSize = cellObj.pictures.size;
						if (minPossibleSize == 2) {
							break;
						}
					}
				}
				let guessCell = -1;
				let maxPinnedNeighbours = -1;
				for (let [index, cellObj] of clone.unsolved.entries()) {
					if (marked[index] === self.AMBIGUOUS) {
						continue;
					}
					if (cellObj.pictures.size > minPossibleSize) {
						continue;
					}
					const pinnedNeighbours = solver.countPinnedNeighbours(index);
					if (pinnedNeighbours > maxPinnedNeighbours) {
						guessCell = index;
						maxPinnedNeighbours = pinnedNeighbours;
					}
				}
				const cellObj = clone.unsolved.get(guessCell);
				if (cellObj === undefined) {
					// can not guess because only ambiguous tiles are left
					solver.unsolved = new Map();
					continue;
				}
				const id = /** @type {String} */ (cellObj.pictures.keys().next().value);
				const guessedPictures = new Map();
				guessedPictures.set(id, cellObj.pictures.get(id) || 0);
				cellObj.pictures = guessedPictures;
				clone.dirty.add(guessCell);

				trials.push({
					cell: guessCell,
					guess: id,
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
			marked: self.convertMarked(marked),
			solvable,
			unique,
			numAmbiguous,
			complete
		};
	};
}
