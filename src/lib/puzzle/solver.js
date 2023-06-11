import { HexaGrid } from '$lib/puzzle/grids/hexagrid';
import { OctaGrid } from '$lib/puzzle/grids/octagrid';

/* Constraint Violation Exceptions */

/**
 * A cell has no more viable orientations
 * @param {Cell} cell
 */
function NoOrientationsPossibleException(cell) {
	this.name = 'NoOrientationsPossible';
	this.message = `No orientations possible for tile ${cell.initial}`;
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
 * @typedef {Object} Step
 * @property {Number} index
 * @property {Number} orientation
 * @property {Boolean} final - true if this orientation is the only one left
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
 * @constructor
 * @param {import('$lib/puzzle/grids/polygonutils').RegularPolygonTile} polygon
 * @param {Number} initial - initial orientation
 */
export function Cell(polygon, initial) {
	let self = this;
	self.initial = initial;

	self.possible = new Set();
	if (initial >= 0) {
		let rotated = initial;
		while (!self.possible.has(rotated)) {
			self.possible.add(rotated);
			rotated = polygon.rotate(rotated, 1);
		}
	} else {
		// special case of null tile - can have any tile type/orientation
		// TODO let the grid supply this set depending on index
		self.possible = new Set([...polygon.tileTypes.keys()]);
	}
	self.walls = 0;
	self.connections = 0;

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
	 * Removes orientations if they don't have all the mentioned walls
	 * @param {Number} directions
	 */
	self.mustHaveAllWalls = function (directions) {
		for (let orientation of self.possible) {
			if ((orientation & directions) > 0) {
				self.possible.delete(orientation);
			}
		}
	};

	/**
	 * Removes orientations if they only connect specified directions
	 * @param {Number} directions
	 */
	self.mustHaveOtherConnections = function (directions) {
		let removed = false;
		for (let orientation of self.possible) {
			if ((orientation & directions) === orientation) {
				self.possible.delete(orientation);
				removed = true;
			}
		}
		return removed;
	};

	/**
	 * Removes orientations if they don't have at least one of the mentioned walls
	 * @param {Number} directions
	 * @returns {Boolean} - true if removed some orientations
	 */
	self.mustHaveSomeWalls = function (directions) {
		let removed = false;
		for (let orientation of self.possible) {
			if ((orientation & directions) === directions) {
				self.possible.delete(orientation);
				removed = true;
			}
		}
		return removed;
	};

	/**
	 * Removes orientations if they don't have all the mentioned connections
	 * @param {Number} directions
	 */
	self.mustHaveAllConnections = function (directions) {
		for (let orientation of self.possible) {
			if ((orientation & directions) !== directions) {
				self.possible.delete(orientation);
			}
		}
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
		const full = polygon.fully_connected;
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

	/**
	 * Returns a copy of the cell
	 * @returns {Cell}
	 */
	self.clone = function () {
		const clone = new Cell(polygon, 0);
		clone.initial = self.initial;
		clone.possible = new Set(self.possible);
		clone.walls = self.walls;
		clone.connections = self.connections;
		return clone;
	};

	return self;
}

const emptyCallback = (/**@type {SolverProgress} */ progress) => {};

/**
 * @constructor
 * @param {Number[]} tiles - tile index in grid
 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
 */
export function Solver(tiles, grid) {
	let self = this;
	self.tiles = tiles;
	self.grid = grid;
	self.progress_callback = emptyCallback;

	self.UNSOLVED = -1;
	self.AMBIGUOUS = -2;

	/** @type {Map<Number, Cell>} */
	self.unsolved = new Map([]);

	/** @type {Map<Number, Set<Number>>} */
	self.components = new Map([]);

	/** @type {Number[]} */
	self.solution = tiles.map(() => self.UNSOLVED);

	/** @type {Number[][]} */
	self.solutions = [];

	/** @type {Set<Number>} */
	self.dirty = new Set();

	// ruling out orientations connecting only deadends messes up
	// solving very small instances
	// so it's only enabled if there's enough tiles
	self.checkDeadendConnections =
		self.grid.total - self.grid.emptyCells.size > self.grid.DIRECTIONS.length + 1;

	/**
	 * Returns the cell at index. Initializes the cell if necessary.
	 * @param {Number} index
	 * @returns {Cell}
	 */
	self.getCell = function (index) {
		let cell = self.unsolved.get(index);
		if (cell !== undefined) {
			return cell;
		}
		cell = new Cell(self.grid.polygon_at(index), self.tiles[index]);
		self.unsolved.set(index, cell);
		self.doLocalDeductions(index, cell);
		return cell;
	};

	/**
	 * Merges components between cell at index and its neighbour
	 * @param {Number} index
	 * @param {Number} neighbourIndex
	 */
	self.mergeComponents = function (index, neighbourIndex) {
		const component = self.components.get(index);
		if (component === undefined) {
			throw 'Component to merge is undefined!';
		}
		const neighbourComponent = self.components.get(neighbourIndex) || new Set([neighbourIndex]);
		if (component === neighbourComponent) {
			throw new LoopDetectedException();
		}
		// loop avoidance logic
		// for every joining cell check if it has neighbours already in component
		// and add a wall between them in this case

		// also check if any adjacent tiles could form a bridge between tiles
		// already in component and forbid that
		/** @type {Set<Number>} */
		const adjacentIndices = new Set();
		for (let otherIndex of neighbourComponent) {
			self.components.set(otherIndex, component);
			component.add(otherIndex);
			const cell = self.getCell(otherIndex);
			const occupiedDirections = cell.walls + cell.connections;
			let forbidden = 0;
			for (let direction of self.grid.polygon_at(otherIndex).directions) {
				if ((occupiedDirections & direction) > 0) {
					continue;
				}
				const adjacent = self.grid.find_neighbour(otherIndex, direction);
				if (adjacent.empty) {
					continue;
				}
				if (component.has(adjacent.neighbour)) {
					forbidden += direction;
				} else {
					adjacentIndices.add(adjacent.neighbour);
				}
			}
			if (forbidden > 0) {
				cell.mustHaveAllWalls(forbidden);
				self.dirty.add(otherIndex);
			}
		}
		for (let adjacentIndex of adjacentIndices) {
			const cell = self.getCell(adjacentIndex);
			const occupiedDirections = cell.walls + cell.connections;
			let forbidden = 0;
			let forbiddenCount = 0;
			for (let direction of self.grid.polygon_at(adjacentIndex).directions) {
				if ((occupiedDirections & direction) > 0) {
					continue;
				}
				const neighbour = self.grid.find_neighbour(adjacentIndex, direction).neighbour;
				if (component.has(neighbour)) {
					forbidden += direction;
					forbiddenCount += 1;
				}
			}
			if (forbiddenCount > 1) {
				if (cell.mustHaveSomeWalls(forbidden)) {
					self.dirty.add(adjacentIndex);
				}
				// console.log({
				// 	forbidden,
				// 	adjacentIndex,
				// 	tiles: [...component],
				// 	possible: [...cell.possible]
				// });
			}
		}
	};

	/**
	 * Checks if any orientations can be ruled out based on immediate neighbours
	 * @param {Number} index
	 * @param {Cell} cell - cell at index
	 */
	self.doLocalDeductions = function (index, cell) {
		if (cell.possible.size === 1) {
			// either empty or fully connected, is solved right away
			self.dirty.add(index);
			return;
		}
		const polygon = self.grid.polygon_at(index);
		const tileType = polygon.tileTypes.get(cell.initial);
		if (tileType === undefined) {
			throw 'Unknown tile type at index ' + index;
		}
		const possibleBefore = cell.possible.size;

		// collect neighbour tile types
		/** @type {(import('$lib/puzzle/grids/polygonutils').TileType|null)[]} */
		const neighbourTiles = [];
		const full = polygon.fully_connected;
		let walls = 0;
		let invalidDirections = 0;
		for (let direction of polygon.directions) {
			if ((full & direction) === 0) {
				// invalid direction that should be disregarged
				neighbourTiles.push(null);
				invalidDirections += direction;
				continue;
			}
			const { neighbour, empty } = self.grid.find_neighbour(index, direction);
			if (empty) {
				walls += direction;
				neighbourTiles.push(null);
			} else {
				const tileType = self.grid.polygon_at(neighbour).tileTypes.get(self.tiles[neighbour]);
				if (tileType === undefined) {
					throw `Undefined tile type for tile ${self.tiles[neighbour]} at index ${neighbour}`;
				} else {
					neighbourTiles.push(tileType);
				}
			}
		}
		// remove orientations that contradict outer walls
		// any grid
		if (walls > 0) {
			cell.addWall(walls);
			cell.mustHaveAllWalls(walls);
		}
		if (invalidDirections > 0) {
			cell.mustHaveAllWalls(invalidDirections);
		}
		// remove orientations that connect only deadends
		// any grid
		if (self.checkDeadendConnections) {
			let deadendConnections = 0;
			for (let [i, neighbourTile] of neighbourTiles.entries()) {
				if (neighbourTile?.isDeadend) {
					deadendConnections += polygon.directions[i];
				}
			}
			cell.mustHaveOtherConnections(deadendConnections);
		}

		// Hexagrid specific tricks
		if (self.grid instanceof HexaGrid || self.grid instanceof OctaGrid) {
			// can't connect middle prongs to a sharp turns tile
			if (tileType.hasThreeOrMoreAdjacentConnections) {
				for (let [i, neighbourTile] of neighbourTiles.entries()) {
					if (neighbourTile?.hasOnlyAdjacentConnections) {
						const direction = polygon.directions[i];
						const forbidden =
							direction + polygon.rotate(direction, 1) + polygon.rotate(direction, -1);
						cell.mustHaveOtherConnections(forbidden);
					}
				}
			}

			// must connect psi-likes when they are adjacent
			if (tileType.hasNoAdjacentWalls) {
				for (let [i, neighbourTile] of neighbourTiles.entries()) {
					if (neighbourTile?.hasNoAdjacentWalls) {
						const direction = polygon.directions[i];
						cell.mustHaveAllConnections(direction);
					}
				}
			}

			// never make two adjacent walls next to a psi & co
			if (!tileType.hasNoAdjacentWalls) {
				for (let [i, neighbourTile] of neighbourTiles.entries()) {
					if (neighbourTile?.hasNoAdjacentWalls) {
						const direction = polygon.directions[i];
						let forbidden = 0;
						const i1 = (i + 1) % polygon.directions.length;
						if (neighbourTiles[i1]?.hasNoAdjacentConnections) {
							forbidden += polygon.directions[i1];
						}
						const i2 = (i + polygon.directions.length - 1) % polygon.directions.length;
						if (neighbourTiles[i2]?.hasNoAdjacentConnections) {
							forbidden += polygon.directions[i2];
						}
						if (forbidden === 0) {
							continue;
						}
						for (let orientation of cell.possible) {
							if ((orientation & forbidden) > 0 && (orientation & direction) === 0) {
								cell.possible.delete(orientation);
							}
						}
					}
				}
			}
		}

		if (cell.possible.size < possibleBefore) {
			// deduced something...
			self.dirty.add(index);
		}
	};

	/**
	 * Process new info on cells
	 * Removes orientations that contradict known constraints
	 * Creates new walls/connections if remaining orientations require them
	 * @yields {Step} - info about the processed cell
	 */
	self.processDirtyCells = function* () {
		while (self.dirty.size > 0) {
			// get a dirty cell
			const index = self.dirty.keys().next().value;
			const cell = self.getCell(index);
			if (cell === undefined) {
				continue;
			}
			const polygon = self.grid.polygon_at(index);
			// console.log('start processing dirty cell at', index, [...self.dirty]);
			// console.log({
			// 	walls: cell.walls,
			// 	connections: cell.connections,
			// 	possible: [...cell.possible]
			// });
			// apply constraints to limit possible orientations
			const { addedWalls, addedConnections } = cell.applyConstraints();
			// create a component for this tile if it got a connection
			if (addedConnections > 0 && !self.components.has(index)) {
				self.components.set(index, new Set([index]));
			}
			// add walls to walled off neighbours
			if (addedWalls > 0) {
				for (let direction of polygon.directions) {
					if ((direction & addedWalls) > 0) {
						const { neighbour, empty } = self.grid.find_neighbour(index, direction);
						if (empty) {
							continue;
						}
						const neighbourCell = self.getCell(neighbour);
						neighbourCell.addWall(self.grid.OPPOSITE.get(direction) || 0);
						// console.log('add wall to', neighbour, 'in direction', direction);
						self.dirty.add(neighbour);
					}
				}
			}
			// add connections to connected neighbours
			if (addedConnections > 0) {
				for (let direction of polygon.directions) {
					if ((direction & addedConnections) > 0) {
						const { neighbour, empty } = self.grid.find_neighbour(index, direction);
						if (empty) {
							throw 'Trying to connect to an empty neighbour!';
						}
						const neighbourCell = self.getCell(neighbour);
						neighbourCell.addConnection(self.grid.OPPOSITE.get(direction) || 0);
						// console.log('add connection to', neighbour, 'in direction', direction);
						self.mergeComponents(index, neighbour);
						self.dirty.add(neighbour);
					}
				}
			}
			// check if cell is solved
			const orientation = cell.possible.keys().next().value;
			const final = cell.possible.size === 1;
			if (final) {
				// remove solved cell from its component
				const component = self.components.get(index);
				if (component !== undefined) {
					component.delete(index);
					if (component.size === 0 && self.unsolved.size > 1) {
						throw new IslandDetectedException();
					}
				}
				self.solution[index] = orientation;
				self.unsolved.delete(index);
				self.components.delete(index);
			}
			// console.log({ index, orientation, final, possible: [...cell.possible] });
			yield { index, orientation, final };
			self.dirty.delete(index);
			// if (self.dirty.size === 0) {
			// 	// whip out heavy logic
			// 	self.avoidIslands();
			// }
		}
	};

	/**
	 * Iterate over connected components and try to figure something out
	 */
	self.avoidIslands = function () {
		const components = new Set(self.components.values());
		const potentialIslands = new Set();
		for (let component of components) {
			if (component.size > 1) {
				continue;
			}
			const index = component.values().next().value;
			const cell = self.getCell(index);
			const remainingConnections = cell.possible.values().next().value - cell.connections;
			const tileType = self.grid.polygon_at(index).tileTypes.get(remainingConnections);
			if (tileType?.isDeadend) {
				potentialIslands.add(index);
			}
		}
		const adjacentIndices = new Set();
		for (let index of potentialIslands) {
			const cell = self.getCell(index);
			const polygon = self.grid.polygon_at(index);
			const occupiedDirections = cell.connections + cell.walls;
			let forbidden = 0;
			for (let direction of polygon.directions) {
				if ((direction & occupiedDirections) > 0) {
					continue;
				}
				const { neighbour, empty } = self.grid.find_neighbour(index, direction);
				if (empty) {
					continue;
				}
				if (potentialIslands.has(neighbour)) {
					forbidden += direction;
				} else {
					adjacentIndices.add(neighbour);
				}
			}
			if (forbidden > 0) {
				if (cell.mustHaveSomeWalls(forbidden)) {
					// console.log({ index, forbidden, possible: [...cell.possible] });
					self.dirty.add(index);
				}
			}
		}
		for (let index of adjacentIndices) {
			const cell = self.getCell(index);
			const polygon = self.grid.polygon_at(index);
			const occupiedDirections = cell.connections + cell.walls;
			let forbidden = 0;
			let forbiddenCount = 0;
			for (let direction of polygon.directions) {
				if ((direction & occupiedDirections) > 0) {
					continue;
				}
				const { neighbour, empty } = self.grid.find_neighbour(index, direction);
				if (empty) {
					continue;
				}
				if (potentialIslands.has(neighbour)) {
					forbidden += direction;
					forbiddenCount += 1;
				}
			}
			if (forbiddenCount > 1) {
				if (cell.mustHaveOtherConnections(forbidden)) {
					// console.log({ index, forbidden, possible: [...cell.possible], type: 'adjacent' });
					self.dirty.add(index);
				}
			}
		}
	};
	/**
	 * Makes a copy of the solver
	 * @return {Solver}
	 */
	self.clone = function () {
		const clone = new Solver([], self.grid);
		clone.unsolved = new Map([]);
		self.unsolved.forEach((cell, index) => {
			clone.unsolved.set(index, cell.clone());
		});
		clone.components = new Map([]);
		self.components.forEach((component, index) => {
			const newComponent = new Set(component);
			for (let componentCell of newComponent) {
				if (clone.components.has(componentCell)) {
					break;
				}
				clone.components.set(componentCell, newComponent);
			}
		});
		clone.solution = [...self.solution];
		clone.dirty = new Set();
		return clone;
	};

	/**
	 * Chooses a tile/orientation to try out.
	 * Selects an orientation from a tile with the least number of options
	 * @returns {Number[]} - [index, orientation]
	 */
	self.makeAGuess = function () {
		let minPossibleSize = Number.POSITIVE_INFINITY;
		let guessIndex = -1;
		for (let [index, cell] of self.unsolved.entries()) {
			if (cell.possible.size < minPossibleSize) {
				guessIndex = index;
				minPossibleSize = cell.possible.size;
				if (minPossibleSize == 2) {
					break;
				}
			}
		}
		const cell = self.unsolved.get(guessIndex);
		if (cell === undefined) {
			throw 'Cell selected for guessing is undefined!';
		}
		const orientation = cell.possible.keys().next().value;
		cell.possible = new Set([orientation]);
		self.dirty.add(guessIndex);
		return [guessIndex, orientation];
	};

	/**
	 * Solve the puzzle
	 * @param {boolean} allSolutions = false, whether to find all solutions.
	 * If false then stops as soon as the first one is found
	 * @yields {{stage:{SolvingStage}, step:{Step}}}
	 */
	self.solve = function* (allSolutions = false) {
		if (self.dirty.size === 0) {
			const toInit = new Set();
			// process empty cells first, then the rest
			for (let index = 0; index < grid.total; index++) {
				if (grid.emptyCells.has(index)) {
					self.dirty.add(index);
				} else {
					toInit.add(index);
				}
			}
			while (toInit.size > 0) {
				const nextTile = toInit.values().next().value;
				toInit.delete(nextTile);
				if (self.unsolved.has(nextTile)) {
					continue;
				}
				self.dirty.add(nextTile);
				for (let step of self.processDirtyCells()) {
					toInit.delete(step.index);
					if (step.orientation === 0) {
						// don't report processing empty cell as a step
						continue;
					}
					yield { stage: 'initial', step };
				}
			}
		}

		/** @type {{index: Number, guess: Number, solver:Solver}[]} */
		const trials = [{ index: -1, guess: -1, solver: self }];
		let iter = 0;
		while (trials.length > 0) {
			iter += 1;
			// if (iter > 100) {
			// 	break;
			// }
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) {
				break;
			}
			const { index, guess, solver } = lastTrial;
			try {
				let stage = trials.length === 1 ? 'initial' : 'guess';
				stage = self.solutions.length === 0 ? stage : 'aftercheck';
				for (let step of solver.processDirtyCells()) {
					yield { stage, step };
				}
			} catch (error) {
				// something went wrong, no solution here
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const cell = parent.unsolved.get(index);
					cell?.possible.delete(guess);
					parent.dirty.add(index);
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
					const cell = parent.unsolved.get(index);
					cell?.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else {
					break;
				}
			} else {
				// we have to make a guess
				const clone = solver.clone();
				const [index, orientation] = clone.makeAGuess();
				trials.push({
					index,
					guess: orientation,
					solver: clone
				});
			}
		}
	};

	self.shortTrialsIndex = 0;
	/**
	 * Check orientations of unsolved cells to see if they produce contradictions quickly
	 * Returns true if solver manages to exclude some orientation, false otherwise
	 * @param {Number[]} marked
	 * @returns {boolean}
	 */
	self.doShortTrials = function (marked = []) {
		for (let i = this.shortTrialsIndex; i < this.shortTrialsIndex + this.grid.total; i++) {
			const index = i % this.grid.total;
			const cell = self.unsolved.get(index);
			if (cell === undefined) {
				continue;
			}
			if (marked[index] === this.AMBIGUOUS) {
				continue;
			}
			for (let orientation of cell.possible) {
				const clone = self.clone();
				const cloneCell = clone.unsolved.get(index);
				if (cloneCell === undefined) {
					throw 'Clone cell is undefined';
				}
				cloneCell.possible = new Set([orientation]);
				clone.dirty.add(index);
				try {
					for (let step of clone.processDirtyCells()) {
						// do nothing, hope for an error
					}
				} catch (e) {
					cell.possible.delete(orientation);
					self.dirty.add(index);
					self.shortTrialsIndex = index;
					return true;
				}
			}
		}
		return false;
	};

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
	self.markAmbiguousTiles = function (ambiguousTilesLimit = 0) {
		let marked = [...self.solution];
		let unique = true;
		let numAmbiguous = 0;
		const total = self.grid.total - self.grid.emptyCells.size;
		// process what we can for a start
		try {
			if (self.dirty.size === 0) {
				// process empty cells first, then the rest
				const toInit = new Set();
				for (let index = 0; index < grid.total; index++) {
					if (grid.emptyCells.has(index)) {
						self.dirty.add(index);
					} else {
						toInit.add(index);
					}
				}
				while (toInit.size > 0) {
					const nextTile = toInit.values().next().value;
					toInit.delete(nextTile);
					if (self.unsolved.has(nextTile)) {
						continue;
					}
					self.dirty.add(nextTile);
					for (let step of self.processDirtyCells()) {
						toInit.delete(step.index);
						if (step.final) {
							marked[step.index] = step.orientation;
						}
					}
				}
			}
		} catch (error) {
			return { marked, solvable: false, unique: false, numAmbiguous };
		}
		// console.log('done initial deductions, unsolved size', self.unsolved.size);
		// console.log(solution);
		/** @type {{index: Number, guess: Number, solver:Solver}[]} */
		const trials = [{ index: -1, guess: -1, solver: self }];
		let iter = 0;
		while (trials.length > 0) {
			iter += 1;
			// console.log('starting iter', iter);
			// if (iter > 100) {
			// 	break;
			// }
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) {
				break;
			}
			const { index, guess, solver } = lastTrial;
			self.progress_callback({
				total,
				ambiguous: numAmbiguous,
				guessed: trials.length - 1,
				solved: total - trials[0].solver.unsolved.size
			});
			// console.log('unsolved at start', new Map(solver.unsolved.entries()));
			try {
				for (let _ of solver.processDirtyCells()) {
				}
				if (trials.length === 1 && solver.doShortTrials()) {
					continue;
				}
				// console.log('unsolved after cleanup', new Map(solver.unsolved.entries()));
			} catch (error) {
				// console.log('smth went wrong', error);
				// something went wrong, no solution here
				if (trials.length > 1) {
					// console.log('error, destroying this trial');
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const cell = parent.unsolved.get(index);
					cell?.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else {
					// console.log('this was the last trial, exit loop');
					break;
				}
			}
			if (solver.unsolved.size == 0) {
				// got a solution
				// console.log('got a solution');
				numAmbiguous = 0;
				for (let i = 0; i < marked.length; i++) {
					if (marked[i] === self.UNSOLVED) {
						marked[i] = solver.solution[i];
					} else if (marked[i] === self.AMBIGUOUS) {
						numAmbiguous += 1;
						// do nothing
					} else if (marked[i] !== solver.solution[i]) {
						// console.log('ambiguous tile', i);
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
					return { marked, solvable: true, unique, numAmbiguous };
				}
				if (trials.length > 1) {
					// console.log('checking other option to', index, guess);
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const cell = parent.unsolved.get(index);
					cell?.possible.delete(guess);
					parent.dirty.add(index);
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
				let guessIndex = -1;
				for (let [index, cell] of clone.unsolved.entries()) {
					if (marked[index] === self.AMBIGUOUS) {
						continue;
					}
					if (cell.possible.size < minPossibleSize) {
						guessIndex = index;
						minPossibleSize = cell.possible.size;
						if (minPossibleSize == 2) {
							break;
						}
					}
				}
				const cell = clone.unsolved.get(guessIndex);
				if (cell === undefined) {
					// console.log('can not guess because only ambiguous tiles are left');
					solver.unsolved = new Map();
					continue;
				}
				const orientation = cell.possible.keys().next().value;
				cell.possible = new Set([orientation]);
				clone.dirty.add(guessIndex);

				// console.log('making a guess', guessIndex, orientation);
				trials.push({
					index: guessIndex,
					guess: orientation,
					solver: clone
				});
			}
		}
		const solvable = marked.every((tile) => tile !== self.UNSOLVED);
		self.progress_callback({
			total,
			ambiguous: numAmbiguous,
			guessed: 0,
			solved: total - numAmbiguous
		});
		return { marked, solvable, unique, numAmbiguous };
	};
}
