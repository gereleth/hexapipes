import randomColor from 'randomcolor';
import { createViewBox } from '#lib/puzzle/game/viewbox.js';
import { popcount } from '#lib/puzzle/grids/bitmasks.js';

/**
 * An edge mark
 * none means outer border, show nothing at all
 * @typedef {'wall'|'conn'|'empty'|'none'} EdgeMark
 */

/**
 * @typedef {Number[][]} MultiTiles - a list of pipe bitmasks for every grid cell
 */

/**
 * Saved progress for a single tile
 * @typedef {Object} SavedTileState
 * @property {Number} rotations
 * @property {String|String[]} color - component colors, one per pipe;
 * saves written before the multipes variant hold a single string instead
 * @property {Boolean} locked
 * @property {EdgeMark[]} edgeMarks
 */

/**
 * A component is a group of connected pipe nodes
 * @typedef {Object} Component
 * @property {Set<Number>} nodes
 * @property {Set<Number>} openEnds - set of pipe nodes that have disconnects
 * @property {String} color
 */

/**
 * Saved progress for pipes puzzle
 * @typedef {Object} Progress
 * @property {SavedTileState[]} tiles
 */

/**
 * State for a single game tile
 */
class TileState {
	/** @type {Number[]} - pipe bitmasks at rotation 0 */
	pipes;
	/** @type {String[]} - per pipe */
	colors = $state([]);
	locked = $state(false);
	/** @type {Boolean[]} - per pipe */
	isPartOfLoop = $state([]);
	/** @type {Boolean[]} - per pipe */
	isPartOfIsland = $state([]);
	/** @type {Boolean[]} - per pipe */
	hasDisconnects = $state([]);
	rotations = $state(0);
	/** @type {EdgeMark[]} - per grid edgemark direction */
	edgeMarks = $state([]);

	/**
	 *
	 * @param {Object} data
	 * @param {Number[]} data.pipes
	 * @param {Number} data.rotations
	 * @param {String[]} data.colors
	 * @param {Boolean} data.locked
	 * @param {EdgeMark[]} data.edgeMarks
	 */
	constructor({ pipes, rotations, colors, locked, edgeMarks }) {
		this.pipes = pipes;
		this.rotations = rotations;
		this.colors = colors;
		this.locked = locked;
		this.edgeMarks = edgeMarks;
		this.isPartOfLoop = pipes.map(() => false);
		this.isPartOfIsland = pipes.map(() => false);
		this.hasDisconnects = pipes.map(() => false);
	}

	/**
	 * Union of all pipe bitmasks
	 * @returns {Number}
	 */
	get pipeUnion() {
		return this.pipes.reduce((a, b) => a | b, 0);
	}

	/**
	 * @param {number} times
	 */
	rotate(times) {
		this.rotations += times;
	}

	toggleLocked() {
		this.locked = !this.locked;
	}
}

/**
 * Game state for pipes puzzle, supports classic and multipipes variants alike.
 */
export class PipesGame {
	solved = $state(false);
	/**
	 * pipe node => set of pipe nodes that it mutually connects to
	 * @type {Map<Number, Set<Number>>} */
	connections = new Map();
	/**
	 * @type {TileState[]}
	 */
	tileStates = [];
	/**
	 * pipe node => component that it belongs to
	 * @type {Map<Number, Component>}
	 */
	components = new Map();
	/**
	 * @type {Set<Number>} - set of pipe nodes with disconnects, the
	 * union of all component.openEnds
	 */
	openEnds = new Set();
	disconnectedShare = $state(1);
	disconnectStrokeWidthScale = $derived.by(() => {
		if (this.disconnectedShare > 0.1) {
			return 1;
		} else {
			const amount = 1 - this.disconnectedShare * 10;
			return 1 + 0.4 * amount;
		}
	});
	disconnectStrokeColor = $derived.by(() => {
		if (this.disconnectedShare > 0.1) {
			return '#888888';
		} else {
			const amount = 1 - this.disconnectedShare * 10;
			const color = Math.round(136 - 34 * amount).toString(16);
			return '#' + color + color + color;
		}
	});
	initialized = false;

