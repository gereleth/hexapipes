import { ComponentsRegistry } from '#lib/puzzle/solver/components-registry.js';
import { popcount, iterate_directions } from '#lib/puzzle/grids/bitmasks.js';
import { HexaGrid } from '#lib/puzzle/grids/hexagrid.js';
import { OctaGrid } from '#lib/puzzle/grids/octagrid.js';
import { SolverTile, NoOrientationsPossibleException } from '#lib/puzzle/solver/solver-tile.js';

/**
 * Solving stage
 * initial: deductions made about the original puzzle
 * guess: deductions made after a guess
 * aftercheck: steps made after a solution has been found
 * @typedef {'initial'|'guess'|'aftercheck'} SolvingStage
 */

/**
 * Solve step represents processing new info on a single tile
 * @typedef {Object} SolverStep
 * @property {Number} index
 * @property {Number} rotation - representative rotation that fits currently known facts
 * @property {Boolean} final - true if this state is the only one left
 */

/**
 * Solver progress tracks current counts of solved/guessed/ambiguous tiles
 * @typedef {Object} SolverProgress
 * @property {Number} total
 * @property {Number} solved
 * @property {Number} guessed
 * @property {Number} ambiguous
 */

/* Constraint Violation Exceptions */

function LoopDetectedException() {
	this.name = 'LoopDetected';
	this.message = 'Loop detected';
}

function IslandDetectedException() {
	this.name = 'IslandDetected';
	this.message = 'Island detected';
}

// Shared sentinels: thrown by reference so a throw allocates nothing (and
// captures no stack). Catch sites backtrack on any of these without
// inspecting them.
const LOOP_DETECTED = new LoopDetectedException();
const ISLAND_DETECTED = new IslandDetectedException();

const emptyCallback = (/**@type {SolverProgress} */ progress) => {};

export class Solver {
	UNSOLVED = -1;
	AMBIGUOUS = -2;

	/** @type {ComponentsRegistry} - owns all component/slot/pipe node data */
	components;
	/**
	 * @type {Boolean} - true when any tile holds more than one pipe. */
	isMulti;
	/**
	 * @type {Boolean} - hexa/octa boards run the classic PipeShape deductions at init */
	hasPipeShapeTricks;
	/**
	 *
	 * @param {Number[]|Number[][]} tiles - classic/multi
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Solver|null} [parent = null]
	 */
	constructor(tiles, grid, parent = null) {
		/** @type {Number[][]} - classic tiles normalized to [pipe] per cell */
		const normalized = Number.isInteger(tiles[0])
			? /** @type {Number[]} */ (tiles).map((pipe) => (pipe === 0 ? [] : [pipe]))
			: /** @type {Number[][]} */ (tiles);
		this.initial = normalized;
		this.grid = grid;
		this.parent = parent;
		this.isMulti = normalized.some((pipes) => pipes.length > 1);
		this.hasPipeShapeTricks = grid instanceof HexaGrid || grid instanceof OctaGrid;
		this.progressCallback = emptyCallback;
		/** @type {Number} */
		this.totalNodes = parent ? parent.totalNodes : 0;
		/** @type {Number} */
		this.totalUnsolved = parent ? parent.totalUnsolved : grid.total;

		/** @type {Map<Number, SolverTile>} */
		this.unsolved = new Map();

		/** @type {Number[]} - rotation per tile, or UNSOLVED */
		this.solution = parent ? [...parent.solution] : normalized.map(() => this.UNSOLVED);

		/** @type {Number[][]} - array of found solutions */
		this.solutions = [];

		/** @type {Set<Number>} - indices of tiles with new info to process */
		this.dirty = new Set();

		// components whose open ends changed and are due an island check.
		// Starts empty in every solver
		/** @type {Set<Number>} */
		this.islandChecks = new Set();

		// Components registry tracks connected subtrees
		if (parent) {
			this.components = parent.components.clone();
		} else {
			let maxPipes = 0;
			for (let i = 0; i < normalized.length; i++) {
				if (normalized[i].length > maxPipes) maxPipes = normalized[i].length;
			}
			this.components = new ComponentsRegistry(grid, maxPipes);
		}

		/**
		 * Counters of search work, shared with all clones so that
		 * totals accumulate across the whole trial tree of one solve run
		 * @type {{iterations: Number, trialClones: Number, shortTrials: Number, dirtyProcessings: Number}}
		 */
		this.stats = parent
			? parent.stats
			: { iterations: 0, trialClones: 0, shortTrials: 0, dirtyProcessings: 0 };

		this.shortTrialsIndex = 0;

		/** @type {any[][]} */
		this.avoidLoopQueue = [];

		// merge hooks: the registry moves absorbed members and hands each one
		// back so the solver can run its loop-avoidance logic over it.
		// Created once per solver instance instead of per merge - merges are hot
		/** @type {(cellIndex: Number, component: Number) => void} */
		this.mergedSlotHook = (cellIndex, component) => {
			this.avoidSlotLoops(cellIndex, component);
		};
		/** @type {(pipeNodeId: Number, component: Number) => void} */
		this.mergedNodeHook = (pipeNodeId, component) => {
			const [index, pipeIndex] = this.grid.cellIndexPipeIndexOf(pipeNodeId);
			this.avoidNodeLoops(index, pipeIndex, this.getTile(index), component);
		};
	}

