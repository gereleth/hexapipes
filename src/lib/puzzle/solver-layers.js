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
 * A slot is an unresolved component member: a promise that whichever
 * sub-cell of `cell` ends up using `direction` will join the slot's
 * component. Slots are born when a connection between two cells becomes
 * certain (every surviving picture connects that way) but the answering
 * sub-cell is not uniquely determined yet. Slot objects are immutable and
 * shared between clones.
 * @typedef {Object} Slot
 * @property {Number} cell - the cell owning the direction
 * @property {Number} direction - the cell's own direction of the edge
 */

/**
 * Component members are the resolved sub-cells of unpinned cells and the
 * unresolved slots. Sub-cells of pinned cells are dropped from components.
 * @typedef {Number|Slot} ComponentMember
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
 * The tree constraint is tracked over sub-cells (cell + layer) with
 * components maintained eagerly over the open frontier: whenever a
 * connection between two cells becomes certain, its ends join one
 * component - directly when both answering sub-cells are uniquely
 * determined, otherwise as slots promising that the future answerer will
 * join. Closing a loop or leaving the solved board disconnected raises an
 * exception.
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
	 * member => set of members of its component. A component set is the
	 * open frontier through which the component can still grow: resolved
	 * sub-cells of unpinned cells and unresolved slots. Resolved members
	 * are dropped again - slot resolution swaps the slot for the answerer,
	 * pinning swaps the sub-cell for the slots of its certain edges - so
	 * nothing accumulates. Identity is by object reference for slots, and
	 * clone() must preserve set sharing.
	 * @type {Map<ComponentMember, Set<ComponentMember>>}
	 */
	self.components = new Map([]);

	/**
	 * cell => (direction => slot) for the cell's own directions of certain
	 * edges whose answering sub-cell is not uniquely determined yet.
	 * At most one slot per cell+direction, so the pair is a unique key.
	 * @type {Map<Number, Map<Number, Slot>>}
	 */
	self.slotIndex = new Map([]);

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
	// total number of layer direction bits (popcounts are rotation invariant),
	// which is exactly the edge count of a spanning tree over the sub-cells.
	// Every certain edge is part of the final tree, so their running count
	// can never exceed this budget.
	self.totalSubCells = 0;
	self.totalEdges = 0;
	for (let cellLayers of tiles) {
		self.totalSubCells += cellLayers.length;
		for (let layer of cellLayers) {
			self.totalEdges += popcount(layer);
		}
	}
	self.totalEdges = self.totalEdges / 2;
	self.committedEdges = 0;
	// non-empty cells still to pin down; zero means the board is complete
	self.cellsToPin = tiles.filter((cellLayers) => cellLayers.length > 0).length;

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
	 * Set of sub-cell ids that could answer a connection in `direction` of
	 * `cell`, across the surviving pictures. Pinned cells are not in
	 * `unsolved`, so null is returned for them.
	 * @param {Number} cell
	 * @param {Number} direction
	 * @returns {Set<Number>|null}
	 */
	self.answererCandidates = function (cell, direction) {
		const cellObj = self.unsolved.get(cell);
		if (cellObj === undefined) {
			return null;
		}
		/** @type {Set<Number>} */
		const candidates = new Set([]);
		for (let layers of cellObj.possible.values()) {
			for (let index = 0; index < layers.length; index++) {
				if ((layers[index] & direction) > 0) {
					candidates.add(self.idOf(cell, index));
				}
			}
		}
		return candidates;
	};

	/**
	 * Registers a member in a component set, creating a singleton if needed
	 * @param {ComponentMember} member
	 * @returns {Set<ComponentMember>}
	 */
	self.componentOf = function (member) {
		let set = self.components.get(member);
		if (set === undefined) {
			set = new Set([member]);
			self.components.set(member, set);
		}
		return set;
	};

	/**
	 * Merges two component sets, re-keying the smaller one into the larger.
	 * Runs the touch scan over the freshly absorbed members: an open
	 * direction of an absorbed open-cell member resolving into the same
	 * component is a definite wall in every solution - the layered
	 * equivalent of classic mergeComponents wall drawing.
	 * @param {Set<ComponentMember>} a
	 * @param {Set<ComponentMember>} b
	 * @returns {Set<ComponentMember>} - the surviving set
	 */
	self.mergeSets = function (a, b) {
		if (a === b) {
			return a;
		}
		const source = a.size > b.size ? b : a;
		const target = source === a ? b : a;
		for (let member of source) {
			self.components.set(member, target);
			target.add(member);
			if (typeof member === 'number') {
				// the absorbed sub-cell's neighbours resolve this component
				// behind its directions now - their pictures may be prunable
				const cell = member % self.grid.total;
				for (let direction of self.grid.polygon_at(cell).directions) {
					const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
					if (!empty && self.unsolved.has(neighbour)) {
						self.dirty.add(neighbour);
					}
				}
			}
		}
		self.touchScan(source, target);
		return target;
	};

	/**
	 * Draws definite walls around a freshly absorbed component part: when
	 * BOTH ends of a member cell's open direction resolve uniquely into the
	 * same component, the edge would close a cycle in every solution. The
	 * near end is only certain when the direction has a unique answerer -
	 * a multi-layered cell's other layers may legally reach the component
	 * through their own sub-cells
	 * @param {Set<ComponentMember>} members - freshly absorbed members
	 * @param {Set<ComponentMember>} target - the merged component
	 */
	self.touchScan = function (members, target) {
		for (let member of members) {
			if (typeof member !== 'number') {
				// slots have no stance of their own
				continue;
			}
			const cell = member % self.grid.total;
			const cellObj = self.unsolved.get(cell);
			if (cellObj === undefined) {
				// pinned cells have their stance pushed already
				continue;
			}
			const occupied = cellObj.walls + cellObj.connections;
			for (let direction of self.grid.polygon_at(cell).directions) {
				if ((occupied & direction) > 0) {
					continue;
				}
				const candidates = self.answererCandidates(cell, direction);
				if (candidates === null || candidates.size !== 1) {
					continue;
				}
				const nearId = /** @type {Number} */ (candidates.values().next().value);
				const near = self.components.get(nearId);
				if (near === undefined || near !== target) {
					continue;
				}
				const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
				if (empty) {
					continue;
				}
				const far = self.componentBehind(cell, cellObj, direction);
				if (far !== undefined && far === target) {
					const neighbourCell = self.getCell(neighbour);
					neighbourCell.addWall(self.grid.OPPOSITE.get(direction) || 0);
					cellObj.addWall(direction);
					self.dirty.add(neighbour);
					self.dirty.add(cell);
				}
			}
		}
	};

	/**
	 * Creates a slot for an unresolved end of a certain edge, either joining
	 * an existing component or starting a fresh one (for a pair of slots)
	 * @param {Number} cell
	 * @param {Number} direction
	 * @param {Set<ComponentMember>|undefined} set - component to join
	 * @returns {Slot}
	 */
	self.createSlot = function (cell, direction, set) {
		/** @type {Slot} */
		const slot = { cell, direction };
		let dirs = self.slotIndex.get(cell);
		if (dirs === undefined) {
			dirs = new Map([]);
			self.slotIndex.set(cell, dirs);
		}
		dirs.set(direction, slot);
		if (set === undefined) {
			set = new Set([slot]);
		} else {
			set.add(slot);
		}
		self.components.set(slot, set);
		return slot;
	};

	/**
	 * Resolves a slot to the sub-cell answering its certain edge: the slot
	 * is dropped and the sub-cell joins the component in its place. The
	 * sub-cell already being in the same component means two certain edges
	 * of one sub-cell into one component - a cycle in every solution.
	 * @param {Slot} slot
	 * @param {Number} answerer - sub-cell id
	 * @throws {LoopDetected}
	 */
	self.resolveSlot = function (slot, answerer) {
		const set = self.components.get(slot);
		if (set === undefined) {
			throw `Component data missing for slot at cell ${slot.cell}`;
		}
		self.components.delete(slot);
		set.delete(slot);
		self.slotIndex.get(slot.cell)?.delete(slot.direction);
		const other = self.components.get(answerer);
		if (other === undefined) {
			set.add(answerer);
			self.components.set(answerer, set);
			// the neighbours of the answerer resolve this component behind
			// its directions now - their pictures may be prunable
			for (let direction of self.grid.polygon_at(slot.cell).directions) {
				const { neighbour, empty } = self.grid.find_neighbour(slot.cell, direction);
				if (!empty && self.unsolved.has(neighbour)) {
					self.dirty.add(neighbour);
				}
			}
		} else if (other === set) {
			throw new LoopDetectedException();
		} else {
			self.mergeSets(set, other);
		}
	};

	/**
	 * Resolves the cell's own slots whose answering sub-cell has become
	 * uniquely determined across the surviving pictures
	 * @param {Number} cell
	 * @returns {Boolean} - true if any slot was resolved
	 * @throws {LoopDetected}
	 */
	self.resolveOwnSlots = function (cell) {
		const dirs = self.slotIndex.get(cell);
		if (dirs === undefined || dirs.size === 0) {
			return false;
		}
		let resolved = false;
		for (let [direction, slot] of [...dirs]) {
			const candidates = self.answererCandidates(cell, direction);
			if (candidates !== null && candidates.size === 1) {
				const answerer = /** @type {Number} */ (candidates.values().next().value);
				self.resolveSlot(slot, answerer);
				resolved = true;
			}
		}
		return resolved;
	};

	/**
	 * Registers a newly certain edge between cell+direction and its
	 * neighbour: both ends join one component, directly when both answering
	 * sub-cells are uniquely determined, otherwise as slots promising that
	 * the future answerers will join. Called when a connection fact is
	 * first derived; the slotIndex membership tells repeated calls for the
	 * same edge apart.
	 * @param {Number} cell
	 * @param {Number} direction
	 * @throws {LoopDetected} when both ends are already in one component
	 */
	self.registerCertainEdge = function (cell, direction) {
		if (self.slotIndex.get(cell)?.has(direction)) {
			return;
		}
		const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
		if (empty) {
			return; // the connection push already throws for empty neighbours
		}
		const opposite = self.grid.OPPOSITE.get(direction) || 0;
		if (self.slotIndex.get(neighbour)?.has(opposite)) {
			return;
		}
		const candidatesA = self.answererCandidates(cell, direction);
		const candidatesB = self.answererCandidates(neighbour, opposite);
		if (candidatesA === null || candidatesB === null) {
			throw `Certain edge between ${cell} and ${neighbour} is missing an endpoint`;
		}
		self.committedEdges += 1;
		const singleA =
			candidatesA.size === 1 ? /** @type {Number} */ (candidatesA.values().next().value) : -1;
		const singleB =
			candidatesB.size === 1 ? /** @type {Number} */ (candidatesB.values().next().value) : -1;
		if (singleA !== -1 && singleB !== -1) {
			const setA = self.componentOf(singleA);
			const setB = self.componentOf(singleB);
			if (setA === setB) {
				throw new LoopDetectedException();
			}
			self.mergeSets(setA, setB);
		} else if (singleA !== -1) {
			self.createSlot(neighbour, opposite, self.componentOf(singleA));
		} else if (singleB !== -1) {
			self.createSlot(cell, direction, self.componentOf(singleB));
		} else {
			const slotA = self.createSlot(cell, direction, undefined);
			self.createSlot(neighbour, opposite, self.components.get(slotA));
		}
	};

	/**
	 * Resolves the component behind an edge at cell+direction, and whether
	 * the edge is still candidate-dependent:
	 * - an own unresolved slot is a certain edge whose answering sub-cell
	 *   is not uniquely determined yet - whichever layer uses the direction
	 *   will join the slot's component (candidate-dependent),
	 * - a certain edge with a uniquely determined own answerer is already
	 *   committed: the answerer sub-cell joined its component through this
	 *   very edge (not candidate-dependent),
	 * - an uncertain edge can only be answered by the neighbour's uniquely
	 *   determined answerer sub-cell, provided it is already a member
	 *   (candidate-dependent).
	 * @param {Number} cell
	 * @param {LayeredCell} cellObj
	 * @param {Number} direction
	 * @returns {{component: Set<ComponentMember>, isNew: Boolean}|undefined}
	 */
	self.resolveBehind = function (cell, cellObj, direction) {
		const slot = self.slotIndex.get(cell)?.get(direction);
		if (slot !== undefined) {
			const component = self.components.get(slot);
			if (component === undefined) {
				return undefined;
			}
			return { component, isNew: true };
		}
		if ((cellObj.connections & direction) > 0) {
			const candidates = self.answererCandidates(cell, direction);
			if (candidates !== null && candidates.size === 1) {
				const answerer = /** @type {Number} */ (candidates.values().next().value);
				const component = self.components.get(answerer);
				return component === undefined ? undefined : { component, isNew: false };
			}
			return undefined;
		}
		const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
		if (empty) {
			return undefined;
		}
		const candidates = self.answererCandidates(neighbour, self.grid.OPPOSITE.get(direction) || 0);
		if (candidates !== null && candidates.size === 1) {
			const answerer = /** @type {Number} */ (candidates.values().next().value);
			const component = self.components.get(answerer);
			return component === undefined ? undefined : { component, isNew: false };
		}
		return undefined;
	};

	/**
	 * The component that the far side of an edge at cell+direction belongs
	 * to (or will belong to once resolved), as far as certainly known.
	 * Used by the touch scan, which only looks at open directions - there
	 * only the candidate-dependent resolutions (unresolved slots and
	 * neighbour answers) can apply.
	 * @param {Number} cell
	 * @param {LayeredCell} cellObj
	 * @param {Number} direction
	 * @returns {Set<ComponentMember>|undefined}
	 */
	self.componentBehind = function (cell, cellObj, direction) {
		return self.resolveBehind(cell, cellObj, direction)?.component;
	};

	/**
	 * Commits the cell that just pinned down: its own unresolved slots
	 * resolve to the answering sub-cells (merging components, catching
	 * cycles - the certain edges themselves were registered when they
	 * became certain, during the final constraint pass), and the pinned
	 * sub-cells are dropped from their components. A component that runs
	 * out of members while unsolved cells remain can never connect to the
	 * rest of the board and is an island.
	 * @param {Number} cell
	 * @param {LayeredCell} cellObj
	 * @throws {LoopDetected} when a definitive edge closes a loop
	 * @throws {IslandDetected} when a component is sealed off
	 */
	self.pinCell = function (cell, cellObj) {
		const [rotation, layers] = cellObj.possible.entries().next().value || [0, []];
		const polygon = self.grid.polygon_at(cell);
		const dirs = self.slotIndex.get(cell);
		if (dirs !== undefined) {
			for (let [direction, slot] of [...dirs]) {
				const backLayer = cellObj.findLayerWithDirection(rotation, direction);
				if (backLayer === -1) {
					throw `Pinned tile at cell ${cell} does not match a certain edge`;
				}
				self.resolveSlot(slot, self.idOf(cell, backLayer));
			}
		}
		if (layers.length > 0) {
			self.cellsToPin -= 1;
		}
		for (let index = 0; index < layers.length; index++) {
			const id = self.idOf(cell, index);
			const set = self.components.get(id);
			if (set === undefined) {
				continue;
			}
			set.delete(id);
			self.components.delete(id);
			if (set.size === 0 && self.cellsToPin > 0) {
				// a component that ran out of members while unpinned cells
				// remain can never connect to the rest of the board
				throw new IslandDetectedException();
			}
		}
		if (self.committedEdges > self.totalEdges) {
			// too many edges committed, the final graph would contain a cycle
			throw new LoopDetectedException();
		}
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
	 * Checks that the committed certain edges form the full tree: every
	 * solution edge becomes certain by the time the board completes, a
	 * forest would stay below the budget, and cycles throw at registration
	 * and resolution time - so equality proves connectivity
	 * @throws {IslandDetected}
	 */
	self.checkAllConnected = function () {
		if (self.committedEdges !== self.totalEdges) {
			throw new IslandDetectedException();
		}
	};

	/**
	 * Removes pictures that definitively contradict components: a single
	 * layer must not get more than one new edge into the same component,
	 * and none at all when the layer's sub-cell is already part of that
	 * component through committed edges - either would close a cycle in
	 * every solution choosing the picture. Committed certain edges are
	 * skipped (they are why the sub-cell is in the component already),
	 * the candidate-dependent ones count
	 * @param {Number} cell
	 * @param {LayeredCell} cellObj
	 * @returns {Boolean} - true if some pictures were removed
	 */
	self.pruneContradictoryPictures = function (cell, cellObj) {
		if (cellObj.possible.size <= 1) {
			return false;
		}
		/** @type {Map<Number, {component: Set<ComponentMember>, isNew: Boolean}|undefined>} */
		const behindCache = new Map([]);
		/** @type {(direction: Number) => {component: Set<ComponentMember>, isNew: Boolean}|undefined} */
		const behind = (direction) => {
			if (!behindCache.has(direction)) {
				behindCache.set(direction, self.resolveBehind(cell, cellObj, direction));
			}
			return behindCache.get(direction);
		};
		let removed = false;
		for (let [rotation, layers] of [...cellObj.possible]) {
			let bad = false;
			for (let layer = 0; layer < cellObj.layers.length && !bad; layer++) {
				const mask = layers[layer];
				/** @type {Set<Set<ComponentMember>>} */
				const groups = new Set([]);
				let bits = mask;
				while (bits > 0 && !bad) {
					const direction = bits & -bits;
					bits ^= direction;
					const resolved = behind(direction);
					if (resolved === undefined) {
						continue;
					}
					if (resolved.isNew && groups.has(resolved.component)) {
						bad = true;
						break;
					}
					groups.add(resolved.component);
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
				// new certain edges join components (or create slots for
				// their yet unresolved answering sub-cells)
				if (deltas.addedConnections > 0) {
					for (let direction of polygon.directions) {
						if ((direction & deltas.addedConnections) > 0) {
							self.registerCertainEdge(cell, direction);
						}
					}
				}
				// neighbours must not answer a deadend with a deadend: two facing
				// single-connection sub-cells would be sealed off from the tree.
				// Same board-size gate as the classic deadend rule: on tiny boards
				// the sealed pair could be the entire puzzle
				if (self.checkDeadendConnections && deltas.addedDeadends > 0) {
					for (let direction of polygon.directions) {
						if ((direction & deltas.addedDeadends) > 0) {
							const { neighbour, empty } = self.grid.find_neighbour(cell, direction);
							if (empty) {
								continue;
							}
							const opposite = self.grid.OPPOSITE.get(direction) || 0;
							let neighbourCell = self.unsolved.get(neighbour);
							if (neighbourCell === undefined && self.solution[neighbour] === self.UNSOLVED) {
								// the neighbour was never touched yet, safe to initialize
								neighbourCell = self.getCell(neighbour);
							}
							if (neighbourCell === undefined) {
								// pinned neighbour: the answering mask is frozen in
								// its pinned picture. If it answers with a deadend,
								// this cell must not connect here with a deadend
								// at all
								const pinnedRotation = self.solution[neighbour];
								const pinnedLayers = self.tiles[neighbour].map((layer) =>
									self.grid.polygon_at(neighbour).rotate(layer, pinnedRotation)
								);
								if (pinnedLayers.some((layer) => layer === opposite)) {
									cellObj.addWall(direction);
									self.dirty.add(cell);
								}
								continue;
							}
							// the neighbour can still lose pictures
							const removed = neighbourCell.removeDeadendPairs(opposite);
							self.stats.prunedPictures += removed;
							if (removed > 0) {
								self.dirty.add(neighbour);
							}
						}
					}
				}
				// resolve own slots made unique by the shrunken picture set
				const resolved = self.resolveOwnSlots(cell);
				// rule out pictures definitively contradicted by components
				const removed = self.pruneContradictoryPictures(cell, cellObj);
				if (!removed && !resolved) {
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
				if (self.cellsToPin === 0) {
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
		clone.tiles = self.tiles;
		clone.checkDeadendConnections = self.checkDeadendConnections;
		clone.shortTrialsIndex = self.shortTrialsIndex;
		clone.totalSubCells = self.totalSubCells;
		clone.totalEdges = self.totalEdges;
		clone.committedEdges = self.committedEdges;
		clone.cellsToPin = self.cellsToPin;
		clone.unsolved = new Map([]);
		self.unsolved.forEach((cell, index) => {
			clone.unsolved.set(index, cell.clone());
		});
		clone.components = new Map([]);
		/** @type {Map<Set<ComponentMember>, Set<ComponentMember>>} */
		const clonedSets = new Map([]);
		self.components.forEach((set, member) => {
			let clonedSet = clonedSets.get(set);
			if (clonedSet === undefined) {
				clonedSet = new Set([]);
				clonedSets.set(set, clonedSet);
			}
			clone.components.set(member, clonedSet);
		});
		self.components.forEach((set, member) => {
			const clonedSet = /** @type {Set<ComponentMember>} */ (clonedSets.get(set));
			for (let element of set) {
				// slot objects are immutable, sharing them between clones is safe
				clonedSet.add(element);
			}
		});
		clone.slotIndex = new Map([]);
		self.slotIndex.forEach((dirs, cell) => {
			clone.slotIndex.set(cell, new Map(dirs));
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
