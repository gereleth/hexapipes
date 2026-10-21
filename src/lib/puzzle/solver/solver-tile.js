import { popcount, iterate_directions } from '#lib/puzzle/grids/bitmasks.js';

/**
 * A tile has no more viable rotation states
 * @param {SolverTile} tile
 */
export function NoOrientationsPossibleException(tile) {
	this.name = 'NoOrientationsPossible';
	this.message = `No orientations possible for tile ${tile.index}`;
}

/**
 * Returns a canonical id for a rotation state: the sorted list of pipe bitmasks
 * Same multiset of pipes = indistinguishable rotation state
 * @param {Number[]} pipes - rotated pipe bitmasks
 * @returns {String}
 */
function visualId(pipes) {
	const sorted = [...pipes].sort((a, b) => a - b);
	return sorted.join('-') || '0';
}

/**
 * Builds possible states of a tile - deduplicated using visualId
 * @param {Number[]} pipes - pipe bitmasks at rotation 0
 * @param {import('#lib/puzzle/grids/polygonutils.js').RegularPolygonCell} polygon
 * @returns {Map<Number, Number[]>} rotation => pipe bitmasks at that rotation
 */
function buildPossible(pipes, polygon) {
	/** @type {Set<String>} */
	const seen = new Set();
	/** @type {Map<Number, Number[]>} */
	const possible = new Map();
	const numDirections = polygon.numDirections;
	for (let rotation = 0; rotation < numDirections; rotation++) {
		const rotated = pipes.map((pipe) => polygon.rotate(pipe, rotation));
		const id = visualId(rotated);
		if (!seen.has(id)) {
			seen.add(id);
			possible.set(rotation, rotated);
		}
	}
	return possible;
}
/**
 * Constraint state for a single tile of a multipipes puzzle.
 * The decision variable is tile rotation.
 */