	/**
	 * @constructor
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number[]|Number[][]} tiles Classic input (single pipe bitmask per cell)
	 * is normalized to (single-element array per cell).
	 * @param {Progress|undefined} savedProgress
	 */
	constructor(grid, tiles, savedProgress) {
		this.grid = grid;
		this.isMulti = !Number.isInteger(tiles[0]);
		/** @type {MultiTiles} */
		this.tiles = this.isMulti
			? /** @type {Number[][]} */ (tiles)
			: /** @type {Number[]} */ (tiles).map((tile) => (tile === 0 ? [] : [tile]));
		this.totalCells = grid.total;
		this.viewBox = createViewBox(grid);
		this.totalNodes = this.tiles.reduce((sum, cellPipes) => sum + cellPipes.length, 0);
		// a spanning tree over N pipe nodes has N - 1 connections
		// every connection uses two pipe ends, so 2 * (N - 1) pipe ends in total.
		// pipe bitmasks are static, so a board either adds up or it never will
		const pipeEnds = this.tiles.reduce(
			(sum, cellPipes) => sum + cellPipes.reduce((cellSum, pipe) => cellSum + popcount(pipe), 0),
			0
		);
		/**
		 * @type {Boolean} - precondition of isSolved */
		this.treeShaped = pipeEnds === 2 * (this.totalNodes - 1);
		/** @type {EdgeMark[]} */
		const defaultEdgeMarks = this.grid.EDGEMARK_DIRECTIONS.map(() => 'empty');
		if (savedProgress) {
			this.tileStates = this.tiles.map((pipes, index) => {
				const savedTile = savedProgress.tiles[index];
				const savedColor = savedTile.color;
				return new TileState({
					pipes,
					rotations: savedTile.rotations,
					colors: Array.isArray(savedColor)
						? savedColor
						: typeof savedColor === 'string'
							? [savedColor]
							: pipes.map(() => 'white'),
					locked: savedTile.locked ?? false,
					edgeMarks: savedTile.edgeMarks || [...defaultEdgeMarks]
				});
			});
		} else {
			this.tileStates = this.tiles.map((pipes, index) => {
				// disable edge marks on outer edges of non-wrap puzzles
				const edgeMarks = [...defaultEdgeMarks];
				if (!this.grid.wrap) {
					this.grid.EDGEMARK_DIRECTIONS.forEach((direction, direction_index) => {
						const { empty } = this.grid.findNeighbour(index, direction);
						if (empty) {
							edgeMarks[direction_index] = 'none';
						}
					});
				}
				return new TileState({
					pipes,
					rotations: 0,
					colors: pipes.map(() => 'white'),
					locked: false,
					edgeMarks
				});
			});
		}
		let firstValidCell = 0;
		while (this.grid.emptyCells.has(firstValidCell)) {
			firstValidCell += 1;
		}
		this.firstValidNode = this.grid.pipeNodeId(firstValidCell, 0);

		this.initializeBoard();
	}

	/**
	 * Directions a single pipe is currently pointing to
	 * @param {Number} index
	 * @param {Number} pipeIndex
	 * @returns {Number[]}
	 */
	pipeDirections(index, pipeIndex) {
		const tileState = this.tileStates[index];
		return this.grid.getDirections(tileState.pipes[pipeIndex], tileState.rotations, index);
	}

	/**
	 * Finds the pipe index that our neighbour connecting in direction would meet
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {Number} - pipe index or -1 if there is no such pipe
	 */
	findAnsweringPipeIndex(index, direction) {
		const opposite = this.grid.OPPOSITE.get(direction) || 0;
		const tileState = this.tileStates[index];
		for (let pipeIndex = 0; pipeIndex < tileState.pipes.length; pipeIndex++) {
			if (this.pipeDirections(index, pipeIndex).includes(opposite)) {
				return pipeIndex;
			}
		}
		return -1;
	}