	/**
	 * Returns the tile at index. Initializes the tile if necessary.
	 * Throws should never happen when the solver is working correctly
	 * @param {Number} index
	 * @returns {SolverTile}
	 */
	getTile(index) {
		let tile = this.unsolved.get(index);
		if (tile !== undefined) {
			return tile;
		}
		if (this.solution[index] !== this.UNSOLVED) {
			throw `Attempted resurrection of tile ${index}`;
		}
		if (this.parent) {
			tile = this.parent.getTile(index);
			const clone = tile.clone(new Map(tile.possible));
			this.unsolved.set(index, clone);
			return clone;
		}
		tile = new SolverTile(this.initial[index], this.grid.polygonAt(index), index);
		this.unsolved.set(index, tile);
		this.doLocalDeductions(index, tile);
		// a fresh born tile must be dirty-processed even when doLocalDeductions
		// found nothing so that its deadend facts reach neighbours
		this.dirty.add(index);
		return tile;
	}

	/**
	 * Return the pipe shape of the tile's pipes union
	 * @param {Number} index
	 * @returns {import('#lib/puzzle/grids/polygonutils.js').PipeShape|null}
	 */
	getPipeShape(index) {
		let union = 0;
		for (let pipe of this.initial[index]) {
			union |= pipe;
		}
		return this.grid.polygonAt(index).pipeShapes.get(union) || null;
	}

	/**
	 * Checks if any rotations can be ruled out based on
	 * walls or empty tiles nearby, plus PipeShape deductions
	 * on hexa/octa boards
	 * @param {Number} index
	 * @param {SolverTile} tile
	 */
	doLocalDeductions(index, tile) {
		if (tile.possible.size === 1) {
			// either empty or fully connected, is solved right away
			return;
		}
		/** @type {(import('#lib/puzzle/grids/polygonutils.js').PipeShape|null)[]|null} */
		let neighbours = null;
		if (this.hasPipeShapeTricks) {
			neighbours = [];
		}
		let walls = 0;
		for (let direction of tile.polygon.directions) {
			const { neighbour, empty } = this.grid.findNeighbour(index, direction);
			if (empty) {
				walls += direction;
				if (neighbours !== null) {
					neighbours.push(null);
				}
			} else if (neighbours !== null) {
				neighbours.push(this.getPipeShape(neighbour));
			}
		}
		if (walls > 0) {
			tile.addWall(walls);
		}
		if (neighbours !== null) {
			this.doPipeShapeDeductions(index, tile, neighbours);
		}
	}

