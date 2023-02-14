import { Cell, Solver } from './solver';

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
 * @param {import('$lib/puzzle/hexagrid').HexaGrid} grid
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
 * @param {import('$lib/puzzle/hexagrid').HexaGrid} grid
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
	 * @returns {Number[]} - unrandomized tiles array
	 */
	this.pregenerate_growingtree = function (branchingAmount, avoidObvious = false) {
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
		/** @type {Number} */
		const startIndex = [...unvisited][Math.floor(Math.random() * unvisited.size)];

		/** @type {Map<Number, Number>} */
		const borders = new Map();
		/** @type {Map<Number, Set<Number>>} */
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
			const solver = new Solver(
				tiles.map((x) => x + 1),
				self.grid
			);
			for (let walls of new Set(borders.values())) {
				let cell = new Cell(self.grid, 0, -1);
				cell.addWall(walls);
				cell.applyConstraints();
				/** @type {Map<Number, Set<Number>>} */
				const tileTypes = new Map();
				for (let orientation of cell.possible) {
					const tileType = solver.tileTypes.get(orientation) || 0;
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

		const visited = [startIndex];
		unvisited.delete(startIndex);
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
					fromNode = getRandomElement(lastResortNodes);
				}
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
			let filteredNeighbours = unvisitedNeighbours;
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
					filteredNeighbours = unvisitedNeighbours;
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
	 * Generate a puzzle instance with a unique solution
	 * @returns {Number[]}
	 */
	self.generate = function (branchingAmount = 0.6, avoidObvious = false) {
		let attempt = 0;
		// I don't expect many attempts to be needed, just 1 in .9999 cases
		while (attempt < 3) {
			attempt += 1;
			let tiles = self.pregenerate_growingtree(branchingAmount, avoidObvious);
			let uniqueIter = 0;
			while (uniqueIter < 3) {
				uniqueIter += 1;
				const solver = new Solver(tiles, self.grid);
				const { marked, unique } = solver.markAmbiguousTiles();
				if (unique) {
					return randomRotate(marked, self.grid);
				}
				tiles = solver.fixAmbiguousTiles(marked);
			}
		}
		throw 'Could not generate a puzzle with a unique solution';
	};

	return this;
}
