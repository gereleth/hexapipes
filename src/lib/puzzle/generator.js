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

	this.generate = function () {
		const total = grid.width * grid.height;

		/** @type {Number[]} */
		const unvisited = [...Array(total).keys()];
		const tiles = unvisited.map((i) => 0);
		/** @type {Number[]} */
		/** @type {Number} */
		const startIndex = Math.floor(total / 2);
		const visited = [startIndex];
		unvisited.splice(startIndex, 1);
		while (unvisited.length > 0) {
			const fromNode = getRandomElement(visited);
			const unvisitedNeighbours = [];
			for (let direction of grid.DIRECTIONS) {
				const { neighbour } = grid.find_neighbour(fromNode, direction);
				if (neighbour === -1) {
					continue;
				}
				if (unvisited.some((x) => x === neighbour)) {
					unvisitedNeighbours.push({ neighbour, direction });
				}
			}
			if (unvisitedNeighbours.length == 0) {
				const index = visited.indexOf(fromNode);
				visited.splice(index, 1);
				continue;
			}
			const toVisit = getRandomElement(unvisitedNeighbours);
			tiles[fromNode] += toVisit.direction;
			tiles[toVisit.neighbour] += grid.OPPOSITE.get(toVisit.direction) || 0;
			const i = unvisited.indexOf(toVisit.neighbour);
			unvisited.splice(i, 1);
			visited.push(toVisit.neighbour);
		}
		return randomRotate(tiles, grid);
	};

	return this;
}