	/**
	 * Hexa/octa PipeShape deductions
	 * @param {Number} index
	 * @param {SolverTile} tile
	 * @param {(import('#lib/puzzle/grids/polygonutils.js').PipeShape|null)[]} neighbourShapes -
	 * neighbour tile union types aligned with tile.polygon.directions, null for
	 * empty neighbours
	 */
	doPipeShapeDeductions(index, tile, neighbourShapes) {
		const pipeShape = this.getPipeShape(index);
		if (pipeShape === null) return;
		const polygon = tile.polygon;

		// classic only: can't connect middle prongs to a sharp turns tile
		if (!this.isMulti && pipeShape.hasThreeOrMoreAdjacentConnections) {
			for (let [i, neighbourShape] of neighbourShapes.entries()) {
				if (neighbourShape?.hasOnlyAdjacentConnections) {
					const direction = polygon.directions[i];
					const forbidden =
						direction + polygon.rotate(direction, 1) + polygon.rotate(direction, -1);
					// no surviving orientation may connect the whole trio around
					// the sharp-turn neighbour
					tile.mustHaveSomeWalls(forbidden);
				}
			}
		}

		// classic only: must connect psi-likes when they are adjacent
		if (!this.isMulti && pipeShape.hasNoAdjacentWalls) {
			for (let [i, neighbourShape] of neighbourShapes.entries()) {
				if (neighbourShape?.hasNoAdjacentWalls) {
					tile.mustHaveAllConnections(polygon.directions[i]);
				}
			}
		}

		// never make two adjacent walls next to a psi & co
		if (!pipeShape.hasNoAdjacentWalls) {
			const numDirections = polygon.directions.length;
			for (let [i, neighbourShape] of neighbourShapes.entries()) {
				if (neighbourShape?.hasNoAdjacentWalls) {
					const direction = polygon.directions[i];
					let forbidden = 0;
					const i1 = (i + 1) % numDirections;
					if (neighbourShapes[i1]?.hasNoAdjacentConnections) {
						forbidden += polygon.directions[i1];
					}
					const i2 = (i + numDirections - 1) % numDirections;
					if (neighbourShapes[i2]?.hasNoAdjacentConnections) {
						forbidden += polygon.directions[i2];
					}
					if (forbidden === 0) {
						continue;
					}
					for (let rotation of tile.possible.keys()) {
						const union = tile.unionAt(rotation);
						if ((union & forbidden) > 0 && (union & direction) === 0) {
							tile.possible.delete(rotation);
						}
					}
				}
			}
		}
	}

	/**
	 * Register a connection from tile at index in direction
	 * Creates a new component with two slots at this edge
	 * @param {Number} index
	 * @param {Number} direction
	 */
	addConnection(index, direction) {
		const { neighbour } = this.grid.findNeighbour(index, direction);
		const opposite = this.grid.OPPOSITE.get(direction) || 0;
		const neighbourTile = this.getTile(neighbour);
		neighbourTile.addConnection(opposite);
		this.dirty.add(neighbour);
		// add connection can only be called once per edge between two tiles

		// Add a component between them, with two open slots
		// Should we try and skip slot stage if a tile only has a single pipe?
		const component = this.components.create();
		this.components.addSlot(component, index, direction);
		this.components.addSlot(component, neighbour, opposite);
	}

	/**
	 * Return the component that a pipe in the tile at index would join if it connects
	 * in direction (0 = none)
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {Number}
	 */
	getAnsweringComponent(index, direction) {
		// see if we have a slot in this direction
		const slotComp = this.components.getSlotComponent(index, direction);
		if (slotComp !== 0) return slotComp;
		// ask the neighbour
		const { neighbour } = this.grid.findNeighbour(index, direction);
		const opposite = this.grid.OPPOSITE.get(direction) || 0;
		const neighbourTile = this.getTile(neighbour);
		const pipeIndex = neighbourTile.getAnsweringPipe(opposite);
		if (pipeIndex !== undefined) {
			const pipeNodeId = this.grid.pipeNodeId(neighbour, pipeIndex);
			return this.components.getNodeComponent(pipeNodeId);
		}
		return 0;
	}
	/**
	 * See if we can deduce any walls when a pipe node joins a component
	 * @param {Number} index
	 * @param {Number} pipeIndex
	 * @param {SolverTile} tile
	 * @param {Number} component - component id
	 */
	avoidNodeLoops(index, pipeIndex, tile, component) {
		const pipeNodeId = this.grid.pipeNodeId(index, pipeIndex);
		const potential = tile.getPipePotentialConnections(pipeIndex);
		const known = this.components.getNodeDirections(pipeNodeId, component);
		for (let direction of iterate_directions(potential & ~known)) {
			const answering = this.getAnsweringComponent(index, direction);
			if (answering === component) {
				this.avoidLoopQueue.push([tile, pipeIndex, direction]);
			}
		}
	}