	initializeBoard() {
		// create components and fill in connections data;
		// only mutual links are stored, empty tiles are skipped
		this.tileStates.forEach((state, index) => {
			for (let pipeIndex = 0; pipeIndex < state.pipes.length; pipeIndex++) {
				const nodeId = this.grid.pipeNodeId(index, pipeIndex);
				const connections = new Set();
				this.connections.set(nodeId, connections);
				for (let direction of this.pipeDirections(index, pipeIndex)) {
					const { neighbour, empty } = this.grid.findNeighbour(index, direction);
					if (empty) {
						state.hasDisconnects[pipeIndex] = true;
						continue;
					}
					const ansPipeIndex = this.findAnsweringPipeIndex(neighbour, direction);
					if (ansPipeIndex === -1) {
						state.hasDisconnects[pipeIndex] = true;
						continue;
					}
					connections.add(this.grid.pipeNodeId(neighbour, ansPipeIndex));
				}
			}
		});
		// merge initial components of connected pipe nodes
		const checked = new Set();
		for (let index = 0; index < this.totalCells; index++) {
			const state = this.tileStates[index]; // FIXME what of empty tiles?
			for (let pipeIndex = 0; pipeIndex < state.pipes.length; pipeIndex++) {
				const nodeId = this.grid.pipeNodeId(index, pipeIndex);
				if (checked.has(nodeId)) {
					continue;
				}
				const toCheck = new Set([nodeId]);
				const component = {
					color: state.colors[pipeIndex],
					nodes: new Set([nodeId]),
					openEnds: new Set()
				};
				const connectedThrough = new Map();
				let loop = false;
				while (toCheck.size > 0) {
					const [nodeId] = toCheck;
					const [memberIndex, memberPipeIndex] = this.grid.cellIndexPipeIndexOf(nodeId);
					const tileState = this.tileStates[memberIndex];
					toCheck.delete(nodeId);
					checked.add(nodeId);
					this.components.set(nodeId, component);
					component.nodes.add(nodeId);
					if (tileState.hasDisconnects[memberPipeIndex]) {
						component.openEnds.add(nodeId);
						this.openEnds.add(nodeId);
					}
					const connected = this.connections.get(nodeId) || new Set();
					for (let neighbourNodeId of connected) {
						const through = connectedThrough.get(neighbourNodeId) || -1;
						if (through === nodeId) {
							// seen this connection before
							continue;
						}
						if (through !== -1) {
							// connected to the same component through some other node
							loop = true;
							continue;
						}
						toCheck.add(neighbourNodeId);
						connectedThrough.set(neighbourNodeId, nodeId);
					}
				}
				if (loop) {
					const loopNodes = this.detectLoops(component.nodes);
					for (let loopNodeId of loopNodes) {
						const [loopCell, loopPipeIndex] = this.grid.cellIndexPipeIndexOf(loopNodeId);
						this.tileStates[loopCell].isPartOfLoop[loopPipeIndex] = true;
					}
				}
				if (component.openEnds.size === 0) {
					for (let islandNodeId of component.nodes) {
						const [islandCell, islandPipeIndex] = this.grid.cellIndexPipeIndexOf(islandNodeId);
						this.tileStates[islandCell].isPartOfIsland[islandPipeIndex] = true;
					}
				}
			}
		}
		this.disconnectedShare = this.openEnds.size / this.totalNodes;
		this.initialized = true;
	}

	startOver() {
		this.connections.clear();
		this.components.clear();
		this.initialized = false;
		this.solved = false;
		this.openEnds.clear();

		this.tileStates.forEach((tileState) => {
			tileState.rotations = 0;
			tileState.locked = false;
			tileState.colors = tileState.pipes.map(() => 'white');
			tileState.isPartOfIsland = tileState.pipes.map(() => false);
			tileState.isPartOfLoop = tileState.pipes.map(() => false);
			tileState.hasDisconnects = tileState.pipes.map(() => false);
			// edgemarks on outer edges may be 'none'
			// keep that info and discard other edgemarks
			tileState.edgeMarks = tileState.edgeMarks.map((edgemark) => {
				return edgemark === 'none' ? 'none' : 'empty';
			});
		});

		this.initializeBoard();
	}

	/**
	 * Rotate tile a certain number of times, all pipes at once
	 * @param {Number} index
	 * @param {Number} times
	 */
	rotateTile(index, times) {
		if (this.solved || times === 0) {
			return;
		}
		const tileState = this.tileStates[index];
		if (tileState === undefined || tileState.locked || tileState.pipes.length === 0) {
			return;
		}
		/** @type {{pipeIndex: Number, direction: Number}[]} */
		const dirOut = [];
		/** @type {{pipeIndex: Number, direction: Number}[]} */
		const dirIn = [];
		const oldDirections = tileState.pipes.map((_, pipeIndex) =>
			this.pipeDirections(index, pipeIndex)
		);
		tileState.rotate(times);
		tileState.pipes.forEach((_, pipeIndex) => {
			const newDirections = this.pipeDirections(index, pipeIndex);
			oldDirections[pipeIndex].forEach((direction) => {
				if (!newDirections.includes(direction)) {
					dirOut.push({ pipeIndex, direction });
				}
			});
			newDirections.forEach((direction) => {
				if (!oldDirections[pipeIndex].includes(direction)) {
					dirIn.push({ pipeIndex, direction });
				}
			});
		});

		this.handleConnections(index, dirIn, dirOut);
	}

