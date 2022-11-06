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
	if (initial >= 0) {
		let rotated = initial;
		while (!self.possible.has(rotated)) {
			self.possible.add(rotated);
			rotated = grid.rotate(rotated, 1, index);
		}
	} else {
		// special case of null tile - can have any tile type/orientation
		// TODO let the grid supply this set depending on index
		self.possible = new Set();
		for (let i = 1; i < grid.fullyConnected(index); i++) {
			self.possible.add(i);
		}
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

	/**
	 * Returns a copy of the cell
	 * @returns {Cell}
	 */
	self.clone = function () {
		const clone = new Cell(grid, self.index, 0);
		clone.initial = self.initial;
		clone.possible = new Set(self.possible);
		clone.walls = self.walls;
		clone.connections = self.connections;
		return clone;
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
	self.tiles = tiles;
	self.grid = grid;

	/** @type {Map<Number, Cell>} */
	self.unsolved = new Map([]);

	/** @type {Map<Number, Set<Number>>} */
	self.components = new Map([]);

	const directions = new Set(grid.DIRECTIONS);

	/** @type {Number[]} */
	self.solution = tiles.map(() => -1);

	/** @type {Number[][]} */
	self.solutions = [];

	/** @type {Set<Number>} */
	self.dirty = new Set();

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
		cell = new Cell(self.grid, index, self.tiles[index]);
		self.unsolved.set(index, cell);

		if (cell.possible.size === 1) {
			self.dirty.add(index);
		} else {
			let deadendConnections = 0;
			for (let direction of self.grid.DIRECTIONS) {
				const { neighbour } = self.grid.find_neighbour(index, direction);
				if (neighbour === -1) {
					cell.addWall(direction);
					self.dirty.add(index);
				} else {
					const neighbourTile = self.tiles[neighbour] || 0;
					if (directions.has(neighbourTile)) {
						// neighbour is a deadend
						deadendConnections += direction;
					}
				}
			}
			if (deadendConnections > 0) {
				const newPossible = new Set();
				// TODO - delete from existing set instead
				for (let orientation of cell.possible) {
					if (
						// orientation does not only connect deadends
						(orientation & deadendConnections) !==
						orientation
					) {
						newPossible.add(orientation);
					}
				}
				if (newPossible.size < cell.possible.size) {
					cell.possible = newPossible;
					self.dirty.add(index);
				}
			}
		}
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
		const neighbourComponent = self.components.get(neighbourIndex);
		if (component === neighbourComponent) {
			throw new LoopDetectedException();
		}
		if (neighbourComponent === undefined) {
			component.add(neighbourIndex);
			self.components.set(neighbourIndex, component);
		} else {
			for (let otherIndex of neighbourComponent) {
				self.components.set(otherIndex, component);
				component.add(otherIndex);
			}
		}
	};

	self.processDirtyCells = function* () {
		while (self.dirty.size > 0) {
			// get a dirty cell
			const index = self.dirty.keys().next().value;
			const cell = self.getCell(index);
			if (cell === undefined) {
				continue;
			}
			// apply constraints to limit possible orientations
			const { addedWalls, addedConnections } = cell.applyConstraints();
			// create a component for this tile if it got a connection
			if (addedConnections > 0 && !self.components.has(index)) {
				self.components.set(index, new Set([index]));
			}
			// add walls to walled off neighbours
			if (addedWalls > 0) {
				for (let direction of self.grid.DIRECTIONS) {
					if ((direction & addedWalls) > 0) {
						const { neighbour } = self.grid.find_neighbour(index, direction);
						if (neighbour === -1) {
							continue;
						}
						const neighbourCell = self.getCell(neighbour);
						if (neighbourCell === undefined) {
							continue;
						}
						neighbourCell.addWall(self.grid.OPPOSITE.get(direction) || 0);
						self.dirty.add(neighbour);
					}
				}
			}
			// add connections to connected neighbours
			if (addedConnections > 0) {
				for (let direction of self.grid.DIRECTIONS) {
					if ((direction & addedConnections) > 0) {
						const { neighbour } = self.grid.find_neighbour(index, direction);
						if (neighbour === -1) {
							continue;
						}
						const neighbourCell = self.getCell(neighbour);
						if (neighbourCell === undefined) {
							continue;
						}
						neighbourCell.addConnection(self.grid.OPPOSITE.get(direction) || 0);
						self.mergeComponents(index, neighbour);
						self.dirty.add(neighbour);
					}
				}
			}
			// check if cell is solved
			if (cell.possible.size === 1) {
				// remove solved cell from its component
				const component = self.components.get(index);
				if (component !== undefined) {
					component.delete(index);
					if (component.size === 0 && self.unsolved.size > 1) {
						throw new IslandDetectedException();
					}
				}
				const orientation = cell.possible.keys().next().value;
				self.solution[index] = orientation;
				self.unsolved.delete(index);
				self.components.delete(index);
				yield [index, orientation];
			}
			self.dirty.delete(index);
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
	 * Chooses a tile/orientation to try out.
	 * Used when fixing multiple solutions.
	 * Selects an tile type that has a single possible orientation in this cell.
	 * If there is no way to do this then uses regular guessing
	 * @returns {Number[]} - [index, orientation]
	 */
	self.makeAGuessUnique = function () {
		let guessIndex = -1;
		let guessOrientation = -1;
		for (let [index, cell] of self.unsolved.entries()) {
			const toCheck = new Set(cell.possible);
			while (toCheck.size > 0) {
				const orientation = toCheck.values().next().value;
				toCheck.delete(orientation);
				let rotation = self.grid.rotate(orientation, 1, index);
				let isUnique = true;
				while (rotation !== orientation) {
					if (cell.possible.has(rotation)) {
						isUnique = false;
						toCheck.delete(rotation);
					}
					rotation = self.grid.rotate(rotation, 1, index);
				}
				if (isUnique) {
					guessIndex = index;
					guessOrientation = orientation;
					break;
				}
			}
			if (guessIndex !== -1) {
				break;
			}
		}
		if (guessIndex === -1) {
			return self.makeAGuess();
		}
		const cell = self.unsolved.get(guessIndex);
		if (cell === undefined) {
			throw 'Cell selected for guessing is undefined!';
		}
		cell.possible = new Set([guessOrientation]);
		self.dirty.add(guessIndex);
		return [guessIndex, guessOrientation];
	};

	self.solve = function* () {
		if (self.dirty.size === 0) {
			const toInit = new Set([...Array(grid.width * grid.height).keys()]);
			while (toInit.size > 0) {
				const nextTile = toInit.values().next().value;
				toInit.delete(nextTile);
				if (self.unsolved.has(nextTile)) {
					continue;
				}
				self.dirty.add(nextTile);
				for (let [index, orientation] of self.processDirtyCells()) {
					toInit.delete(index);
					yield [index, orientation];
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
				for (let step of solver.processDirtyCells()) {
					if (self.solutions.length === 0) {
						yield step;
					}
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

	const UNSOLVED = -1;
	const AMBIGUOUS = -2;

	// This is like solve but marks ambiguous areas with a special value
	// Does not yield steps
	// For a puzzle with a unique solution just returns the solution
	self.markAmbiguousTiles = function () {
		let solution = [...self.solution];
		// process what we can for a start
		if (self.dirty.size === 0) {
			const toInit = new Set([...Array(grid.width * grid.height).keys()]);
			while (toInit.size > 0) {
				const nextTile = toInit.values().next().value;
				toInit.delete(nextTile);
				if (self.unsolved.has(nextTile)) {
					continue;
				}
				self.dirty.add(nextTile);
				for (let [index, orientation] of self.processDirtyCells()) {
					toInit.delete(index);
					solution[index] = orientation;
				}
			}
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
			// console.log('unsolved at start', new Map(solver.unsolved.entries()));
			try {
				for (let _ of solver.processDirtyCells()) {
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
				for (let i = 0; i < solution.length; i++) {
					if (solution[i] === UNSOLVED) {
						solution[i] = solver.solution[i];
					} else if (solution[i] === AMBIGUOUS) {
						// do nothing
					} else if (solution[i] !== solver.solution[i]) {
						// console.log('ambiguous tile', i);
						solution[i] = AMBIGUOUS;
					}
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
					if (solution[index] === AMBIGUOUS) {
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
		return solution;
	};

	/**
	 * Replace ambiguous tiles with other tiles to get a puzzle
	 * with a unique solution
	 * @param {Number[]} solution
	 * @returns
	 */
	self.fixAmbiguousTiles = function (solution) {
		if (solution.every((tile) => tile !== AMBIGUOUS)) {
			// ok as it is
			return solution;
		}
		self.solution = solution;
		self.tiles = solution;
		self.components.clear();
		self.unsolved.clear();
		self.dirty.clear();
		// Allow any tiles in ambiguous places
		// Their direct neighbours can have any orientation but the type stays fixed
		// All other tiles stay completely fixed
		/** @type {Set<Number>} */
		let toRelax = new Set();
		for (let [index, tile] of solution.entries()) {
			const cell = self.getCell(index);
			self.dirty.add(index);
			if (solution[index] === AMBIGUOUS) {
				// do nothing, cell initializes with all possible options
				// any tile, any orientation
				for (let direction of self.grid.DIRECTIONS) {
					const { neighbour } = self.grid.find_neighbour(index, direction);
					if (neighbour !== -1 && solution[neighbour] !== AMBIGUOUS) {
						toRelax.add(neighbour);
					}
				}
			} else {
				// this is a solved cell, only allow it one orientation
				cell.possible = new Set([tile]);
			}
		}
		for (let index of toRelax) {
			const cell = self.unsolved.get(index);
			const tile = cell?.possible.values().next().value;
			self.unsolved.delete(index);
			self.getCell(index);
		}
		// Process dirty cells so that only ambiguous areas are left unsolved
		// This ensures correct borders/components info in ambi-areas
		for (let _ of self.processDirtyCells()) {
		}
		// backup solver for final verification of unique solution
		const backup = self.clone();
		// Start
		/** @type {{index: Number, guess: Number, solver:Solver}[]} */
		const trials = [{ index: -1, guess: -1, solver: self }];
		let iter = 0;
		while (trials.length > 0) {
			iter += 1;
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) {
				break;
			}
			const { index, guess, solver } = lastTrial;
			try {
				for (let _ of solver.processDirtyCells()) {
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
				// do a final check that the solution is unique now
				const checkSolver = backup.clone();
				for (let [index, cell] of backup.unsolved.entries()) {
					const newCell = new Cell(self.grid, index, solver.solution[index]);
					newCell.walls = cell.walls;
					newCell.connections = cell.connections;
					checkSolver.unsolved.set(index, newCell);
					checkSolver.dirty.add(index);
				}
				for (let _ of checkSolver.solve()) {
					// fingers crossed
				}
				if (checkSolver.solutions.length === 1) {
					// it's a win
					return solver.solution;
				}
				// wasn't unique, keep going
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
				const [index, orientation] = clone.makeAGuessUnique();
				trials.push({
					index,
					guess: orientation,
					solver: clone
				});
			}
		}
		return self.solution;
	};
}