	/**
	 * See if we can find cases where a pipe could link a component to itself
	 * @param {Number} index
	 * @param {Number} component - component id
	 */
	avoidSlotLoops(index, component) {
		const tile = this.getTile(index);
		if (tile.possible.size === 1) {
			return;
		}
		let directions = tile.polygon.fullyConnected & ~tile.walls;
		for (let pipeIndex of tile.pipes.keys()) {
			const pipeNodeId = this.grid.pipeNodeId(index, pipeIndex);
			// subtract what this tile's nodes already contribute;
			// an unowned node contributes nothing
			directions &= ~this.components.getNodeDirections(pipeNodeId);
			// detect solved pipes to avoid resurrecting neighbours
			// skip the check if the pipe doesn't have repeating orientations
			if (((tile.repeatPipesMask >> pipeIndex) & 1) === 0) continue;
			let uniqueMask;
			let isUnique = true;
			for (let pipes of tile.possible.values()) {
				const mask = pipes[pipeIndex];
				if (uniqueMask === undefined) {
					uniqueMask = mask;
				} else if (mask !== uniqueMask) {
					isUnique = false;
					break;
				}
			}
			if (isUnique && uniqueMask !== undefined) {
				directions &= ~uniqueMask;
			}
		}
		let forbidden = 0;
		for (let direction of iterate_directions(directions)) {
			const answering = this.getAnsweringComponent(index, direction);
			if (answering === component) {
				forbidden |= direction;
			}
		}
		if (popcount(forbidden) <= 1) return;
		this.avoidLoopQueue.push([tile, null, forbidden]);
	}

	/**
	 *
	 * @param {Number} index
	 * @param {SolverTile} tile
	 */
	pruneLoop(index, tile) {
		if (tile.possible.size === 1) return;
		this.components.forEachSlot(index, (direction, component) =>
			this.avoidSlotLoops(index, component)
		);
		for (let pipeIndex of tile.pipes.keys()) {
			const pipeNodeId = this.grid.pipeNodeId(index, pipeIndex);
			const component = this.components.getNodeComponent(pipeNodeId);
			if (component === 0) continue;
			this.avoidNodeLoops(index, pipeIndex, tile, component);
		}
	}

	/**
	 * Check if we can propagate components data through this tile
	 * @param {Number} index
	 * @param {SolverTile} tile
	 */
	resolveComponents(index, tile) {
		// see if our slots resolved to some pipe
		if (this.components.hasOpenSlots(index)) {
			this.components.forEachSlot(index, (direction, component) => {
				const pipeIndex = tile.getAnsweringPipe(direction);
				if (pipeIndex === undefined) return;
				const pipeNodeId = this.grid.pipeNodeId(index, pipeIndex);
				const otherComponent = this.components.getNodeComponent(pipeNodeId);
				if (otherComponent === 0) {
					this.components.attachNode(component, pipeNodeId, direction);
					// pipe node joined a component - check if it has
					// any neighbours already in component
					this.avoidNodeLoops(index, pipeIndex, tile, component);
					this.islandChecks.add(component);
				} else if (otherComponent === component) {
					throw LOOP_DETECTED;
				} else {
					this.components.merge(
						otherComponent,
						component,
						pipeNodeId,
						direction,
						this.mergedSlotHook,
						this.mergedNodeHook
					);
					this.islandChecks.add(otherComponent);
					this.islandChecks.delete(component); // so we don't process stale components later
				}
			});
		}
		// for our nodes in components see if there are new definite connections to neighbours
		// and create new slots
		for (let pipeIndex of tile.pipes.keys()) {
			const pipeNodeId = this.grid.pipeNodeId(index, pipeIndex);
			const component = this.components.getNodeComponent(pipeNodeId);
			if (component === 0) continue;
			const connections = tile.getPipeDefiniteConnections(pipeIndex);
			const known = this.components.getNodeDirections(pipeNodeId, component);
			const newDirections = connections & ~known;
			if (newDirections > 0) {
				this.components.setNodeDirections(pipeNodeId, connections);
				for (let direction of iterate_directions(newDirections)) {
					const { neighbour } = this.grid.findNeighbour(index, direction);
					const opposite = this.grid.OPPOSITE.get(direction) || 0;
					const otherComponent = this.components.getSlotComponent(neighbour, opposite);
					if (otherComponent === 0) {
						this.components.addSlot(component, neighbour, opposite);
						this.islandChecks.add(component);
						this.avoidSlotLoops(index, component);
					} else if (otherComponent === component) {
						throw LOOP_DETECTED;
					} else {
						this.components.merge(
							component,
							otherComponent,
							pipeNodeId,
							direction,
							this.mergedSlotHook,
							this.mergedNodeHook
						);
						this.islandChecks.add(component);
						this.islandChecks.delete(otherComponent); // so we don't process stale entries later
					}
				}
			}
			if (popcount(connections) === tile.pipePopcounts[pipeIndex]) {
				this.components.removeNode(component, pipeNodeId);
			}
		}
		this.pruneLoop(index, tile);
	}

