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
	return tiles.map((tile) => {
		return grid.rotate(tile, Math.floor(Math.random() * numDirections));
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
	 * @param {Number} branchingAmount - a number in range 0..1
	 * @param {boolean} avoidObvious - whether to try to avoid straight tiles along a border and the like
	 * @param {Number[]} startTiles - starting point tiles if we're fixing ambiguities
	 * @returns {Number[]} - unrandomized tiles array
	 */
	this.pregenerate_growingtree = function (branchingAmount, avoidObvious = false, startTiles = []) {
		const total = grid.width * grid.height;

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
				if (components[0].size > to_check.size) {
					break;
				}
			}
			// components[0] now has the largest region of non-ambiguous connected tiles
			for (let index of components[0]) {
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
		if (avoidObvious) {
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

		/** @type {Number[]} - visited tiles that will become fully connected if used again */
		const lastResortNodes = [];

		while (unvisited.size > 0) {
			let fromNode = 0;
			const usePrims = Math.random() < branchingAmount;
			if (usePrims) {
				// go from a random element
				fromNode = getRandomElement(visited);
				if (fromNode === undefined) {
					fromNode = getRandomElement(lastResortNodes);
				}
			} else {
				// go from the last element
				if (visited.length >= 1) {
					fromNode = visited[visited.length - 1];
				} else {
					fromNode = lastResortNodes[lastResortNodes.length - 1];
				}
			}
			if (fromNode === undefined) {
				throw 'Error in pregeneration: fromNode is undefined';
			}
			const unvisitedNeighbours = [];
			for (let direction of grid.DIRECTIONS) {
				const { neighbour, empty } = grid.find_neighbour(fromNode, direction);
				if (empty) {
					continue;
				}
				if (unvisited.has(neighbour)) {
					unvisitedNeighbours.push({ neighbour, direction });
				}
			}
			if (unvisitedNeighbours.length == 0) {
				const array = visited.length > 0 ? visited : lastResortNodes;
				if (usePrims) {
					const index = array.indexOf(fromNode);
					array.splice(index, 1);
				} else {
					array.pop();
				}
				continue;
			}
			let filteredNeighbours = [];
			if (avoidObvious) {
				filteredNeighbours = unvisitedNeighbours.filter((item) => {
					const { neighbour, direction } = item;
					if (borders.has(fromNode)) {
						const walls = borders.get(fromNode);
						const nogo = forbidden.get(walls);
						if (nogo?.has(tiles[fromNode] + direction)) {
							return false;
						}
					}
					if (borders.has(neighbour)) {
						const walls = borders.get(neighbour);
						const nogo = forbidden.get(walls);
						const dir = self.grid.OPPOSITE.get(direction) || 0;
						if (nogo?.has(tiles[neighbour] + dir)) {
							return false;
						}
					}
					return true;
				});
			} else {
				filteredNeighbours = [...unvisitedNeighbours];
			}
			if (filteredNeighbours.length === 0) {
				if (visited.length > 0) {
					// any moves from this tile will result in obvious tiles along border
					// try to avoid using it if possible
					const index = visited.indexOf(fromNode);
					visited.splice(index, 1);
					lastResortNodes.push(fromNode);
					continue;
				} else {
					// this is already a last resort node,
					// let it do whatever it needs to
					filteredNeighbours = [...unvisitedNeighbours];
				}
			}
			const toVisit = getRandomElement(filteredNeighbours);
			if (
				tiles[fromNode] + toVisit.direction == grid.fullyConnected(fromNode) &&
				visited.length > 1
			) {
				// this tile wants to become fully connected
				// try to avoid using it if possible
				const index = visited.indexOf(fromNode);
				visited.splice(index, 1);
				lastResortNodes.push(fromNode);
				continue;
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
	 * @param {Boolean} avoidObvious - try to avoid placing tiles if their orientation would be obvious from borders
	 * @param {SolutionsNumber} solutionsNumber - unique/multiple solutions or disable this check
	 * @returns {Number[]} - generated tiles
	 */
	self.generate = function (
		branchingAmount = 0.6,
		avoidObvious = false,
		solutionsNumber = 'unique'
	) {
		if (solutionsNumber === 'unique') {
			let attempt = 0;
			// I don't expect many attempts to be needed, just 1 in .9999 cases
			while (attempt < 3) {
				attempt += 1;
				let tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious);
				let uniqueIter = 0;
				while (uniqueIter < 10) {
					uniqueIter += 1;
					const solver = new Solver(tiles, self.grid);
					const { marked, unique } = solver.markAmbiguousTiles();
					if (unique) {
						return randomRotate(marked, self.grid);
					}
					tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious, marked);
				}
			}
			throw 'Could not generate a puzzle with a unique solution. Maybe try again.';
		} else if (solutionsNumber === 'whatever') {
			const tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious);
			return randomRotate(tiles, self.grid);
		} else if (solutionsNumber === 'multiple') {
			let attempt = 0;
			while (attempt < 100) {
				attempt += 1;
				let tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious);
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
		return [];
	};

	return this;
}