	/**
	 * Rotate tile to a certain rotation, all pipes at once.
	 * The rotation is relative to the tile's initial state,
	 * not to the current accumulated rotations
	 * @param {Number} index
	 * @param {Number} rotation - target rotation count
	 * @param {Boolean} [animate=false] - do a full turn if already at target
	 */
	setTileRotation(index, rotation, animate = false) {
		const tileState = this.tileStates[index];
		if (tileState === undefined || tileState.pipes.length === 0) {
			return;
		}
		const numDirections = this.grid.polygonAt(index).numDirections;
		const current = ((tileState.rotations % numDirections) + numDirections) % numDirections;
		let delta = (rotation - current) % numDirections;
		if (delta < 0) {
			delta += numDirections;
		}
		if (delta !== 0 || animate) {
			this.toggleLocked(index, false);
			this.rotateTile(index, delta === 0 ? numDirections : delta);
		}
	}

	/**
	 * Process tile disconnecting from dirOut and connecting to dirIn
	 * @param {Number} index
	 * @param {{pipeIndex: Number, direction: Number}[]} dirIn
	 * @param {{pipeIndex: Number, direction: Number}[]} dirOut
	 * @returns {void}
	 */
	handleConnections(index, dirIn, dirOut) {
		// Process connections that were severed: delete connections, add new openEnds,
		// clear island highlighting, disconnect components
		dirOut.forEach(({ pipeIndex, direction }) => {
			const nodeId = this.grid.pipeNodeId(index, pipeIndex);
			const { neighbour, empty } = this.grid.findNeighbour(index, direction);
			if (empty) {
				return;
			}
			const ansPipeIndex = this.findAnsweringPipeIndex(neighbour, direction);
			if (ansPipeIndex === -1) {
				// this connection wasn't mutual, nothing is stored
				return;
			}
			const neighbourNodeId = this.grid.pipeNodeId(neighbour, ansPipeIndex);
			this.connections.get(nodeId)?.delete(neighbourNodeId);
			this.connections.get(neighbourNodeId)?.delete(nodeId);
			// update disconnected status of neighbour node
			// will also clear island highlighting from the whole component
			// (if it was an island before the split)
			this.updateOpenEnds(neighbour, ansPipeIndex, true);
			// provisionally set our own disconnected status
			// so this node counts as an open end while merging
			this.updateOpenEnds(index, pipeIndex, true);
			this.disconnectComponents(nodeId, neighbourNodeId);
		});
		// Process new connections: add connections, merge components

		/**
		 * @type {Set<Number>} - indices of pipes whose new directions
		 * didn't all end up in mutual connections */
		const knownDisconnected = new Set();
		dirIn.forEach(({ pipeIndex, direction }) => {
			const nodeId = this.grid.pipeNodeId(index, pipeIndex);
			const { neighbour, empty } = this.grid.findNeighbour(index, direction);
			if (empty) {
				knownDisconnected.add(pipeIndex);
				return;
			}
			const ansPipeIndex = this.findAnsweringPipeIndex(neighbour, direction);
			if (ansPipeIndex === -1) {
				// non-mutual link shouldn't lead to merging
				knownDisconnected.add(pipeIndex);
				return;
			}
			const neighbourNodeId = this.grid.pipeNodeId(neighbour, ansPipeIndex);
			this.connections.get(nodeId)?.add(neighbourNodeId);
			this.connections.get(neighbourNodeId)?.add(nodeId);
			this.mergeComponents(nodeId, neighbourNodeId);
			this.updateOpenEnds(neighbour, ansPipeIndex);
		});
		// Finally - update disconnect status of all our nodes
		for (let pipeIndex = 0; pipeIndex < this.tileStates[index].pipes.length; pipeIndex++) {
			if (knownDisconnected.has(pipeIndex)) {
				this.updateOpenEnds(index, pipeIndex, true);
			} else {
				// recompute for pipes where we don't know for sure
				// may apply island highlighting if the component ends up closed off
				this.updateOpenEnds(index, pipeIndex);
			}
		}
		if (this.initialized) {
			this.solved = this.isSolved();
		}
	}