	/**
	 * Process new info on a single tile and propagate constraints
	 * @param {Number} index
	 * @returns {SolverStep}
	 * @throws {NoOrientationsPossibleException|IslandDetectedException|LoopDetectedException}
	 */
	processDirtyTile(index) {
		this.stats.dirtyProcessings += 1;
		const tile = this.getTile(index);
		while (this.dirty.has(index)) {
			// console.log('process dirty tile', index);
			const possibleBefore = tile.possible.size;
			const grid = this.grid;
			// console.log({ index: tile.index, walls: tile.walls, connections: tile.connections });
			let { addedWalls, addedConnections, addedDeadends } = tile.applyConstraints(this.totalNodes);
			// console.log({ addedWalls, addedConnections, addedDeadends });
			if (addedWalls > 0) {
				for (let direction of iterate_directions(addedWalls)) {
					const { neighbour, empty } = grid.findNeighbour(index, direction);
					if (empty) continue;
					const opposite = grid.OPPOSITE.get(direction) || 0;
					const neighbourTile = this.getTile(neighbour);
					neighbourTile.addWall(opposite);
					this.dirty.add(neighbour);
				}
			}
			if (addedConnections > 0) {
				for (let direction of iterate_directions(addedConnections)) {
					this.addConnection(index, direction);
				}
			}
			if (addedDeadends > 0) {
				for (let direction of iterate_directions(addedDeadends)) {
					const { neighbour, empty } = grid.findNeighbour(index, direction);
					// avoid telling our deadend facts to solved neighbours
					// possibly needs to be handled in components logic?..
					if (empty || this.solution[neighbour] !== this.UNSOLVED) continue;
					const opposite = grid.OPPOSITE.get(direction) || 0;
					const neighbourTile = this.getTile(neighbour);
					neighbourTile.addNeighbourDeadend(opposite, tile.ownDeadendWeights.get(direction) || 0);
					this.dirty.add(neighbour);
				}
			}
			this.dirty.delete(index);
			// resolving components might cause some merges and trigger loop avoidance logic
			// relevant prunings of possible states should happen after the resolve step completes
			// so the prunings are added to a queue and carried out later
			// re-dirty affected tiles if removed any orientations
			this.resolveComponents(index, tile);
			for (let [ti, pi, di] of this.avoidLoopQueue) {
				if (pi === null) {
					// came from slot logic, forbid orientation if any pipe bridges any two directions
					const removed = ti.forbidBridge(di);
					if (removed > 0) {
						this.dirty.add(ti.index);
					}
				} else {
					// came from node logic, forbid direction in a specific pipe node
					const removed = ti.forbidPipeDirection(pi, di);
					if (removed > 0) {
						this.dirty.add(ti.index);
					}
				}
			}
			this.avoidLoopQueue.length = 0;

			for (const component of this.islandChecks) {
				const slots = this.components.slotCount(component);
				const nodes = this.components.nodeCount(component);
				if (slots === 0 && nodes === 0) {
					// a sealed component holding every node is just the finished puzzle
					if (this.components.totalNodeCount(component) < this.totalNodes) {
						throw ISLAND_DETECTED;
					}
				} else if (slots === 1 && nodes === 0) {
					// exactly one opening left
					this.components.forEachComponentSlot(component, (cellIndex, directions) => {
						const t = this.getTile(cellIndex);
						const deadendsBefore = t.neighbourDeadends;
						// override weight because component size is exact at this point
						t.addNeighbourDeadend(directions, 0);
						t.neighbourDeadendWeights.set(directions, this.components.totalNodeCount(component));
						if (t.neighbourDeadends !== deadendsBefore) {
							this.dirty.add(cellIndex);
						}
					});
					// 2+ island connections into the same tile should be handled differently.
					// It's enough for one strand to escape, so sealing one connection and
					// continuing another one should be valid.
					// Deadend machinery treats all deadends as independent => doesn't work for this case
					// Valid handling is not implemented yet
				} else if (slots === 0 && nodes === 1) {
					this.components.forEachComponentNode(component, (pipeNodeId, directions) => {
						const [islandIndex] = this.grid.cellIndexPipeIndexOf(pipeNodeId);
						const t = this.getTile(islandIndex);
						const deadendsBefore = t.neighbourDeadends;
						let weight = this.components.totalNodeCount(component) - 1; // don't count this node itself
						for (let direction of iterate_directions(directions)) {
							t.addNeighbourDeadend(direction, weight);
							t.neighbourDeadendWeights.set(direction, weight);
							weight = 0; // prevent double-counting of island
							// it doesn't matter which direction carries the weight
						}
						if (t.neighbourDeadends !== deadendsBefore) {
							this.dirty.add(islandIndex);
						}
					});
				}
			}
			this.islandChecks.clear();
		}
		const final = tile.possible.size === 1;
		const [rotation] = tile.possible.keys();
		if (final) {
			this.solution[index] = rotation;
			this.unsolved.delete(index);
			this.totalUnsolved -= 1;
		}
		return { index, rotation, final };
	}