export class SolverTile {
	/**
	 *
	 * @param {Number[]} pipes
	 * @param {import('#lib/puzzle/grids/polygonutils.js').RegularPolygonCell} polygon
	 * @param {Number} index
	 * @param {ReturnType<buildPossible>|undefined} [possible]
	 * @param {Number|undefined} [repeatPipesMask] - precomputed for a superset
	 * of possible, e.g. passed down by clone; computed here when omitted
	 * @param {Uint32Array|undefined} [answerRotations] - birth table for a
	 * superset of possible, e.g. passed down by clone; computed here when omitted
	 */
	constructor(
		pipes,
		polygon,
		index,
		possible = undefined,
		repeatPipesMask = undefined,
		answerRotations = undefined
	) {
		this.pipes = pipes;
		this.polygon = polygon;
		this.index = index; // only for error messages
		this.possible = possible || buildPossible(pipes, polygon);
		/** Bitmask of wall constraints on this tile */
		this.walls = 0;
		/** Bitmask of connection constraints on this tile */
		this.connections = 0;
		this.pipePopcounts = pipes.map((x) => popcount(x));
		this.hasDeadends = this.pipePopcounts.some((x) => x === 1);
		/** Deadend constraints pushed into us by neighbours - all our
		 * directions where the neighbour either has a wall or a deadend pipe
		 */
		this.neighbourDeadends = 0;
		/** @type {Map<Number,Number>} - direction => how many pipe nodes might be hiding behind this deadend */
		this.neighbourDeadendWeights = new Map();
		/**
		 * Deadend constraints we push into neighbours - all our directions
		 * where we either have a wall or a deadend pipe
		 */
		this.ownDeadends = 0;
		/** @type {Map<Number,Number>} - direction => how many pipe nodes might be hiding behind this deadend*/
		this.ownDeadendWeights = new Map();
		/** Bitmask of pipe indices where the pipe has fewer distinct states than the whole tile
		 * - only these pipes can be already solved while possible.size > 1 */
		if (repeatPipesMask !== undefined) {
			this.repeatPipesMask = repeatPipesMask;
		} else {
			this.repeatPipesMask = 0;
			const masksPerRotation = [...this.possible.values()];
			for (let pipeIndex = 0; pipeIndex < this.pipes.length; pipeIndex++) {
				const distinct = new Set(masksPerRotation.map((pipes) => pipes[pipeIndex]));
				if (distinct.size < masksPerRotation.length) {
					this.repeatPipesMask |= 1 << pipeIndex;
				}
			}
		}
		/** Per (grid direction bit position, pipe index): bitmask of rotation
		 * numbers where that pipe connects to that direction.
		 * Fixed at birth and stays true while possible shrinks.
		 * Rows for directions the polygon never uses stay zero.
		 * Single-pipe tiles skip the table.
		 * @type {Uint32Array|undefined} */
		this.answerRotations = undefined;
		if (answerRotations !== undefined) {
			this.answerRotations = answerRotations;
		} else if (this.pipes.length > 1) {
			const pipeCount = this.pipes.length;
			// grid direction space spanned by this tile: bit positions 0
			// through the highest bit of the union of all its directions
			const rows = 32 - Math.clz32(this.polygon.fullyConnected);
			this.answerRotations = new Uint32Array(rows * pipeCount);
			for (let [rotation, pipes] of this.possible) {
				for (let i = 0; i < pipeCount; i++) {
					let pipe = pipes[i];
					while (pipe) {
						const low = pipe & -pipe;
						const k = 31 - Math.clz32(low);
						this.answerRotations[k * pipeCount + i] |= 1 << rotation;
						pipe ^= low;
					}
				}
			}
		}
	}
	/**
	 * Clone this tile assigning new possible states
	 * @param {ReturnType<buildPossible>|undefined} newPossible
	 * @returns {SolverTile}
	 */
	clone(newPossible = undefined) {
		// the parent's repeatPipesMask and answerRotations were computed for
		// a superset of newPossible, which keeps them sound - pass them down
		// to skip the birth computations
		const copy = new SolverTile(
			this.pipes,
			this.polygon,
			this.index,
			newPossible,
			this.repeatPipesMask,
			this.answerRotations
		);
		copy.walls = this.walls;
		copy.connections = this.connections;
		copy.neighbourDeadends = this.neighbourDeadends;
		copy.neighbourDeadendWeights = new Map(this.neighbourDeadendWeights);
		copy.ownDeadends = this.ownDeadends;
		copy.ownDeadendWeights = new Map(this.ownDeadendWeights);
		return copy;
	}

	/**
	 * Union of all pipes at a given rotation
	 * @param {Number} rotation
	 * @returns {Number}
	 */
	unionAt(rotation) {
		let union = 0;
		for (let pipe of this.possible.get(rotation) || []) {
			union |= pipe;
		}
		return union;
	}

	/**
	 * @param {Number} direction
	 */
	addWall(direction) {
		this.walls |= direction & ~((this.connections | this.walls) & direction);
		this.neighbourDeadends |= this.walls;
		this.ownDeadends |= this.walls;
	}

	/**
	 * @param {Number} direction
	 */
	addConnection(direction) {
		this.connections |= direction & ~((this.connections | this.walls) & direction);
	}

	/**
	 * Inform this tile that the neighbour in direction could only answer a connection
	 * with a deadend pipe (if at all). Weight is how many pipe nodes belong to the
	 * deadend portion (it might be a whole island with one free link left).
	 * @param {Number} direction
	 * @param {Number} weight
	 */
	addNeighbourDeadend(direction, weight) {
		this.neighbourDeadends |= direction & ~(this.neighbourDeadends & direction);
		this.neighbourDeadendWeights.set(
			direction,
			Math.max(weight, this.neighbourDeadendWeights.get(direction) || 0)
		);
	}

