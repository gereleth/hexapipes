import { Solver } from './solver';

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
	 * Fills a grid with tiles according to Prim's algorithm
	 * @returns {Number[]} - unrandomized tiles array
	 */
	this.pregenerate_prims = function () {
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
		const startIndex = [...unvisited][Math.floor(unvisited.size / 2)];

		const visited = [startIndex];
		unvisited.delete(startIndex);
		/** @type {Number[]} - visited tiles that will become fully connected if used again */
		const lastResortNodes = [];
		while (unvisited.size > 0) {
			let fromNode = getRandomElement(visited);
			if (fromNode === undefined) {
				fromNode = getRandomElement(lastResortNodes);
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
				const index = array.indexOf(fromNode);
				array.splice(index, 1);
				continue;
			}
			const toVisit = getRandomElement(unvisitedNeighbours);
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
	self.generate = function () {
		let attempt = 0;
		// I don't expect many attempts to be needed, just 1 in .9999 cases
		while (attempt < 3) {
			attempt += 1;
			let tiles = self.pregenerate_prims();
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
