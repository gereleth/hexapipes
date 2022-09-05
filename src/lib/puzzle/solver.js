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