	/**
	 * Filters out orientations that contradict known walls
	 * @param {Number} directions
	 * @return {Number} count of removed orientations
	 */
	mustHaveAllWalls(directions) {
		const remove = [];
		for (let [rotation, pipes] of this.possible) {
			if (pipes.some((pipe) => (pipe & directions) > 0)) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Filters out orientations that connect all the mentioned directions, so
	 * every survivor keeps at least one wall among them.
	 * Implemented union-based but actually only used on classic boards.
	 * @param {Number} directions
	 * @return {Number} count of removed orientations
	 */
	mustHaveSomeWalls(directions) {
		const remove = [];
		for (let rotation of this.possible.keys()) {
			if ((this.unionAt(rotation) & directions) === directions) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Filters out orientations that contradict known connections
	 * @param {Number} directions
	 * @return {Number} count of removed orientations
	 */
	mustHaveAllConnections(directions) {
		const remove = [];
		for (let rotation of this.possible.keys()) {
			if ((this.unionAt(rotation) & directions) !== directions) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Filters out orientations that connect only deadend directions
	 * Unlike walls and connections deadends are not mutual - if my
	 * neighbour extends a deadend toward me I must not answer with a
	 * deadend myself.
	 * @param {Number} directions
	 * @param {Number} unlessThisBig - allow orientation if the resulting island is big enough
	 * @returns {Number} count of removed orientations
	 */
	mustNotSealDeadends(directions, unlessThisBig = Infinity) {
		const remove = [];
		for (let [rotation, pipes] of this.possible) {
			for (let pipe of pipes) {
				if ((pipe & directions) === pipe && this.getDeadendWeight(pipe) < unlessThisBig) {
					remove.push(rotation);
					break;
				}
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Sums up neighbour deadend weights behind each of the pipe's directions
	 * @param {Number} pipe
	 */
	getDeadendWeight(pipe) {
		let total = 1;
		for (let direction of iterate_directions(pipe)) {
			total += this.neighbourDeadendWeights.get(direction) || 0;
		}
		return total;
	}

	/**
	 * Forbid orientations where a certain pipe connects in direction
	 * (use case: pipe is in a component and direction connects to the same component, avoid loop)
	 * @param {Number} pipeIndex
	 * @param {Number} direction
	 */
	forbidPipeDirection(pipeIndex, direction) {
		const remove = [];
		for (let [rotation, pipes] of this.possible) {
			if ((pipes[pipeIndex] & direction) > 0) {
				remove.push(rotation);
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Forbid orientations where any pipe connects at least two of the directions
	 * (use case: all given directions lead to the same component, avoid loop)
	 * @param {Number} directions
	 */
	forbidBridge(directions) {
		const remove = [];
		for (let [rotation, pipes] of this.possible) {
			for (let pipe of pipes) {
				const intersection = pipe & directions;
				if (popcount(intersection) >= 2) {
					remove.push(rotation);
					break;
				}
			}
		}
		remove.forEach((r) => this.possible.delete(r));
		return remove.length;
	}

	/**
	 * Which pipes might answer a connection in this direction, as a bitmask
	 * of pipe indices: 0 = none, single bit = unique, several = ambiguous.
	 * Directions are single-bit masks, the table row is their bit position.
	 * A pipe answers iff any of its birth rotations that connect this
	 * direction is still a survivor
	 * @param {Number} direction
	 * @returns {Number}
	 */
	getAnsweringPipesMask(direction) {
		const rotations = this.answerRotations;
		if (rotations === undefined) {
			// single-pipe tile, no birth table.
			// getAnsweringPipe never actually descends here
			for (let pipes of this.possible.values()) {
				if (pipes[0] & direction) return 1;
			}
			return 0;
		}
		const row = 31 - Math.clz32(direction);
		let survivors = 0;
		for (let rotation of this.possible.keys()) survivors |= 1 << rotation;
		let answering = 0;
		const pipeCount = this.pipes.length;
		for (let i = 0; i < pipeCount; i++) {
			if (rotations[row * pipeCount + i] & survivors) {
				answering |= 1 << i;
			}
		}
		return answering;
	}

	/**
	 * The unique pipe index that might answer a connection in this
	 * direction, or undefined when none or several pipes answer
	 * @param {Number} direction
	 * @returns {Number|undefined}
	 */
	getAnsweringPipe(direction) {
		if (this.pipes.length === 1) return 0;
		const answering = this.getAnsweringPipesMask(direction);
		if (answering !== 0 && popcount(answering) === 1) {
			return 31 - Math.clz32(answering);
		}
		return undefined;
	}

	/**
	 * @returns {Number} our directions where we can only use deadend pipes
	 * or only use pipes that connect to neighbour deadends
	 */
	get ownDeadendDirections() {
		if (!(this.hasDeadends || this.neighbourDeadends > 0)) return 0;
		let deadends = this.polygon.fullyConnected & ~this.walls & ~this.neighbourDeadends;
		const w = this.ownDeadendWeights;
		for (let pipes of this.possible.values()) {
			for (let [index, pipe] of pipes.entries()) {
				if (this.pipePopcounts[index] === 1) {
					w.set(pipe, Math.max(1, w.get(pipe) || 0));
					continue;
				}
				const effectivePipe = pipe & ~this.neighbourDeadends;
				if (effectivePipe === 0) continue;
				else if (popcount(effectivePipe) === 1) {
					let weight = 1;
					for (let direction of iterate_directions(pipe & this.neighbourDeadends)) {
						weight += this.neighbourDeadendWeights.get(direction) || 0;
					}
					w.set(effectivePipe, Math.max(weight, w.get(effectivePipe) || 0));
					continue;
				}
				deadends &= ~effectivePipe;
			}
		}
		return deadends;
	}

	/**
	 * Where this pipe definitely connects
	 * @param {Number} pipeIndex
	 * @returns {Number}
	 */
	getPipeDefiniteConnections(pipeIndex) {
		let connections = this.polygon.fullyConnected & ~this.walls;
		for (let pipes of this.possible.values()) {
			connections &= pipes[pipeIndex];
		}
		return connections;
	}

	/**
	 * Where this pipe might potentially connect
	 * @param {Number} pipeIndex
	 * @returns {Number}
	 */
	getPipePotentialConnections(pipeIndex) {
		let connections = 0;
		for (let pipes of this.possible.values()) {
			connections |= pipes[pipeIndex];
		}
		return connections & ~this.walls;
	}

	/**
	 * Filters out rotations that contradict known constraints
	 * @param {Number} weightRequired - deadend sealing prevented if total sealed weight < weightLimit
	 * @throws {NoOrientationsPossibleException}
	 * @returns {{addedWalls:Number, addedConnections: Number, addedDeadends: Number}}
	 */
	applyConstraints(weightRequired = Infinity) {
		const full = this.polygon.fullyConnected;
		const result = {
			addedWalls: 0,
			addedConnections: 0,
			addedDeadends: 0
		};
		let newWalls = full;
		let newConnections = full;
		const removedCount =
			this.mustHaveAllConnections(this.connections) +
			this.mustHaveAllWalls(this.walls) +
			this.mustNotSealDeadends(this.neighbourDeadends, weightRequired);
		if (this.possible.size === 0) {
			throw new NoOrientationsPossibleException(this);
		}
		for (let rotation of this.possible.keys()) {
			const union = this.unionAt(rotation);
			newWalls = newWalls & (full & ~union);
			newConnections = newConnections & union;
		}
		result.addedWalls = newWalls & ~this.walls;
		this.walls = newWalls;
		result.addedConnections = newConnections & ~this.connections;
		this.connections = newConnections;
		if ((this.hasDeadends || this.neighbourDeadends > 0) && this.ownDeadends !== full) {
			const newDeadends = this.ownDeadendDirections;
			result.addedDeadends = newDeadends & ~this.ownDeadends & ~newWalls;
			this.ownDeadends = newDeadends | newWalls;
		}
		return result;
	}
}