	/**
	 * Sets or recomputes presence of disconnects in a pipe node.
	 * Keeps track of openEnds, applies and removes island highlights
	 *
	 * @param {Number} index
	 * @param {Number} pipeIndex
	 * @param {Boolean} [knownDisconnected=false] - pass true when a disconnect
	 * is already known, omit to recompute
	 */
	updateOpenEnds(index, pipeIndex, knownDisconnected = false) {
		const nodeId = this.grid.pipeNodeId(index, pipeIndex);
		const hasDisconnects =
			knownDisconnected ||
			this.connections.get(nodeId)?.size !== popcount(this.tiles[index][pipeIndex]);
		this.tileStates[index].hasDisconnects[pipeIndex] = hasDisconnects;
		const component = this.components.get(nodeId);
		if (component === undefined) {
			throw `Component open ends data for pipe node ${nodeId} not found`;
		}
		if (hasDisconnects) {
			if (component.openEnds.size === 0) {
				this.markIsland(component, false);
			}
			component.openEnds.add(nodeId);
			this.openEnds.add(nodeId);
		} else {
			component.openEnds.delete(nodeId);
			this.openEnds.delete(nodeId);
			if (component.openEnds.size === 0 && component.nodes.size < this.totalNodes) {
				this.markIsland(component, true);
			}
		}
		this.disconnectedShare = this.openEnds.size / this.totalNodes;
	}

	/**
	 * Add or remove island highlighting on component's subcells
	 * @param {Component} component
	 * @param {boolean} isIsland
	 */
	markIsland(component, isIsland) {
		for (let nodeId of component.nodes) {
			const [index, pipeIndex] = this.grid.cellIndexPipeIndexOf(nodeId);
			this.tileStates[index].isPartOfIsland[pipeIndex] = isIsland;
		}
	}

	/**
	 * @returns {boolean}
	 */
	isSolved() {
		if (!this.treeShaped) {
			// wrong pipe end count for a spanning tree over subcells
			return false;
		}
		if (this.openEnds.size > 0) {
			// some pipes have disconnects
			return false;
		}
		const component = this.components.get(this.firstValidNode);
		return component !== undefined && component.nodes.size === this.totalNodes;
	}

	/**
	 * Merges the components of two nodes linked by a new connection
	 * @param {Number} fromNodeId
	 * @param {Number} toNodeId
	 * @returns {void}
	 */
	mergeComponents(fromNodeId, toNodeId) {
		const fromComponent = this.components.get(fromNodeId);
		const toComponent = this.components.get(toNodeId);
		// makes jsdoc stop complaining about
		// "object is possibly undefined"
		if (fromComponent === undefined || toComponent === undefined) {
			return;
		}
		if (fromComponent === toComponent) {
			// it's a loop
			const loopNodes = this.detectLoops(fromComponent.nodes);
			for (let nodeId of fromComponent.nodes) {
				const [index, pipeIndex] = this.grid.cellIndexPipeIndexOf(nodeId);
				this.tileStates[index].isPartOfLoop[pipeIndex] = loopNodes.has(nodeId);
			}
			return;
		}
		const fromIsBigger = fromComponent.nodes.size >= toComponent.nodes.size;
		const constantComponent = fromIsBigger ? fromComponent : toComponent;
		const changedComponent = fromIsBigger ? toComponent : fromComponent;
		if (this.initialized) {
			let newColor = constantComponent.color;
			if (newColor === 'white') {
				newColor = changedComponent.color;
			}
			if (newColor === 'white') {
				newColor = randomColor({ luminosity: 'light' });
			}
			if (constantComponent.color !== newColor) {
				constantComponent.nodes.forEach((nodeId) => {
					const [index, pipeIndex] = this.grid.cellIndexPipeIndexOf(nodeId);
					this.tileStates[index].colors[pipeIndex] = newColor;
				});
			}
			constantComponent.color = newColor;
		}
		for (let changedNodeId of changedComponent.nodes) {
			this.components.set(changedNodeId, constantComponent);
			constantComponent.nodes.add(changedNodeId);
			const [changedIndex, changedPipeIndex] = this.grid.cellIndexPipeIndexOf(changedNodeId);
			this.tileStates[changedIndex].colors[changedPipeIndex] = constantComponent.color;
		}
		for (let changedNodeId of changedComponent.openEnds) {
			constantComponent.openEnds.add(changedNodeId);
		}
	}