	/**
	 * Process new info on tiles and propagate constraints
	 * @yields {SolverStep} - info about the processed tile
	 * @throws {NoOrientationsPossibleException}
	 */
	*processDirtyTiles() {
		while (this.dirty.size > 0) {
			// console.log('begin dirty step', [...this.dirty]);
			const [index] = this.dirty;
			yield this.processDirtyTile(index);
		}
	}

	/**
	 * Initialize all tiles and process any constraints found
	 * @yields {SolverStep} - info about the processed tile
	 * @throws {NoOrientationsPossibleException}
	 */
	*processInitialDeductions() {
		if (this.dirty.size > 0) return;
		this.totalNodes = 0;
		const toInit = new Set();
		// process empty tiles first, then the rest
		for (let index = 0; index < this.grid.total; index++) {
			if (this.grid.emptyCells.has(index)) {
				this.dirty.add(index);
			} else {
				toInit.add(index);
				this.totalNodes += this.initial[index].length;
			}
		}
		while (toInit.size > 0) {
			const [index] = toInit;
			toInit.delete(index);
			// console.log({ toInit, index });
			if (this.unsolved.has(index)) {
				continue;
			}
			this.dirty.add(index);
			for (let step of this.processDirtyTiles()) {
				toInit.delete(step.index);
				if (this.initial[step.index].length === 0) {
					// don't report processing empty tile as a step
					continue;
				}
				yield step;
			}
		}
	}

