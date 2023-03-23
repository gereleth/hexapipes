import { Cell, Solver } from './solver';

/**
 * @typedef {'unique'|'multiple'|'whatever'} SolutionsNumber
 */

/**
 * Returns a random element from an array
 * @param {Array<any>} array
 */
function getRandomElement(array) {
	const index = Math.floor(Math.random() * array.length);
	return array[index];
}

/**
 * Randomize tile rotations
 * @param {Number[]} tiles
 * @param {import('$lib/puzzle/grids/hexagrid').HexaGrid} grid
 * @returns {Number[]}
 */
function randomRotate(tiles, grid) {
	const numDirections = grid.DIRECTIONS.length;
	return tiles.map((tile, index) => {
		if (tile === 0) {
			return 0;
		}
		let rotated = grid.rotate(tile, Math.floor(Math.random() * numDirections));
		const full = grid.fullyConnected(index);
		while ((full & rotated) === 0) {
			rotated = grid.rotate(rotated, 1);
		}
		return rotated;
	});
}

/**
 * @constructor
 * @param {import('$lib/puzzle/grids/hexagrid').HexaGrid} grid
 */
export function Generator(grid) {
	let self = this;
	self.grid = grid;

	/**
	 * Fills a grid with tiles using GrowingTree algorithm
	 * At branchingAmount = 0 it's like recursive backtracking
	 * At branchingAmount = 1 it's like Prim's algorithm
	 * Intermediate values give some mix of these methods
	 * @param {Number} branchingAmount - a number in range [0, 1], higher values lead to more branching splits
	 * @param {Number} avoidObvious - number in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {Number} avoidStraights - number in range [0, 1], higher values lead to fewer straight tiles
	 * @param {Number[]} startTiles - starting point tiles if we're fixing ambiguities
	 * @returns {Number[]} - unrandomized tiles array
	 */
	this.pregenerate_growingtree = function (
		branchingAmount,
		avoidObvious = 0,
		avoidStraights = 0,
		startTiles = []
	) {
		const total = grid.total;

		/** @type {Set<Number>} A set of unvisited nodes*/
		const unvisited = new Set([...Array(total).keys()]);
		for (let index of grid.emptyCells) {
			unvisited.delete(index);
		}
		/** @type {Number[]} A list of tile shapes */
		const tiles = [];
		for (let i = 0; i < total; i++) {
			tiles.push(0);
		}
		/** @type {Number[]} A list of visited nodes */
		const visited = [];
		/** @type {Number[]} - visited tiles that will become obvious if used again */
		const avoiding = [];
		/** @type {Number[]} - visited tiles that will become fully connected if used again */
		const lastResortNodes = [];

		// reuse non-ambiguous portions of startTiles
		if (startTiles.length === total) {
			const to_check = new Set(unvisited);
			const components = [];
			while (to_check.size > 0) {
				const index = to_check.values().next().value;
				to_check.delete(index);
				if (startTiles[index] < 0) {
					// ambiguous tile, ignore it
					continue;
				}
				const to_visit = new Set([index]);
				const component = new Set();
				while (to_visit.size > 0) {
					const i = to_visit.values().next().value;
					to_visit.delete(i);
					to_check.delete(i);
					component.add(i);
					for (let direction of grid.getDirections(startTiles[i])) {
						const { neighbour, empty } = grid.find_neighbour(i, direction);
						if (empty || startTiles[neighbour] < 0 || component.has(neighbour)) {
							continue;
						}
						to_visit.add(neighbour);
					}
				}
				components.push(component);
				components.sort((a, b) => -(a.size - b.size));
				if (components[0].size >= to_check.size) {
					break;
				}
			}
			// components[0] now has the largest region of non-ambiguous connected tiles
			for (let index of components[0] || []) {
				for (let direction of grid.getDirections(startTiles[index])) {
					const { neighbour } = grid.find_neighbour(index, direction);
					if (components[0].has(neighbour)) {
						tiles[index] += direction;
					}
				}
				visited.push(index);
				unvisited.delete(index);
			}
		}

		/** @type {Map<Number, Number>} tile index => tile walls */
		const borders = new Map();
		/** @type {Map<Number, Set<Number>>} tile walls => set of forbidden types-orientations */
		const forbidden = new Map();
		if (avoidObvious > 0) {
			for (let tileIndex of unvisited) {
				for (let direction of grid.DIRECTIONS) {
					const { neighbour, empty } = grid.find_neighbour(tileIndex, direction);
					if (empty) {
						borders.set(tileIndex, (borders.get(tileIndex) || 0) + direction);
					}
				}
			}
			for (let walls of new Set(borders.values())) {
				let cell = new Cell(self.grid, 0, -1);
				cell.addWall(walls);
				cell.applyConstraints();
				/** @type {Map<Number, Set<Number>>} */
				const tileTypes = new Map();
				for (let orientation of cell.possible) {
					const tileType = self.grid.tileTypes.get(orientation) || 0;
					if (!tileTypes.has(tileType)) {
						tileTypes.set(tileType, new Set());
					}
					tileTypes.get(tileType)?.add(orientation);
				}
				for (let [tileType, orientations] of tileTypes.entries()) {
					if (orientations.size === 1) {
						if (!forbidden.has(walls)) {
							forbidden.set(walls, new Set());
						}
						forbidden.get(walls)?.add(orientations.values().next().value);
					}
				}
			}
		}

		if (visited.length === 0) {
			/** @type {Number} */
			const startIndex = [...unvisited][Math.floor(Math.random() * unvisited.size)];

			visited.push(startIndex);
			unvisited.delete(startIndex);
		}

		while (unvisited.size > 0) {
			let fromNode = 0;
			const usePrims = Math.random() < branchingAmount;
			for (let nodes of [visited, avoiding, lastResortNodes]) {
				if (nodes.length === 0) {
					continue;
				}
				if (usePrims) {
					// go from a random element
					fromNode = getRandomElement(nodes);
				} else {
					// go from the last element
					fromNode = nodes[nodes.length - 1];
				}
				break;
			}
			if (fromNode === undefined) {
				throw 'Error in pregeneration: fromNode is undefined';
			}
			// tiers of possible moves
			const unvisitedNeighbours = []; // these are the best options
			const straightNeighbours = []; // this move results in a straight tile, might want to avoid
			const obviousNeighbours = []; // these should be avoided with avoidObvious setting
			const fullyConnectedNeighbours = []; // making a fully connected tile is a total last resort
			const connections = tiles[fromNode];
			for (let direction of grid.DIRECTIONS) {
				if ((direction & connections) > 0) {
					continue;
				}
				const { neighbour, empty } = grid.find_neighbour(fromNode, direction);
				if (empty || !unvisited.has(neighbour)) {
					continue;
				}
				// classify this neighbour by priority
				if (connections + direction === grid.fullyConnected(fromNode)) {
					fullyConnectedNeighbours.push({ neighbour, direction });
					continue;
				}
				if (borders.has(fromNode) && Math.random() < avoidObvious) {
					const walls = borders.get(fromNode) || 0;
					const nogo = forbidden.get(walls);
					if (nogo?.has(tiles[fromNode] + direction)) {
						obviousNeighbours.push({ neighbour, direction });
						continue;
					}
				}
				if (grid.tileTypes.get(connections + direction) === grid.T2I) {
					if (Math.random() < avoidStraights) {
						straightNeighbours.push({ neighbour, direction });
						continue;
					}
				}
				unvisitedNeighbours.push({ neighbour, direction });
			}
			let toVisit = null;
			let source = null;
			for (let options of [
				unvisitedNeighbours,
				straightNeighbours,
				obviousNeighbours,
				fullyConnectedNeighbours
			]) {
				if (options.length > 0) {
					source = options;
					toVisit = getRandomElement(options);
					break;
				}
			}

			if (toVisit === null) {
				// all neighbours are already visited
				const array = [visited, avoiding, lastResortNodes].find((x) => x.length > 0) || [];
				if (usePrims) {
					const index = array.indexOf(fromNode);
					array.splice(index, 1);
				} else {
					array.pop();
				}
				continue;
			}
			if (source === fullyConnectedNeighbours) {
				// wants to become fully connected, this is a last resort action
				if (visited.length > 0) {
					const index = visited.indexOf(fromNode);
					visited.splice(index, 1);
					lastResortNodes.push(fromNode);
					continue;
				}
			}
			if (source === obviousNeighbours) {
				// wants to become obvious, try to avoid using it
				if (visited.length > 0) {
					const index = visited.indexOf(fromNode);
					visited.splice(index, 1);
					avoiding.push(fromNode);
					continue;
				}
			}
			tiles[fromNode] += toVisit.direction;
			tiles[toVisit.neighbour] += grid.OPPOSITE.get(toVisit.direction) || 0;
			unvisited.delete(toVisit.neighbour);
			visited.push(toVisit.neighbour);
		}
		return tiles;
	};

	/**
	 * Generate a puzzle according to settings
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {Number} avoidStraights - value in range [0, 1], higher values lead to fewer straight tiles
	 * @param {SolutionsNumber} solutionsNumber - unique/multiple solutions or disable this check
	 * @returns {Number[]} - generated tiles
	 */
	self.generate = function (
		branchingAmount = 0.6,
		avoidObvious = 0.0,
		avoidStraights = 0.0,
		solutionsNumber = 'unique'
	) {
		if (solutionsNumber === 'unique') {
			let attempt = 0;
			// I don't expect many attempts to be needed, just 1 in .9999 cases
			while (attempt < 3) {
				attempt += 1;
				let tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious, avoidStraights);
				let uniqueIter = 0;
				while (uniqueIter < 10) {
					uniqueIter += 1;
					const solver = new Solver(tiles, self.grid);
					const { marked, unique } = solver.markAmbiguousTiles();
					if (unique) {
						return randomRotate(marked, self.grid);
					}
					tiles = self.pregenerate_growingtree(
						branchingAmount,
						avoidObvious,
						avoidStraights,
						marked
					);
				}
			}
			throw 'Could not generate a puzzle with a unique solution. Maybe try again.';
		} else if (solutionsNumber === 'whatever') {
			const tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious, avoidStraights);
			return randomRotate(tiles, self.grid);
		} else if (solutionsNumber === 'multiple') {
			let attempt = 0;
			while (attempt < 100) {
				attempt += 1;
				let tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious, avoidStraights);
				const solver = new Solver(tiles, self.grid);
				const { unique } = solver.markAmbiguousTiles();
				if (!unique) {
					return randomRotate(tiles, self.grid);
				}
			}
			throw 'Could not generate a puzzle with multiple solutions in 100 attempts. Maybe try again.';
		} else {
			throw 'Unknown setting for solutionsNumber';
		}
	};

	return this;
}