	/**
	 * Toggle tile's locked state, return new state
	 * @param {Number} index
	 * @param {boolean|undefined} [state]
	 * @param {boolean} [assistant=false]
	 * @returns {boolean} - new locked value
	 */
	toggleLocked(index, state = undefined, assistant = false) {
		const tileState = this.tileStates[index];
		let targetState = false;
		if (state === undefined) {
			targetState = !tileState.locked;
		} else {
			targetState = state;
		}
		if (tileState.locked !== targetState) {
			tileState.toggleLocked();
		}
		if (targetState && assistant) {
			for (let direction of this.grid.polygonAt(index).directions) {
				const { neighbour, empty } = this.grid.findNeighbour(index, direction);
				if (empty) {
					continue;
				}
				this.rotateToMatchMarks(neighbour);
			}
		}
		return targetState;
	}

	/**
	 *
	 * @param {EdgeMark} mark
	 * @param {Number} index
	 * @param {Number} direction
	 * @param {Boolean} assistant
	 */
	toggleEdgeMark(mark, index, direction, assistant = false) {
		const { neighbour, empty } = this.grid.findNeighbour(index, direction);
		if (empty) {
			// no edgemarks on outer borders
			return;
		}
		const directionIndex = this.grid.EDGEMARK_DIRECTIONS.indexOf(direction);
		if (directionIndex === -1) {
			// toggle mark on the neighbour instead
			const opposite = this.grid.OPPOSITE.get(direction);
			if (!empty && opposite) {
				this.toggleEdgeMark(mark, neighbour, opposite, assistant);
			}
			return;
		}
		const tileState = this.tileStates[index];
		if (tileState.edgeMarks[directionIndex] === mark) {
			tileState.edgeMarks[directionIndex] = 'empty';
		} else if (tileState.edgeMarks[directionIndex] !== 'none') {
			tileState.edgeMarks[directionIndex] = mark;
		}
		if (tileState.edgeMarks[directionIndex] !== 'empty' && assistant) {
			this.rotateToMatchMarks(index);
			this.rotateToMatchMarks(neighbour);
		}
	}

	/**
	 * Rotate a tile so that it fits existing edgemarks and locked neighbours
	 * @param {number} index
	 */
	rotateToMatchMarks(index) {
		const tileState = this.tileStates[index];
		if (tileState.locked) {
			return;
		}
		let walls = 0;
		let connections = 0;
		const polygon = this.grid.polygonAt(index);
		for (let direction of polygon.directions) {
			const { neighbour, empty } = this.grid.findNeighbour(index, direction);
			if (empty) {
				walls += direction;
				continue;
			}
			if (this.tileStates[neighbour].locked) {
				// one-sided check: does the locked neighbour point at this cell?
				if (this.findAnsweringPipeIndex(neighbour, direction) !== -1) {
					connections += direction;
				} else {
					walls += direction;
				}
				continue;
			}
			const directionIndex = this.grid.EDGEMARK_DIRECTIONS.indexOf(direction);
			/** @type {EdgeMark} */
			let mark = 'empty';
			if (directionIndex === -1) {
				// neighbour state has info about this mark
				const opposite = this.grid.OPPOSITE.get(direction) || 0;
				const oppositeIndex = this.grid.EDGEMARK_DIRECTIONS.indexOf(opposite);
				mark = this.tileStates[neighbour].edgeMarks[oppositeIndex];
			} else {
				mark = tileState.edgeMarks[directionIndex];
			}
			if (mark === 'conn') {
				connections += direction;
			} else if (mark === 'wall') {
				walls += direction;
			}
		}
		// merge all pipes to check if walls/connections fit
		const union = tileState.pipeUnion;
		for (let r = 0; r < polygon.directions.length; r++) {
			const rotations = tileState.rotations + r;
			const rotated = polygon.rotate(union, rotations);
			if ((rotated & connections) === connections && (rotated & walls) === 0) {
				this.rotateTile(index, r);
				break;
			}
		}
	}

