import { Solver } from '#lib/puzzle/solver/solver.js';

/**
 * @typedef {'unique'|'multiple'|'whatever'} SolutionsNumber
 */

/**
 * @typedef {object} GeneratorProgress
 * @property {Number} attempt
 * @property {Number} iteration
 */

/**
 * @typedef {object} GeneratorOptions
 * @property {Number} branchingAmount
 * @property {Number} avoidObvious
 * @property {Number} avoidStraights
 * @property {SolutionsNumber} solutionsNumber
 */

/**
 * @typedef {(progress: GeneratorProgress) => void} GeneratorProgressCallback
 */

/**
 * @typedef {(progress: import('#lib/puzzle/solver/solver.js').SolverProgress) => void} SolverProgressCallback
 */

const emptyCallback = () => {};

/**
 * Returns a random element from an array
 * @param {Array<any>} array
 */
function getRandomElement(array) {
	const index = Math.floor(Math.random() * array.length);
	return array[index];
}

/**
 * Maps grid cells to "obvious" orientations - those that would be instantly
 * solved due to outer walls or empty neighbours. For example, a straight tile
 * along a square board's edge or a bend tile in a corner.
 * Only cells next to outer walls or empty neighbours get an entry.
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @param {Set<Number>} indexes - cells to consider, typically the unvisited set
 * @returns {Map<Number, Set<Number>>} cell index => forbidden orientations
 */
export function computeCellObviousTiles(grid, indexes) {
	/**
	 * @type {Map<import('#lib/puzzle/grids/polygonutils.js').RegularPolygonTile, Map<Number, Set<Number>>>}
	 * polygon => (cell walls => set of forbidden orientations) */
	const polygonForbidden = new Map();
	/** @type {Map<Number, Set<Number>>} cell index => forbidden orientations */
	const cellForbidden = new Map();
	for (let index of indexes) {
		const polygon = grid.polygonAt(index);
		let walls = 0;
		for (let direction of polygon.directions) {
			const { empty } = grid.findNeighbour(index, direction);
			if (empty) {
				walls += direction;
			}
		}
		if (walls === 0) {
			continue;
		}
		let forbidden = polygonForbidden.get(polygon);
		if (!forbidden) {
			forbidden = new Map();
			polygonForbidden.set(polygon, forbidden);
		}
		let wallForbidden = forbidden.get(walls);
		if (!wallForbidden) {
			wallForbidden = new Set();
			forbidden.set(walls, wallForbidden);
			/** @type {Map<String, Set<Number>>} shape class => surviving orientations */
			const survivors = new Map();
			for (let orientation of polygon.tileTypes.keys()) {
				if ((orientation & walls) !== 0) {
					continue;
				}
				const str = polygon.tileTypes.get(orientation)?.str || '';
				const group = survivors.get(str);
				if (group) {
					group.add(orientation);
				} else {
					survivors.set(str, new Set([orientation]));
				}
			}
			for (let group of survivors.values()) {
				if (group.size === 1) {
					for (let orientation of group) {
						wallForbidden.add(orientation);
					}
				}
			}
		}
		if (wallForbidden.size > 0) {
			cellForbidden.set(index, wallForbidden);
		}
	}
	return cellForbidden;
}

/**
 * Randomize tile rotations
 * @param {Number[]} tiles
 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
 * @returns {Number[]}
 */
function randomRotate(tiles, grid) {
	return tiles.map((tile, index) => {
		if (tile === 0) {
			return 0;
		}
		const polygon = grid.polygonAt(index);
		const numDirections = polygon.num_directions;
		let rotated = polygon.rotate(tile, Math.floor(Math.random() * numDirections));
		return rotated;
	});
}

