import { Solver } from './solver';

/**
 * Returns a random element from an array
 * @param {Array} array
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
		/** @type {Number[]} A list of tile shapes */
		const tiles = [];
		for (let i = 0; i < total; i++) {
			tiles.push(0);
		}
		/** @type {Number} */
		const startIndex = Math.floor(total / 2);
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
				const { neighbour } = grid.find_neighbour(fromNode, direction);
				if (neighbour === -1) {
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
	 * Alter some tiles to make the solution unique
	 * @param {Number[]} tiles - tiles from initial generation
	 * @returns {Number[]} - unrandomized tiles array
	 */
	self.ensureUniqueSolution = function (tiles) {
		const solver = new Solver(tiles, self.grid);
		const marked = solver.markAmbiguousTiles();
		const fixed = solver.fixAmbiguousTiles(marked);
		return fixed;
	};

	self.generate = function () {
		let t0 = performance.now();
		let tiles = self.pregenerate_prims();
		let t1 = performance.now();
		tiles = self.ensureUniqueSolution(tiles);
		let t2 = performance.now();
		tiles = randomRotate(tiles, self.grid);
		console.log({
			initialGen: t1 - t0,
			ensureUnique: t2 - t1
		});
		return tiles;
	};

	return this;
}