	/**
	 * Splits a component by severing a connection between its two nodes.
	 * @param {Number} fromNodeId
	 * @param {Number} toNodeId
	 * @returns {void}
	 */
	disconnectComponents(fromNodeId, toNodeId) {
		const fromComponent = this.components.get(fromNodeId);
		const toComponent = this.components.get(toNodeId);
		if (fromComponent === undefined || toComponent === undefined || fromComponent !== toComponent) {
			throw `disconnectComponents called for non-connected nodes ${fromNodeId}, ${toNodeId}`;
		}
		const fromNodes = this.findConnectedNodes(toNodeId, fromNodeId);
		const toNodes = this.findConnectedNodes(fromNodeId, toNodeId);
		if ([...fromNodes].some((nodeId) => toNodes.has(nodeId))) {
			// it was a loop or maybe it still is
			const loopNodes = this.detectLoops(fromComponent.nodes);
			for (let nodeId of fromComponent.nodes) {
				const [index, pipeIndex] = this.grid.cellIndexPipeIndexOf(nodeId);
				this.tileStates[index].isPartOfLoop[pipeIndex] = loopNodes.has(nodeId);
			}
			return;
		}
		const fromIsBigger = fromNodes.size >= toNodes.size;
		const changeNodes = fromIsBigger ? toNodes : fromNodes;
		const newComponent = {
			color: randomColor({ luminosity: 'light' }),
			nodes: changeNodes,
			/** @type {Set<Number>}*/
			openEnds: new Set([])
		};

		for (let nodeId of changeNodes) {
			this.components.set(nodeId, newComponent);
			fromComponent.nodes.delete(nodeId);
			if (fromComponent.openEnds.delete(nodeId)) {
				newComponent.openEnds.add(nodeId);
			}
			const [index, pipeIndex] = this.grid.cellIndexPipeIndexOf(nodeId);
			this.tileStates[index].colors[pipeIndex] = newComponent.color;
		}
	}