	/**
	 * Chooses a tile/rotation to try out.
	 * Selects a rotation from a tile with the least number of options
	 * Sets a single rotation as possible and dirties the tile
	 * @param {Number[]} [marked=[]] - optional marked array to skip ambiguous tiles
	 * @returns {Number[]} - [index, rotation]
	 */
	makeAGuess(marked = []) {
		let minPossibleSize = Number.POSITIVE_INFINITY;
		let guessIndex = -1;
		// with lazy cloning this.unsolved might not have entries for
		// tiles we haven't touched yet
		// so check for unsolved entries using marked or this.solution
		for (let [index, value] of this.solution.entries()) {
			// skip both ambiguous and solved tiles
			if (value !== this.UNSOLVED || marked[index] === this.AMBIGUOUS) continue;
			const tile = this.getTile(index);
			if (tile.possible.size < minPossibleSize) {
				guessIndex = index;
				minPossibleSize = tile.possible.size;
				if (minPossibleSize === 2) {
					break;
				}
			}
		}
		if (guessIndex === -1) {
			// can't guess because only amb tiles are left
			return [-1, 0];
		}
		const tile = this.getTile(guessIndex);
		if (tile === undefined) {
			throw 'Tile selected for guessing is undefined!';
		}
		const [[rotation, pipes]] = tile.possible.entries();
		tile.possible = new Map([[rotation, pipes]]);
		this.dirty.add(guessIndex);
		return [guessIndex, rotation];
	}

	/**
	 * Creates a copy of the solver.
	 * Copies components data and solution eagerly,
	 * getTile puts things in unsolved lazily
	 * @returns {Solver}
	 */
	clone() {
		const clone = new Solver(this.initial, this.grid, this);
		return clone;
	}

