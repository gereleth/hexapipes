/* Constraint Violation Exceptions */

/**
 * A cell has no more viable orientations
 * @param {Cell} cell
 */
function NoOrientationsPossibleException(cell) {
	this.name = 'NoOrientationsPossible';
	this.message = `No orientations possible for tile ${cell.initial} at index ${cell.index}`;
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
 * @constructor
 * @param {import('$lib/puzzle/hexagrid').HexaGrid} grid
 * @param {Number} index - tile index in grid
 * @param {Number} initial - initial orientation
 */
export function Cell(grid, index, initial) {
	let self = this;
	self.index = index;
	self.initial = initial;

	self.possible = new Set();
	let rotated = initial;
	while (!self.possible.has(rotated)) {
		self.possible.add(rotated);
		rotated = grid.rotate(rotated, 1, index);
	}
	self.walls = 0;
	self.connections = 0;

	/**
	 * @param {Number} direction
	 */
	self.addWall = function (direction) {
		self.walls += direction;
	};

	/**
	 * @param {Number} direction
	 */
	self.addConnection = function (direction) {
		self.connections += direction;
	};

	/**
	 * Filters out tile orientations that contradict known constraints
	 * @throws {NoOrientationsPossible}
	 * @returns {{addedWalls:Number, addedConnections: Number}}
	 */
	self.applyConstraints = function () {
		const newPossible = new Set();
		for (let orientation of self.possible) {
			if (
				// respects known walls
				(orientation & self.walls) === 0 &&
				// respects known connections if any
				(orientation & self.connections) === self.connections
			) {
				newPossible.add(orientation);
			}
		}
		self.possible = newPossible;
		if (newPossible.size === 0) {
			throw new NoOrientationsPossibleException(self);
		}
		const full = grid.fullyConnected(index);
		let newWalls = full;
		let newConnections = full;
		newPossible.forEach((orientation) => {
			newWalls = newWalls & (full - orientation);
			newConnections = newConnections & orientation;
		});
		const addedWalls = newWalls - self.walls;
		const addedConnections = newConnections - self.connections;
		self.walls = newWalls;
		self.connections = newConnections;
		return { addedWalls, addedConnections };
	};

	return self;
}

/**
 * @constructor
 * @param {Number[]} tiles - tile index in grid
 * @param {import('$lib/puzzle/hexagrid').HexaGrid} grid
 */
export function Solver(tiles, grid) {
	let self = this;
	self.grid = grid

	/** @type {Map<Number, Cell>} */
	self.unsolved = new Map([])

	tiles.forEach((tile, index) => {
		self.unsolved.set(index, new Cell(grid, index, tile))
	});
	/** @type {Number[]} */
	self.solution = tiles.map(() => -1)

	self.components = new Map([])
	
	/** @type {Set<Number>} */
	self.dirty = new Set()

	self.applyBorderConditions = function() {
		for (let index=0; index<self.grid.total; index++) {
			const cell = self.unsolved.get(index)
			if (cell === undefined) {
				continue
			}
			if (cell.possible.size === 1) {
				self.dirty.add(index)
			} else {
				for (let direction of self.grid.DIRECTIONS) {
					const {neighbour} = self.grid.find_neighbour(index, direction)
					if (neighbour === -1) {
						cell.addWall(direction)
						self.dirty.add(index)
					}
				}
			}
		}
	}

	self.processDirtyCells = function() {
		while (self.dirty.size > 0) {
			// get a dirty cell
			const index = self.dirty.keys().next().value
			self.dirty.delete(index)
			const cell = self.unsolved.get(index)
			if (cell === undefined) {continue}
			// apply constraints to limit possible orientations
			const {addedWalls, addedConnections} = cell.applyConstraints()
			// check if cell is solved
			if (cell.possible.size === 1) {
				const orientation = cell.possible.keys().next().value
				self.solution[index] = orientation
				self.unsolved.delete(index)
			}
			// add walls to walled off neighbours
			if (addedWalls > 0) {
				for (let direction of self.grid.DIRECTIONS) {
					if ((direction & addedWalls) > 0) {
						const {neighbour} = self.grid.find_neighbour(index, direction)
						const neighbourCell = self.unsolved.get(neighbour)
						if (neighbourCell === undefined) {
							continue
						}
						neighbourCell.addWall(self.grid.OPPOSITE.get(direction)||0)
						self.dirty.add(neighbour)
					}
				}
			}
			// add connections to connected neighbours
			if (addedConnections > 0) {
				for (let direction of self.grid.DIRECTIONS) {
					if ((direction & addedConnections) > 0) {
						const {neighbour} = self.grid.find_neighbour(index, direction)
						const neighbourCell = self.unsolved.get(neighbour)
						if (neighbourCell === undefined) {
							continue
						}
						neighbourCell.addConnection(self.grid.OPPOSITE.get(direction)||0)
						// merge components!!!
						self.dirty.add(neighbour)
					}
				}
			}
		}
	}
}