export class Generator {
	/**
	 * @constructor
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number} [reuse_tiles_min_count = 3] minimum count of connected tiles to leave when erasing ambiguities.
	 * @param {Number} [uniqueness_patience = 5] abandon generation attempt if the count of ambiguous tiles did not decrease in this many iterations
	 * @param {SolverProgressCallback} [solver_progress_callback=emptyCallback]
	 * @param {GeneratorProgressCallback} [generator_progress_callback=emptyCallback]
	 */
	constructor(
		grid,
		reuse_tiles_min_count = 3,
		uniqueness_patience = 5,
		max_uniqueness_iterations = 100,
		max_attempts = 100,
		solver_progress_callback = emptyCallback,
		generator_progress_callback = emptyCallback
	) {
		this.grid = grid;
		this.reuse_tiles_min_count = reuse_tiles_min_count;
		this.uniqueness_patience = uniqueness_patience;
		this.max_attempts = max_attempts;
		this.max_uniqueness_iterations = max_uniqueness_iterations;
		this.solver_progress_callback = solver_progress_callback;
		this.generator_progress_callback = generator_progress_callback;
	}

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
	pregenerate_growingtree(branchingAmount, avoidObvious = 0, avoidStraights = 0, startTiles = []) {
		const total = this.grid.total;

		/** @type {Set<Number>} A set of unvisited nodes*/
		const unvisited = new Set([...Array(total).keys()]);
		for (let index of this.grid.emptyCells) {
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

		const non_triangular_grid = this.grid.KIND !== 'triangular';

		/** @type {Map<Number, Set<Number>>} */
		const startComponents = new Map();
		// reuse non-ambiguous portions of startTiles
		if (startTiles.length === total) {
			const to_check = new Set(unvisited);
			const components = [];
			while (to_check.size > 0) {
				const index = /** @type {Number} */ (to_check.values().next().value);
				to_check.delete(index);
				if (startTiles[index] < 0) {
					// ambiguous tile, ignore it
					continue;
				}
				const polygon = this.grid.polygonAt(index);
				if (non_triangular_grid && polygon.tileTypes.get(startTiles[index])?.isFullyConnected) {
					// fully connected tile, ignore it too
					continue;
				}
				const to_visit = new Set([index]);
				const component = new Set();
				while (to_visit.size > 0) {
					const i = /** @type {Number} */ (to_visit.values().next().value);
					to_visit.delete(i);
					to_check.delete(i);
					component.add(i);
					for (let direction of this.grid.getDirections(startTiles[i], 0, i)) {
						const { neighbour, empty } = this.grid.findNeighbour(i, direction);
						const npolygon = this.grid.polygonAt(neighbour);
						if (
							empty ||
							startTiles[neighbour] < 0 ||
							component.has(neighbour) ||
							(npolygon.num_directions > 3 &&
								npolygon.tileTypes.get(startTiles[neighbour])?.isFullyConnected)
						) {
							continue;
						}
						to_visit.add(neighbour);
					}
				}
				components.push(component);
			}
			components.sort((a, b) => -(a.size - b.size));
			// components[0] now has the largest region of non-ambiguous connected tiles
			for (let index of components[0] || []) {
				for (let direction of this.grid.getDirections(startTiles[index], 0, index)) {
					const { neighbour } = this.grid.findNeighbour(index, direction);
					if (components[0].has(neighbour)) {
						tiles[index] += direction;
					}
				}
				visited.push(index);
				unvisited.delete(index);
			}
			// reuse good smaller regions too
			for (let component of components.slice(1)) {
				if (component.size < this.reuse_tiles_min_count) {
					break;
				}
				for (let index of component) {
					startComponents.set(index, component);
					for (let direction of this.grid.getDirections(startTiles[index], 0, index)) {
						const { neighbour } = this.grid.findNeighbour(index, direction);
						if (component.has(neighbour)) {
							tiles[index] += direction;
						}
					}
				}
			}
		}

		/** @type {Map<Number, Set<Number>>} cell index => forbidden orientations */
		const cellObviousTiles =
			avoidObvious > 0 ? computeCellObviousTiles(this.grid, unvisited) : new Map();

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
			const polygon = this.grid.polygonAt(fromNode);
			for (let direction of polygon.directions) {
				if ((direction & connections) > 0) {
					continue;
				}
				const { neighbour, empty } = this.grid.findNeighbour(fromNode, direction);
				if (empty || !unvisited.has(neighbour)) {
					continue;
				}
				// classify this neighbour by priority
				if (
					non_triangular_grid &&
					(polygon.tileTypes.get(connections + direction)?.isFullyConnected ||
						(tiles[neighbour] > 0 &&
							this.grid
								.polygonAt(neighbour)
								.tileTypes.get(tiles[neighbour] + (this.grid.OPPOSITE.get(direction) || 0))
								?.isFullyConnected))
				) {
					fullyConnectedNeighbours.push({ neighbour, direction });
					continue;
				}
				if (cellObviousTiles.has(fromNode) && Math.random() < avoidObvious) {
					const nogo = cellObviousTiles.get(fromNode);
					if (nogo?.has(tiles[fromNode] + direction)) {
						obviousNeighbours.push({ neighbour, direction });
						continue;
					}
				}
				if (polygon.tileTypes.get(connections + direction)?.isStraight) {
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
			if (tiles[toVisit.neighbour] > 0) {
				// connected to a reused portion, visit it all
				const component = startComponents.get(toVisit.neighbour);
				component?.delete(toVisit.neighbour);
				for (let i of component || []) {
					unvisited.delete(i);
					visited.push(i);
				}
			}
			// console.log({ fromNode, neighbour: toVisit.neighbour, direction: toVisit.direction });
			tiles[toVisit.neighbour] += this.grid.OPPOSITE.get(toVisit.direction) || 0;
			unvisited.delete(toVisit.neighbour);
			visited.push(toVisit.neighbour);
			// console.log(tiles);
		}
		return tiles;
	}

	/**
	 * Generate a puzzle according to settings
	 * @param {Number} branchingAmount - value in range [0, 1]
	 * @param {Number} avoidObvious - value in range [0, 1], higher values lead to fewer obvious tiles along borders
	 * @param {Number} avoidStraights - value in range [0, 1], higher values lead to fewer straight tiles
	 * @param {SolutionsNumber} solutionsNumber - unique/multiple solutions or disable this check
	 * @returns {Number[]} - generated tiles
	 */
	generate(
		branchingAmount = 0.6,
		avoidObvious = 0.0,
		avoidStraights = 0.0,
		solutionsNumber = 'unique'
	) {
		if (solutionsNumber === 'unique') {
			/** @type {Number[]} */
			let startTiles = [];
			let attempt = 0;
			const ambiguousLimit = Math.max(100, 0.1 * this.grid.total); // don't look for more ambiguous tiles than this
			while (attempt < this.max_attempts) {
				attempt += 1;
				let tiles = this.pregenerate_growingtree(
					branchingAmount,
					avoidObvious,
					avoidStraights,
					startTiles
				);
				let iteration = 0;
				let patienceLeft = this.uniqueness_patience;
				let ambiguous = this.grid.total;
				while (iteration < this.max_uniqueness_iterations) {
					iteration += 1;
					this.generator_progress_callback({ attempt, iteration });
					const solver = new Solver(tiles, this.grid);
					solver.progress_callback = this.solver_progress_callback;
					const { solvable, marked, unique, numAmbiguous } = solver.markAmbiguousTiles(
						Math.min(ambiguous, ambiguousLimit)
					);
					if (!solvable) {
						console.log('unsolvable puzzle');
						console.log(tiles);
						throw 'Pregeneration returned an unsolvable puzzle';
					}
					if (unique) {
						return randomRotate(tiles, this.grid);
					}
					// marked holds rotations with negative sentinels for
					// ambiguous tiles - convert back to tiles for reuse
					const toStartTiles = (/** @type {Number} */ m, /** @type {Number} */ index) =>
						m >= 0 ? this.grid.rotate(tiles[index], m, index) : m;
					if (ambiguous > ambiguousLimit && numAmbiguous >= ambiguousLimit) {
						startTiles = marked.map(toStartTiles);
					} else if (numAmbiguous >= ambiguous) {
						patienceLeft -= 1;
					} else {
						ambiguous = numAmbiguous;
						patienceLeft = this.uniqueness_patience;
						startTiles = marked.map(toStartTiles);
					}
					if (patienceLeft === 0) {
						break;
					}
					tiles = this.pregenerate_growingtree(
						branchingAmount,
						avoidObvious,
						avoidStraights,
						startTiles
					);
				}
			}
			throw 'Could not generate a puzzle with a unique solution. Maybe try again.';
		} else if (solutionsNumber === 'whatever') {
			const tiles = this.pregenerate_growingtree(branchingAmount, avoidObvious, avoidStraights);
			return randomRotate(tiles, this.grid);
		} else if (solutionsNumber === 'multiple') {
			let attempt = 0;
			while (attempt < this.max_attempts) {
				attempt += 1;
				this.generator_progress_callback({ attempt, iteration: 1 });
				let tiles = this.pregenerate_growingtree(branchingAmount, avoidObvious, avoidStraights);
				const solver = new Solver(tiles, this.grid);
				solver.progress_callback = this.solver_progress_callback;
				const { unique } = solver.markAmbiguousTiles(1);
				if (!unique) {
					return randomRotate(tiles, this.grid);
				}
			}
			throw `Could not generate a puzzle with multiple solutions in ${this.max_attempts} attempts. Maybe try again.`;
		} else {
			throw 'Unknown setting for solutionsNumber';
		}
	}
}
