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
		self.walls += direction - ((self.connections + self.walls) & direction);
	};

	/**
	 * @param {Number} direction
	 */
	self.addConnection = function (direction) {
		self.connections += direction - ((self.connections + self.walls) & direction);
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

	self.UNSOLVED = -1;
	self.AMBIGUOUS = -2;

	/** @type {Map<Number, Cell>} */
	self.unsolved = new Map([]);

	/** @type {Map<Number, Set<Number>>} */
	self.components = new Map([]);

	const directions = new Set(grid.DIRECTIONS);

	const T0 = 0;
	const T1 = 1;
	const T2v = 3;
	const T2c = 5;
	const T2I = 9;
	const T3w = 7;
	const T3y = 11;
	const T3la = 13;
	const T3Y = 21;
	const T4K = 15;
	const T4X = 27;
	const T4psi = 23;
	const T5 = 31;
	const T6 = 63;
	/** @type {Map<Number,Number>} */
	const tileTypes = new Map();
	for (let t = 0; t < self.grid.fullyConnected(0); t++) {
		let rotated = t;
		while (!tileTypes.has(rotated)) {
			tileTypes.set(rotated, t);
			rotated = self.grid.rotate(rotated, 1);
		}
	}

	/** @type {Number[]} */
	self.solution = tiles.map(() => self.UNSOLVED);

	/** @type {Number[][]} */
	self.solutions = [];

	/** @type {Set<Number>} */
	self.dirty = new Set();

	// ruling out orientations connecting only deadends messes up
	// solving very small instances
	// so it's only enabled if there's enough tiles
	self.checkDeadendConnections = self.grid.total > self.grid.DIRECTIONS.length + 1;

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
		for (let otherIndex of neighbourComponent) {
			self.components.set(otherIndex, component);
			component.add(otherIndex);
		}
	};

	self.avoidLoops = function () {
		/** @type {Set<Number>} */
		const checked = new Set();
		for (let [cellIndex, component] of self.components.entries()) {
			if (checked.has(cellIndex)) {
				continue;
			}
			component.forEach((i) => checked.add(i));
			if (component.size < 3) {
				continue;
			}
			for (let index of component) {
				const cell = self.unsolved.get(index);
				if (cell === undefined) {
					throw 'Component cell is undefined';
				}
				const occupiedDirections = cell.walls + cell.connections;
				for (let direction of self.grid.DIRECTIONS) {
					if ((occupiedDirections & direction) > 0) {
						continue;
					}
					const neighbourIndex = self.grid.find_neighbour(index, direction).neighbour;
					if (component.has(neighbourIndex)) {
						// console.log('add wall btw', index, neighbourIndex);
						cell.addWall(direction);
						self.dirty.add(index);
						const neighbourCell = self.unsolved.get(neighbourIndex);
						neighbourCell?.addWall(self.grid.OPPOSITE.get(direction) || 0);
						self.dirty.add(neighbourIndex);
					}
				}
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

		const tile = tileTypes.get(cell.initial);
		const possibleBefore = cell.possible.size;

		// collect neighbour tile types
		/** @type {Number[]} */
		const neighbourTiles = [];
		let walls = 0;
		for (let direction of self.grid.DIRECTIONS) {
			const { neighbour, empty } = self.grid.find_neighbour(index, direction);
			if (neighbour === -1) {
				walls += direction;
			}
			neighbourTiles.push(tileTypes.get(self.tiles[neighbour]) || self.UNSOLVED);
		}
		// remove orientations that contradict outer walls
		// any grid
		if (walls > 0) {
			cell.addWall(walls);
			for (let orientation of cell.possible) {
				if ((orientation & walls) > 0) {
					cell.possible.delete(orientation);
				}
			}
		}

		// remove orientations that connect only deadends
		// any grid
		if (self.checkDeadendConnections) {
			let deadendConnections = 0;
			for (let [i, neighbourTile] of neighbourTiles.entries()) {
				if (neighbourTile === T1) {
					deadendConnections += self.grid.DIRECTIONS[i];
				}
			}
			for (let orientation of cell.possible) {
				if ((orientation & deadendConnections) === orientation) {
					cell.possible.delete(orientation);
				}
			}
		}

		// Hexagrid specific tricks

		// can't connect middle prongs to a sharp turns tile
		if ([T4K, T3w, T5, T4psi].some((x) => x === tile)) {
			for (let [i, neighbourTile] of neighbourTiles.entries()) {
				if ([T4K, T2v, T3w, T5, T4X].some((x) => x === neighbourTile)) {
					const direction = self.grid.DIRECTIONS[i];
					const forbidden =
						direction + self.grid.rotate(direction, 1) + self.grid.rotate(direction, -1);
					for (let orientation of cell.possible) {
						if ((orientation & forbidden) === forbidden) {
							cell.possible.delete(orientation);
						}
					}
				}
			}
		}

		// must connect psi-likes when they are adjacent
		if ([T4psi, T4X, T5, T3Y].some((x) => x === tile)) {
			for (let [i, neighbourTile] of neighbourTiles.entries()) {
				if ([T4psi, T4X, T5, T3Y].some((x) => x === neighbourTile)) {
					const direction = self.grid.DIRECTIONS[i];
					for (let orientation of cell.possible) {
						if ((orientation & direction) === 0) {
							cell.possible.delete(orientation);
						}
					}
				}
			}
		}

		// never make two adjacent walls next to a psi & co
		if ([T4psi, T4X, T5, T3Y].every((x) => x !== tile)) {
			for (let [i, neighbourTile] of neighbourTiles.entries()) {
				if ([T4psi, T4X, T5, T3Y].some((x) => x === neighbourTile)) {
					const direction = self.grid.DIRECTIONS[i];
					let forbidden = 0;
					if ([T1, T2c, T2I].some((x) => x === neighbourTiles[(i + 1) % 6])) {
						forbidden += self.grid.DIRECTIONS[(i + 1) % 6];
					}
					if ([T1, T2c, T2I].some((x) => x === neighbourTiles[(i + 5) % 6])) {
						forbidden += self.grid.DIRECTIONS[(i + 5) % 6];
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
						const { neighbour, empty } = self.grid.find_neighbour(index, direction);
						if (empty) {
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
						const { neighbour, empty } = self.grid.find_neighbour(index, direction);
						if (empty) {
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
			yield { index, orientation, final };
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
	 * Selects a tile type that has a single possible orientation in this cell.
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
			for (let index of grid.emptyCells) {
				toInit.add(index);
			}
			for (let index = 0; index < grid.width * grid.height; index++) {
				toInit.add(index);
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

	/**
	 * Solve the puzzle but mark ambiguous areas with a special value
	 * Does not yield steps
	 * If the solution is unique then marked == solution
	 * @returns {{
	 * 	marked: Number[],
	 *  solvable: boolean,
	 * 	unique: boolean,
	 * }} - marked tiles, whether a puzzle is solvable, whether the solution is unique,
	 */
	self.markAmbiguousTiles = function () {
		let marked = [...self.solution];
		let unique = true;
		// process what we can for a start
		try {
			if (self.dirty.size === 0) {
				// process empty cells first, then the rest
				const toInit = new Set();
				for (let index of grid.emptyCells) {
					toInit.add(index);
				}
				for (let index = 0; index < grid.width * grid.height; index++) {
					toInit.add(index);
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
			return { marked, solvable: false, unique: false };
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
				for (let i = 0; i < marked.length; i++) {
					if (marked[i] === self.UNSOLVED) {
						marked[i] = solver.solution[i];
					} else if (marked[i] === self.AMBIGUOUS) {
						// do nothing
					} else if (marked[i] !== solver.solution[i]) {
						// console.log('ambiguous tile', i);
						marked[i] = self.AMBIGUOUS;
						unique = false;
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
		return { marked, solvable, unique };
	};

	/**
	 * Replace ambiguous tiles with other tiles to get a puzzle
	 * with a unique solution
	 * @param {Number[]} marked
	 * @returns
	 */
	self.fixAmbiguousTiles = function (marked) {
		self.solution = marked.map((tile) => (tile === self.AMBIGUOUS ? self.UNSOLVED : tile));
		self.tiles = marked;
		self.components.clear();
		self.unsolved.clear();
		self.dirty.clear();
		let numAmbiguous = Number.POSITIVE_INFINITY;
		// Allow any tiles in ambiguous places
		// All other tiles stay completely fixed
		for (let [index, tile] of marked.entries()) {
			const cell = self.getCell(index);
			self.dirty.add(index);
			if (marked[index] !== self.AMBIGUOUS) {
				// this is a solved cell, only allow it one orientation
				cell.possible = new Set([tile]);
			}
		}
		// Process dirty cells so that only ambiguous areas are left unsolved
		// This ensures correct borders/components info in ambiguous areas
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
				const checkSolution = checkSolver.markAmbiguousTiles();
				if (checkSolution.unique) {
					// it's a win
					return checkSolution.marked;
				}
				let newNumAmbiguous = marked.reduce((s, tile) => s + (tile === self.AMBIGUOUS ? 1 : 0));
				if (newNumAmbiguous < numAmbiguous) {
					numAmbiguous = newNumAmbiguous;
					self.solution = [...solver.solution];
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
		// getting here implies we only got multiple solutions
		// but maybe with less ambiguity than before
		return self.solution;
	};
}