	/**
	 * Detects loops in a connected component.
	 * Returned node ids are part of at least one loop.
	 * @param {Set<Number>} nodeIds
	 * @returns {Set<Number>}
	 */
	detectLoops(nodeIds) {
		/**
		 * @type {Map<Number, Set<Number>>}
		 */
		const myConnections = new Map();
		/**
		 * @type {Set<Number>}
		 */
		let toPrune = new Set();
		for (let nodeId of nodeIds) {
			const nodeConnections = this.connections.get(nodeId);
			if (nodeConnections === undefined) {
				throw `Could not find connections data for subcell ${nodeId}`;
			}
			// FIXME - with mutual-only storage they are *all* part of this component, no filter necessary
			// keep only connections that are part of this component
			const inComponent = new Set([...nodeConnections].filter((x) => nodeIds.has(x)));
			myConnections.set(nodeId, inComponent);
			if (inComponent.size === 1) {
				toPrune.add(nodeId);
			}
		}

		/**
		 * Prune a node with a single in-component connection to exclude it from loop highlighting
		 * @param {Number} nodeId
		 * @returns {Set<Number>}
		 */
		function prune(nodeId) {
			const neighbourNodes = myConnections.get(nodeId);
			if (neighbourNodes === undefined) {
				throw `Could not find connections data for node ${nodeId}`;
			}
			if (neighbourNodes.size <= 1) {
				myConnections.delete(nodeId);
				neighbourNodes.forEach((neighbourNodeId) => {
					const neighbourConnections = myConnections.get(neighbourNodeId);
					if (neighbourConnections === undefined) {
						throw `Could not find connections data for subcell ${neighbourNodeId}`;
					}
					neighbourConnections.delete(nodeId);
				});
				return neighbourNodes;
			}
			return new Set();
		}

		function pruneDeadEnds() {
			while (toPrune.size > 0) {
				const [nodeId] = toPrune;
				toPrune.delete(nodeId);
				const changedNeighbours = prune(nodeId);
				changedNeighbours.forEach((n) => toPrune.add(n));
			}
		}

		pruneDeadEnds();

		// at this point we have all the loops but maybe also
		// some bridges between loops
		// need to prune them too
		const inLoops = new Set();

		/**
		 * Tries to find a path from one node through another and back again
		 * without revisiting any nodes
		 * @param {Number} fromNodeId
		 * @param {Number} throughNodeId
		 * @returns {Number[]} - nodeIds that make a looping path.
		 * Empty array if there is no such path.
		 */
		function traceLoopPath(fromNodeId, throughNodeId) {
			let paths = [[fromNodeId, throughNodeId]];
			while (paths.length > 0) {
				const path = paths.pop();
				if (path === undefined || path.length === 0) {
					throw 'Wrong path encountered while tracing loops';
				}
				const lastNodeId = path[path.length - 1];
				const neighbourNodes = myConnections.get(lastNodeId);
				if (neighbourNodes === undefined) {
					throw `Could not find connections data for node ${lastNodeId}`;
				}
				for (let neighbourNodeId of neighbourNodes) {
					if (neighbourNodeId === fromNodeId) {
						if (path.length > 2) {
							// successful loop
							return path;
						} else {
							continue;
						}
					}
					if (path.slice(1).some((x) => x === neighbourNodeId)) {
						// already been here
						continue;
					}
					paths.push([...path, neighbourNodeId]);
				}
			}
			return [];
		}
		while (inLoops.size < myConnections.size) {
			let nodeToCheck = -1;
			for (let nodeId of myConnections.keys()) {
				if (!inLoops.has(nodeId)) {
					nodeToCheck = nodeId;
					break;
				}
			}
			const neighbourNodes = myConnections.get(nodeToCheck);
			if (neighbourNodes === undefined) {
				throw `Could not find connections data for node ${nodeToCheck}`;
			}
			const [neighbourNode] = neighbourNodes;
			const loop = traceLoopPath(nodeToCheck, neighbourNode);
			if (loop.length === 0) {
				// no loop found
				neighbourNodes.delete(neighbourNode);
				// FIXME simplify with ?.delete, no throw
				const neighbourConnections = myConnections.get(neighbourNode);
				if (neighbourConnections === undefined) {
					throw `Could not find connections data for node ${neighbourNode}`;
				}
				neighbourConnections.delete(nodeToCheck);
				toPrune.add(neighbourNode).add(nodeToCheck);
				pruneDeadEnds();
			} else {
				loop.forEach((n) => inLoops.add(n));
			}
		}
		return inLoops;
	}

	/**
	 * Find nodes that are connected to toNodeId
	 * Excluding connections through fromNodeId
	 * Used when the player breaks up connected components
	 * @param {Number} fromNodeId
	 * @param {Number} toNodeId
	 * @returns {Set<Number>}
	 */
	findConnectedNodes(fromNodeId, toNodeId) {
		const myComponent = this.components.get(toNodeId);
		if (myComponent === undefined) {
			throw `Could not find component for subcell ${toNodeId}`;
		}
		let nodesToCheck = new Set([{ fromNodeId, nodeId: toNodeId }]);
		/** @type {Set<Number>} */
		const checked = new Set([]);
		while (nodesToCheck.size > 0) {
			/** @type {Set<{fromNodeId: Number, nodeId: Number}>} */
			const newChecks = new Set([]);
			for (let { fromNodeId, nodeId } of nodesToCheck) {
				const neighbourNodes = this.connections.get(nodeId);
				if (neighbourNodes === undefined) {
					throw `Could not find connections data for subcell ${nodeId}`;
				}
				for (let neighbourNodeId of neighbourNodes) {
					const neighbourComponent = this.components.get(neighbourNodeId);
					if (neighbourComponent === undefined) {
						throw `Could not find component for subcell ${neighbourNodeId}`;
					}
					if (neighbourComponent !== myComponent) {
						// FIXME cannot happen since mutual-only storage
						// not from this component, will be handled during merge phase
						continue;
					}
					if (neighbourNodeId === fromNodeId) {
						// came from here
						continue;
					}
					if (checked.has(neighbourNodeId)) {
						continue;
					}
					newChecks.add({ fromNodeId: nodeId, nodeId: neighbourNodeId });
				}
				checked.add(nodeId);
			}
			nodesToCheck = newChecks;
		}
		return checked;
	}
}