	/**
	 * Check orientations of unsolved tiles to see if they produce contradictions quickly
	 * Returns true if solver manages to exclude some orientation, false otherwise
	 * @param {Number[]} marked
	 * @returns {boolean}
	 */
	doShortTrials(marked = []) {
		const tested = new Set();
		for (let i = this.shortTrialsIndex; i < this.shortTrialsIndex + this.grid.total; i++) {
			const index = i % this.grid.total;
			if (this.solution[index] !== this.UNSOLVED) continue;
			if (marked[index] === this.AMBIGUOUS) continue;
			const tile = this.getTile(index);
			for (let [rotation, pipes] of tile.possible) {
				const key = `${index}_${rotation}`;
				if (tested.has(key)) {
					continue;
				}
				const clone = this.clone();
				this.stats.shortTrials += 1;
				const cloneTile = clone.getTile(index);
				cloneTile.possible = new Map([[rotation, pipes]]);
				clone.dirty.add(index);
				try {
					for (let step of clone.processDirtyTiles()) {
						if (step.final) {
							const key = `${step.index}_${step.rotation}`;
							tested.add(key);
						}
					}
				} catch (e) {
					tile.possible.delete(rotation);
					this.dirty.add(index);
					this.shortTrialsIndex = index;
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Solve the puzzle
	 * @param {boolean} [allSolutions = false] - whether to find all solutions.
	 * If false then stops as soon as the first one is found
	 * @yields {{stage:{SolvingStage}, step:{SolverStep}}}
	 */
	*solve(allSolutions = false) {
		// Initial processing, touches every tile
		for (let step of this.processInitialDeductions()) {
			yield { stage: /** @type {SolvingStage} */ ('initial'), step };
		}
		// time to guess and check
		let iter = 0;
		/** @type {{index: Number, guess: Number, solver: Solver}[]} */
		const trials = [{ index: -1, guess: -1, solver: this }];
		while (trials.length > 0) {
			iter += 1;
			this.stats.iterations += 1;
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) break;
			const { index, guess, solver } = lastTrial;
			try {
				let stage = trials.length === 1 ? 'initial' : 'guess';
				stage = this.solutions.length === 0 ? stage : 'aftercheck';
				for (let step of solver.processDirtyTiles()) {
					yield { stage, step };
				}
			} catch (error) {
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const tile = parent.unsolved.get(index);
					tile?.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			}
			if (solver.totalUnsolved === 0) {
				// got a solution
				this.solutions.push([...solver.solution]);
				if (!allSolutions) {
					break;
				}
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const tile = parent.getTile(index);
					tile.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			} else {
				// guess again
				const clone = solver.clone();
				this.stats.trialClones += 1;
				const [index, rotation] = clone.makeAGuess();
				trials.push({
					index,
					guess: rotation,
					solver: clone
				});
			}
		}
		// we rely on `this.solution` to check for solved tiles,
		// so assign this only at the end
		if (this.solutions.length > 0) {
			this.solution = this.solutions[0];
		}
	}

	/**
	 * Solve the puzzle but mark ambiguous tiles with a special value
	 * Does not yield steps
	 * If the solution is unique then marked == solution
	 * @param {Number} [ambiguousTilesLimit = 0] - return if we find at least
	 * this many ambiguous tiles. Not all ambiguous tiles may be marked in this case.
	 * Default 0 means no limit, find all ambiguities.
	 * @returns {{
	 * 	marked: Number[],
	 *  solvable: boolean,
	 * 	unique: boolean,
	 *  numAmbiguous: Number
	 * }} - marked tiles, whether a puzzle is solvable, whether the solution is unique,
	 * number of ambiguous tiles
	 */
	markAmbiguousTiles(ambiguousTilesLimit = 0) {
		let marked = [...this.solution];
		let unique = true;
		let numAmbiguous = 0;
		const total = this.grid.total - this.grid.emptyCells.size;
		// process what we can for a start
		try {
			// Initial processing, touches every tile
			for (let step of this.processInitialDeductions()) {
				if (step.final) {
					marked[step.index] = step.rotation;
				}
			}
		} catch (error) {
			return { marked, solvable: false, unique: false, numAmbiguous };
		}

		/** @type {{index: Number, guess: Number, solver:Solver}[]} */
		const trials = [{ index: -1, guess: -1, solver: this }];
		let iter = 0;
		while (trials.length > 0) {
			iter += 1;
			this.stats.iterations += 1;
			const lastTrial = trials[trials.length - 1];
			if (lastTrial === undefined) break;
			const { index, guess, solver } = lastTrial;
			this.progressCallback({
				total,
				ambiguous: numAmbiguous,
				guessed: trials.length - 1,
				solved: total - this.totalUnsolved
			});
			try {
				for (let _ of solver.processDirtyTiles()) {
				}
				if (trials.length === 1 && solver.doShortTrials()) {
					continue;
				}
			} catch (error) {
				// something went wrong, no solution here
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const tile = parent.getTile(index);
					tile?.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			}
			if (solver.totalUnsolved === 0) {
				// got a solution
				numAmbiguous = 0;
				for (let i = 0; i < marked.length; i++) {
					if (marked[i] === this.AMBIGUOUS) {
						numAmbiguous += 1;
					} else if (marked[i] === this.UNSOLVED) {
						marked[i] = solver.solution[i];
					} else if (marked[i] !== solver.solution[i]) {
						marked[i] = this.AMBIGUOUS;
						unique = false;
						numAmbiguous += 1;
					}
				}
				if (ambiguousTilesLimit > 0 && numAmbiguous >= ambiguousTilesLimit) {
					this.progressCallback({
						total,
						ambiguous: numAmbiguous,
						guessed: trials.length - 1,
						solved:
							trials.length === 1 ? total - numAmbiguous : total - trials[0].solver.totalUnsolved
					});
					return { marked, solvable: true, unique, numAmbiguous };
				}
				if (trials.length > 1) {
					trials.pop();
					const parent = trials[trials.length - 1].solver;
					const tile = parent.getTile(index);
					tile.possible.delete(guess);
					parent.dirty.add(index);
					continue;
				} else break;
			} else {
				// guess again
				const clone = solver.clone();
				this.stats.trialClones += 1;
				const [index, rotation] = clone.makeAGuess(marked);
				if (index === -1) {
					// This means all potential guesses are in already ambiguous tiles.
					// But this solver may have different rotations in its solved tiles
					// so we pretend it's solved and send it to the solution comparison branch.
					// This sometimes causes overcounting of further ambiguous tiles
					// once the first set of them is found.
					// The false positives never affect the `unique` result since they can only
					// appear after the first set of ambiguous tiles is found.
					// Completing a full search instead is much more computationally intensive, so here
					// we explicitly prefer a slightly wrong but fast result.
					// Potential experiment - try undercounting instead, just pop the trial here.
					solver.totalUnsolved = 0;
					continue;
				}
				trials.push({
					index,
					guess: rotation,
					solver: clone
				});
			}
		}
		const solvable = marked.every((tile) => tile !== this.UNSOLVED);
		this.progressCallback({
			total,
			ambiguous: numAmbiguous,
			guessed: 0,
			solved: total - numAmbiguous
		});
		return { marked, solvable, unique, numAmbiguous };
	}
}
