import randomColor from 'randomcolor';
import { createViewBox } from './viewbox';

/**
 * An edge mark
 * none means outer border, show nothing at all
 * @typedef {'wall'|'conn'|'empty'|'none'} EdgeMark
 */

/**
 * @typedef {Number[][]} LayeredTiles - for every grid cell a list of layers,
 * each layer is a tile bitmask of its connections;
 * cells that are empty on the board have no layers
 */

/**
 * Saved progress for a single tile
 * @typedef {Object} SavedTileState
 * @property {Number} rotations
 * @property {String|String[]} color - component colors, one per layer;
 * saves written before the game unification hold a single string instead
 * @property {Boolean} locked
 * @property {EdgeMark[]} edgeMarks
 */

/**
 * A component is a group of connected subcells
 * @typedef {Object} Component
 * @property {Set<Number>} subcells
 * @property {Set<Number>} openEnds - set of subcells that have disconnects
 * @property {String} color
 */

/**
 * Saved progress for pipes puzzle
 * @typedef {Object} Progress
 * @property {SavedTileState[]} tiles
 */

/**
 * State for a single grid cell
 */
class TileState {
	/** @type {Number[]} - tile bitmasks, one per layer */
	layers;
	/** @type {String[]} - component colors per layer */
	colors = $state([]);
	locked = $state(false);
	/** @type {Boolean[]} - per layer */
	isPartOfLoop = $state([]);
	/** @type {Boolean[]} - per layer */
	isPartOfIsland = $state([]);
	/** @type {Boolean[]} - per layer */
	hasDisconnects = $state([]);
	rotations = $state(0);
	/** @type {EdgeMark[]} - per grid edge */
	edgeMarks = $state([]);

	/**
	 *
	 * @param {Object} data
	 * @param {Number[]} data.layers
	 * @param {Number} data.rotations
	 * @param {String[]} data.colors
	 * @param {Boolean} data.locked
	 * @param {EdgeMark[]} data.edgeMarks
	 */
	constructor({ layers, rotations, colors, locked, edgeMarks }) {
		this.layers = layers;
		this.rotations = rotations;
		this.colors = colors;
		this.locked = locked;
		this.edgeMarks = edgeMarks;
		this.isPartOfLoop = layers.map(() => false);
		this.isPartOfIsland = layers.map(() => false);
		this.hasDisconnects = layers.map(() => false);
	}

	/**
	 * Union of all layer bitmasks
	 * @returns {Number}
	 */
	get tile() {
		return this.layers.reduce((a, b) => a | b, 0);
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
 * Game state for pipes puzzle, shared by the classic and the layered variant.
 * Classic input (one bitmask per cell) is normalized to a single layer per
 * cell, so one state model serves both.
 *
 * Vocabulary used throughout:
 * - tile: the whole state object of a grid cell (TileState); the raw input
 *   bitmasks keep their grid-side name `tiles` (see LayeredTiles), and the
 *   `tile` getter on a TileState is the union of a cell's layer masks in
 *   that same vocabulary
 * - cell: cell index (grid neighbour lookups, index into tileStates)
 * - layer: layer index within a cell
 * - subcell: node id `cell + layer * grid.total`, what every map and set
 *   in here is keyed by; for classic boards subcells coincide with
 *   the plain cell indices
 *
 * Layers of a cell are independent pipes that never connect to each other,
 * a rotation turns all layers of a cell simultaneously.
 */
export class PipesGame {
	solved = $state(false);
	/**
	 * subcell => set of subcells that it mutually connects to
	 * @type {Map<Number, Set<Number>>} */
	connections = new Map();
	/**
	 * @type {TileState[]}
	 */
	tileStates = [];
	/**
	 * subcell => component that it belongs to
	 * @type {Map<Number, Component>}
	 */
	components = new Map();
	/**
	 * @type {Set<Number>} - set of subcells with disconnects
	 */
	openEnds = new Set();
	shareDisconnectedSubcells = $state(1);
	disconnectStrokeWidthScale = $derived.by(() => {
		if (this.shareDisconnectedSubcells > 0.1) {
			return 1;
		} else {
			const amount = 1 - this.shareDisconnectedSubcells * 10;
			return 1 + 0.4 * amount;
		}
	});
	disconnectStrokeColor = $derived.by(() => {
		if (this.shareDisconnectedSubcells > 0.1) {
			return '#888888';
		} else {
			const amount = 1 - this.shareDisconnectedSubcells * 10;
			const color = Math.round(136 - 34 * amount).toString(16);
			return '#' + color + color + color;
		}
	});
	initialized = false;

	/**
	 * @constructor
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number[]|Number[][]} tiles - one bitmask per cell (classic) or a
	 * list of layer bitmasks per cell (layered)
	 * @param {Progress|undefined} savedProgress
	 */
	constructor(grid, tiles, savedProgress) {
		this.grid = grid;
		this.isLayered = !Number.isInteger(tiles[0]);
		/** @type {LayeredTiles} */
		this.tiles = this.isLayered
			? /** @type {Number[][]} */ (tiles)
			: /** @type {Number[]} */ (tiles).map((tile) => (tile === 0 ? [] : [tile]));
		this.totalCells = grid.total;
		this.viewBox = createViewBox(grid);
		this.totalSubcells = this.tiles.reduce((sum, cellLayers) => sum + cellLayers.length, 0);
		/** @type {EdgeMark[]} */
		const defaultEdgeMarks = this.grid.EDGEMARK_DIRECTIONS.map(() => 'empty');
		if (savedProgress) {
			this.tileStates = this.tiles.map((cellLayers, index) => {
				const savedTile = savedProgress.tiles[index];
				const savedColor = savedTile.color;
				return new TileState({
					layers: cellLayers,
					rotations: savedTile.rotations,
					colors: Array.isArray(savedColor)
						? savedColor
						: typeof savedColor === 'string'
							? [savedColor]
							: cellLayers.map(() => 'white'),
					locked: savedTile.locked ?? false,
					edgeMarks: savedTile.edgeMarks || [...defaultEdgeMarks]
				});
			});
		} else {
			this.tileStates = this.tiles.map((cellLayers, index) => {
				// disable edge marks on outer edges of non-wrap puzzles
				const edgeMarks = [...defaultEdgeMarks];
				if (!this.grid.wrap) {
					this.grid.EDGEMARK_DIRECTIONS.forEach((direction, direction_index) => {
						const { empty } = this.grid.find_neighbour(index, direction);
						if (empty) {
							edgeMarks[direction_index] = 'none';
						}
					});
				}
				return new TileState({
					layers: cellLayers,
					rotations: 0,
					colors: cellLayers.map(() => 'white'),
					locked: false,
					edgeMarks
				});
			});
		}
		let firstValidCell = 0;
		while (this.grid.emptyCells.has(firstValidCell)) {
			firstValidCell += 1;
		}
		this.firstValidSubcell = this.grid.subcellId(firstValidCell, 0);

		this.initializeBoard();
	}

	/**
	 * Directions the layer of a cell is currently pointing to
	 * @param {Number} cell
	 * @param {Number} layer
	 * @returns {Number[]}
	 */
	layerDirections(cell, layer) {
		const tileState = this.tileStates[cell];
		return this.grid.getDirections(tileState.layers[layer], tileState.rotations, cell);
	}

	/**
	 * Finds a layer of a cell that points back in the opposite direction
	 * @param {Number} cell
	 * @param {Number} direction
	 * @returns {Number} - layer number or -1 if there is no such layer
	 */
	findBackLayer(cell, direction) {
		const opposite = this.grid.OPPOSITE.get(direction) || 0;
		const tileState = this.tileStates[cell];
		for (let layer = 0; layer < tileState.layers.length; layer++) {
			if (this.layerDirections(cell, layer).includes(opposite)) {
				return layer;
			}
		}
		return -1;
	}

	initializeBoard() {
		// create components and fill in connections data;
		// only mutual links are stored, empty cells get neither
		this.tileStates.forEach((state, cell) => {
			for (let layer = 0; layer < state.layers.length; layer++) {
				const subcell = this.grid.subcellId(cell, layer);
				const connections = new Set();
				this.connections.set(subcell, connections);
				for (let direction of this.layerDirections(cell, layer)) {
					const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
					if (empty) {
						state.hasDisconnects[layer] = true;
						continue;
					}
					const backLayer = this.findBackLayer(neighbour, direction);
					if (backLayer === -1) {
						state.hasDisconnects[layer] = true;
						continue;
					}
					connections.add(this.grid.subcellId(neighbour, backLayer));
				}
			}
		});
		// merge initial components of connected layers
		const checked = new Set();
		for (let cell = 0; cell < this.totalCells; cell++) {
			const state = this.tileStates[cell];
			for (let layer = 0; layer < state.layers.length; layer++) {
				const subcell = this.grid.subcellId(cell, layer);
				if (checked.has(subcell)) {
					continue;
				}
				const toCheck = new Set([subcell]);
				const component = {
					color: state.colors[layer],
					subcells: new Set([subcell]),
					openEnds: new Set()
				};
				const connectedThrough = new Map();
				let loop = false;
				while (toCheck.size > 0) {
					const [subcell] = toCheck;
					const [memberCell, memberLayer] = this.grid.cellLayerOf(subcell);
					const tileState = this.tileStates[memberCell];
					toCheck.delete(subcell);
					checked.add(subcell);
					this.components.set(subcell, component);
					component.subcells.add(subcell);
					if (tileState.hasDisconnects[memberLayer]) {
						component.openEnds.add(subcell);
						this.openEnds.add(subcell);
					}
					const connected = this.connections.get(subcell) || new Set();
					for (let neighbourSubcell of connected) {
						const through = connectedThrough.get(neighbourSubcell) || -1;
						if (through === subcell) {
							// seen this connection before
							continue;
						}
						if (through !== -1) {
							// connected to the same component through some other subcell
							loop = true;
							continue;
						}
						toCheck.add(neighbourSubcell);
						connectedThrough.set(neighbourSubcell, subcell);
					}
				}
				if (loop) {
					const loopSubcells = this.detectLoops(component.subcells);
					for (let loopSubcell of loopSubcells) {
						const [loopCell, loopLayer] = this.grid.cellLayerOf(loopSubcell);
						this.tileStates[loopCell].isPartOfLoop[loopLayer] = true;
					}
				}
				if (component.openEnds.size === 0) {
					for (let islandSubcell of component.subcells) {
						const [islandCell, islandLayer] = this.grid.cellLayerOf(islandSubcell);
						this.tileStates[islandCell].isPartOfIsland[islandLayer] = true;
					}
				}
			}
		}
		this.shareDisconnectedSubcells = this.openEnds.size / this.totalSubcells;
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
			tileState.colors = tileState.layers.map(() => 'white');
			tileState.isPartOfIsland = tileState.layers.map(() => false);
			tileState.isPartOfLoop = tileState.layers.map(() => false);
			tileState.hasDisconnects = tileState.layers.map(() => false);
			// edgemarks on outer edges may be 'none'
			// keep that info and discard other edgemarks
			tileState.edgeMarks = tileState.edgeMarks.map((edgemark) => {
				return edgemark === 'none' ? 'none' : 'empty';
			});
		});

		this.initializeBoard();
	}

	/**
	 * Rotate tile a certain number of times, all layers at once
	 * @param {Number} cell
	 * @param {Number} times
	 */
	rotateTile(cell, times) {
		if (this.solved || times === 0) {
			return;
		}
		const tileState = this.tileStates[cell];
		if (tileState === undefined || tileState.locked || tileState.layers.length === 0) {
			return;
		}
		/** @type {{layer: Number, direction: Number}[]} */
		const dirOut = [];
		/** @type {{layer: Number, direction: Number}[]} */
		const dirIn = [];
		const oldDirections = tileState.layers.map((mask, layer) => this.layerDirections(cell, layer));
		tileState.rotate(times);
		tileState.layers.forEach((mask, layer) => {
			const newDirections = this.layerDirections(cell, layer);
			oldDirections[layer].forEach((direction) => {
				if (!newDirections.includes(direction)) {
					dirOut.push({ layer, direction });
				}
			});
			newDirections.forEach((direction) => {
				if (!oldDirections[layer].includes(direction)) {
					dirIn.push({ layer, direction });
				}
			});
		});

		this.handleConnections(cell, dirIn, dirOut);
	}

	/**
	 * Rotate tile to a certain rotation, all layers at once.
	 * The rotation is relative to the tile's base layers (the state
	 * the solver works on), not to the current accumulated rotations
	 * @param {Number} cell
	 * @param {Number} rotation - target rotation count
	 * @param {Boolean} [animate=false] - do a full turn if already at target
	 */
	setTileRotation(cell, rotation, animate = false) {
		const tileState = this.tileStates[cell];
		if (tileState === undefined || tileState.layers.length === 0) {
			return;
		}
		const numDirections = this.grid.polygon_at(cell).num_directions;
		const current = ((tileState.rotations % numDirections) + numDirections) % numDirections;
		let delta = (rotation - current) % numDirections;
		if (delta < 0) {
			delta += numDirections;
		}
		if (delta !== 0 || animate) {
			this.toggleLocked(cell, false);
			this.rotateTile(cell, delta === 0 ? numDirections : delta);
		}
	}

	/**
	 * Process cell connecting to dirIn and disconnecting from dirOut
	 * @param {Number} cell
	 * @param {{layer: Number, direction: Number}[]} dirIn
	 * @param {{layer: Number, direction: Number}[]} dirOut
	 * @returns {void}
	 */
	handleConnections(cell, dirIn, dirOut) {
		/** @type {Set<Number>} - layers of the cell whose new directions
		 * didn't all end up in mutual connections */
		const disconnectedLayers = new Set();
		dirOut.forEach(({ layer, direction }) => {
			const subcell = this.grid.subcellId(cell, layer);
			const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
			if (empty) {
				return;
			}
			const backLayer = this.findBackLayer(neighbour, direction);
			if (backLayer === -1) {
				// this connection wasn't mutual, nothing is stored
				return;
			}
			const neighbourSubcell = this.grid.subcellId(neighbour, backLayer);
			this.connections.get(subcell)?.delete(neighbourSubcell);
			this.connections.get(neighbourSubcell)?.delete(subcell);
			this.disconnectComponents(subcell, neighbourSubcell);
			this.setTileDisconnects(cell, layer, true);
			this.setTileDisconnects(neighbour, backLayer, true);
		});
		dirIn.forEach(({ layer, direction }) => {
			const subcell = this.grid.subcellId(cell, layer);
			const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
			if (empty) {
				disconnectedLayers.add(layer);
				return;
			}
			const backLayer = this.findBackLayer(neighbour, direction);
			if (backLayer === -1) {
				// non-mutual link shouldn't lead to merging
				disconnectedLayers.add(layer);
				return;
			}
			const neighbourSubcell = this.grid.subcellId(neighbour, backLayer);
			this.connections.get(subcell)?.add(neighbourSubcell);
			this.connections.get(neighbourSubcell)?.add(subcell);
			this.mergeComponents(subcell, neighbourSubcell);
			this.setTileDisconnects(neighbour, backLayer);
		});
		// a dirIn that didn't land mutual is a known disconnect,
		// the other layers of the cell recompute
		for (let layer = 0; layer < this.tileStates[cell].layers.length; layer++) {
			if (disconnectedLayers.has(layer)) {
				this.setTileDisconnects(cell, layer, true);
			} else {
				this.setTileDisconnects(cell, layer);
			}
		}
		if (this.initialized) {
			this.solved = this.isSolved();
		}
	}

	/**
	 * Recomputes if a layer of a cell has any direction
	 * that doesn't end up in a mutual connection
	 * @param {Number} cell
	 * @param {Number} layer
	 */
	computeLayerDisconnects(cell, layer) {
		for (let direction of this.layerDirections(cell, layer)) {
			const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
			if (empty) {
				return true;
			}
			if (this.findBackLayer(neighbour, direction) === -1) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Sets or recomputes if a layer of a cell has any direction
	 * that doesn't end up in a mutual connection
	 * @param {Number} cell
	 * @param {Number} layer
	 * @param {Boolean} [forced=false] - pass true when a disconnect
	 * is already known, omit to recompute
	 */
	setTileDisconnects(cell, layer, forced = false) {
		const hasDisconnects = forced || this.computeLayerDisconnects(cell, layer);
		const subcell = this.grid.subcellId(cell, layer);
		this.tileStates[cell].hasDisconnects[layer] = hasDisconnects;
		const component = this.components.get(subcell);
		if (component === undefined) {
			throw `Component open ends data for subcell ${subcell} not found`;
		}
		if (hasDisconnects) {
			if (component.openEnds.size === 0) {
				for (let memberSubcell of component.subcells) {
					const [memberCell, memberLayer] = this.grid.cellLayerOf(memberSubcell);
					this.tileStates[memberCell].isPartOfIsland[memberLayer] = false;
				}
			}
			component.openEnds.add(subcell);
			this.openEnds.add(subcell);
		} else {
			component.openEnds.delete(subcell);
			this.openEnds.delete(subcell);
			if (component.openEnds.size === 0 && component.subcells.size < this.totalSubcells) {
				for (let memberSubcell of component.subcells) {
					const [memberCell, memberLayer] = this.grid.cellLayerOf(memberSubcell);
					this.tileStates[memberCell].isPartOfIsland[memberLayer] = true;
				}
			}
		}
		this.shareDisconnectedSubcells = this.openEnds.size / this.totalSubcells;
	}

	/**
	 * @returns {boolean}
	 */
	isSolved() {
		if (this.openEnds.size > 0) {
			// some layers have disconnects
			return false;
		}
		const component = this.components.get(this.firstValidSubcell);
		if (component === undefined) {
			return false;
		}
		if (component.subcells.size < this.totalSubcells) {
			// not everything connected yet
			return false;
		}
		let toCheck = new Set([{ fromSubcell: -1, subcell: this.firstValidSubcell }]);
		/** @type Set<Number> */
		const checked = new Set([]);
		while (toCheck.size > 0) {
			/** @type {Set<{fromSubcell: Number, subcell: Number}>} */
			const newChecks = new Set([]);
			for (let { fromSubcell, subcell } of toCheck) {
				const neighbourSubcells = this.connections.get(subcell);
				if (neighbourSubcells === undefined) {
					throw `Could not find connections data for subcell ${subcell}`;
				}
				for (let neighbourSubcell of neighbourSubcells) {
					if (neighbourSubcell !== fromSubcell) {
						if (checked.has(neighbourSubcell)) {
							// it's a loop
							return false;
						} else {
							newChecks.add({ fromSubcell: subcell, subcell: neighbourSubcell });
						}
					}
				}
				checked.add(subcell);
			}
			toCheck = newChecks;
		}
		if (checked.size < this.totalSubcells) {
			// it's an island
			return false;
		}
		return true;
	}

	/**
	 * @param {Number} fromSubcell
	 * @param {Number} toSubcell
	 * @returns {void}
	 */
	mergeComponents(fromSubcell, toSubcell) {
		const fromComponent = this.components.get(fromSubcell);
		const toComponent = this.components.get(toSubcell);
		// makes jsdoc stop complaining about
		// "object is possibly undefined"
		if (fromComponent === undefined || toComponent === undefined) {
			return;
		}
		if (fromComponent === toComponent) {
			// its a loop
			const loopSubcells = this.detectLoops(fromComponent.subcells);
			for (let subcell of fromComponent.subcells) {
				const [cell, layer] = this.grid.cellLayerOf(subcell);
				this.tileStates[cell].isPartOfLoop[layer] = loopSubcells.has(subcell);
			}
			return;
		}
		const fromIsBigger = fromComponent.subcells.size >= toComponent.subcells.size;
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
				constantComponent.subcells.forEach((subcell) => {
					const [cell, layer] = this.grid.cellLayerOf(subcell);
					this.tileStates[cell].colors[layer] = newColor;
				});
			}
			constantComponent.color = newColor;
		}
		for (let changedSubcell of changedComponent.subcells) {
			this.components.set(changedSubcell, constantComponent);
			constantComponent.subcells.add(changedSubcell);
			const [changedCell, changedLayer] = this.grid.cellLayerOf(changedSubcell);
			this.tileStates[changedCell].colors[changedLayer] = constantComponent.color;
		}
		for (let changedSubcell of changedComponent.openEnds) {
			constantComponent.openEnds.add(changedSubcell);
		}
	}

	/**
	 * Toggle tile's locked state, return new state
	 * @param {Number} cell
	 * @param {boolean|undefined} [state]
	 * @param {boolean} [assistant=false]
	 * @returns {boolean} - new locked value
	 */
	toggleLocked(cell, state = undefined, assistant = false) {
		const tileState = this.tileStates[cell];
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
			for (let direction of this.grid.polygon_at(cell).directions) {
				const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
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
	 * @param {Number} cell
	 * @param {Number} direction
	 * @param {Boolean} assistant
	 */
	toggleEdgeMark(mark, cell, direction, assistant = false) {
		const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
		if (empty) {
			// no edgemarks on outer borders
			return;
		}
		const index = this.grid.EDGEMARK_DIRECTIONS.indexOf(direction);
		if (index === -1) {
			// toggle mark on the neighbour instead
			const opposite = this.grid.OPPOSITE.get(direction);
			if (!empty && opposite) {
				this.toggleEdgeMark(mark, neighbour, opposite, assistant);
			}
			return;
		}
		const tileState = this.tileStates[cell];
		if (tileState.edgeMarks[index] === mark) {
			tileState.edgeMarks[index] = 'empty';
		} else if (tileState.edgeMarks[index] !== 'none') {
			tileState.edgeMarks[index] = mark;
		}
		if (tileState.edgeMarks[index] !== 'empty' && assistant) {
			this.rotateToMatchMarks(cell);
			this.rotateToMatchMarks(neighbour);
		}
	}

	/**
	 * Rotate a cell so that it fits existing edgemarks and locked cells
	 * All layers must fit at the same time
	 * @param {number} cell
	 */
	rotateToMatchMarks(cell) {
		const tileState = this.tileStates[cell];
		if (tileState.locked) {
			return;
		}
		let walls = 0;
		let connections = 0;
		const polygon = this.grid.polygon_at(cell);
		for (let direction of polygon.directions) {
			const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
			if (empty) {
				walls += direction;
				continue;
			}
			if (this.tileStates[neighbour].locked) {
				// one-sided check: does the locked neighbour point at this cell?
				if (this.findBackLayer(neighbour, direction) !== -1) {
					connections += direction;
				} else {
					walls += direction;
				}
				continue;
			}
			const index = this.grid.EDGEMARK_DIRECTIONS.indexOf(direction);
			/** @type {EdgeMark} */
			let mark = 'empty';
			if (index === -1) {
				// neighbour state has info about this mark
				const opposite = this.grid.OPPOSITE.get(direction) || 0;
				const oppositeIndex = this.grid.EDGEMARK_DIRECTIONS.indexOf(opposite);
				mark = this.tileStates[neighbour].edgeMarks[oppositeIndex];
			} else {
				mark = tileState.edgeMarks[index];
			}
			if (mark === 'conn') {
				connections += direction;
			} else if (mark === 'wall') {
				walls += direction;
			}
		}
		// merge all layers to check if walls/connections fit
		const tile = tileState.tile;
		for (let r = 0; r < polygon.directions.length; r++) {
			const rotations = tileState.rotations + r;
			const rotated = polygon.rotate(tile, rotations);
			if ((rotated & connections) === connections && (rotated & walls) === 0) {
				this.rotateTile(cell, r);
				break;
			}
		}
	}

	/**
	 * @param {Number} fromSubcell
	 * @param {Number} toSubcell
	 * @returns {void}
	 */
	disconnectComponents(fromSubcell, toSubcell) {
		const bigComponent = this.components.get(fromSubcell);
		const toComponent = this.components.get(toSubcell);
		if (bigComponent === undefined || toComponent === undefined || bigComponent !== toComponent) {
			throw `disconnectComponents called for already disconnected subcells ${fromSubcell}, ${toSubcell}`;
		}
		const fromSubcells = this.findConnectedSubcells(toSubcell, fromSubcell);
		const toSubcells = this.findConnectedSubcells(fromSubcell, toSubcell);
		if ([...fromSubcells].some((subcell) => toSubcells.has(subcell))) {
			// it was a loop or maybe it still is
			const loopSubcells = this.detectLoops(bigComponent.subcells);
			for (let subcell of bigComponent.subcells) {
				const [cell, layer] = this.grid.cellLayerOf(subcell);
				this.tileStates[cell].isPartOfLoop[layer] = loopSubcells.has(subcell);
			}
			return;
		}
		const fromIsBigger = fromSubcells.size >= toSubcells.size;
		const changeSubcells = fromIsBigger ? toSubcells : fromSubcells;
		const newComponent = {
			color: randomColor({ luminosity: 'light' }),
			subcells: changeSubcells,
			/** @type {Set<Number>}*/
			openEnds: new Set([])
		};

		for (let subcell of changeSubcells) {
			this.components.set(subcell, newComponent);
			bigComponent.subcells.delete(subcell);
			if (bigComponent.openEnds.delete(subcell)) {
				newComponent.openEnds.add(subcell);
			}
			const [cell, layer] = this.grid.cellLayerOf(subcell);
			this.tileStates[cell].colors[layer] = newComponent.color;
		}
	}

	/**
	 * @param {Set<Number>} subcells - set of subcells
	 * @returns {Set<Number>}
	 */
	detectLoops(subcells) {
		/**
		 * @type {Map<Number, Set<Number>>}
		 */
		const myConnections = new Map();
		let toPrune = new Set();
		for (let subcell of subcells) {
			const subcellConnections = this.connections.get(subcell);
			if (subcellConnections === undefined) {
				throw `Could not find connections data for subcell ${subcell}`;
			}
			// keep only connections that are part of this component
			const inComponent = new Set([...subcellConnections].filter((x) => subcells.has(x)));
			myConnections.set(subcell, inComponent);
			if (inComponent.size === 1) {
				toPrune.add(subcell);
			}
		}

		/**
		 * Prune deadend subcell to exclude it from loop highlighting
		 * @param {Number} subcell
		 * @returns {Set<Number>}
		 */
		function pruneSubcell(subcell) {
			const neighbourSubcells = myConnections.get(subcell);
			if (neighbourSubcells === undefined) {
				throw `Could not find connections data for subcell ${subcell}`;
			}
			if (neighbourSubcells.size <= 1) {
				myConnections.delete(subcell);
				neighbourSubcells.forEach((neighbourSubcell) => {
					const neighbourConnections = myConnections.get(neighbourSubcell);
					if (neighbourConnections === undefined) {
						throw `Could not find connections data for subcell ${neighbourSubcell}`;
					}
					neighbourConnections.delete(subcell);
				});
				return neighbourSubcells;
			}
			return new Set();
		}

		function pruneDeadEnds() {
			while (toPrune.size > 0) {
				const [subcell] = toPrune;
				toPrune.delete(subcell);
				const changedNeighbours = pruneSubcell(subcell);
				changedNeighbours.forEach((n) => toPrune.add(n));
			}
		}

		pruneDeadEnds();

		// at this point we have all the loops but maybe also
		// some bridges between loops
		// need to prune them too
		const inLoops = new Set();

		/**
		 * Tries to find a path from one subcell through another
		 * and back to it
		 * @param {Number} fromSubcell
		 * @param {Number} throughSubcell
		 * @returns {Number[]} - subcells that make a looping path.
		 * Empty array if there is no such path.
		 */
		function traceLoopPath(fromSubcell, throughSubcell) {
			let paths = [[fromSubcell, throughSubcell]];
			while (paths.length > 0) {
				const path = paths.pop();
				if (path === undefined || path.length === 0) {
					throw 'Wrong path encountered while tracing loops';
				}
				const lastSubcell = path[path.length - 1];
				const neighbourSubcells = myConnections.get(lastSubcell);
				if (neighbourSubcells === undefined) {
					throw `Could not find connections data for subcell ${lastSubcell}`;
				}
				for (let neighbourSubcell of neighbourSubcells) {
					if (neighbourSubcell === fromSubcell) {
						if (path.length > 2) {
							// successful loop
							return path;
						} else {
							continue;
						}
					}
					if (path.slice(1).some((x) => x === neighbourSubcell)) {
						// already been here
						continue;
					}
					paths.push([...path, neighbourSubcell]);
				}
			}
			return [];
		}
		while (inLoops.size < myConnections.size) {
			let subcellToCheck = -1;
			for (let subcell of myConnections.keys()) {
				if (!inLoops.has(subcell)) {
					subcellToCheck = subcell;
					break;
				}
			}
			const neighbourSubcells = myConnections.get(subcellToCheck);
			if (neighbourSubcells === undefined) {
				throw `Could not find connections data for subcell ${subcellToCheck}`;
			}
			const [neighbourSubcell] = neighbourSubcells;
			const loop = traceLoopPath(subcellToCheck, neighbourSubcell);
			if (loop.length === 0) {
				// no loop found
				neighbourSubcells.delete(neighbourSubcell);
				const neighbourConnections = myConnections.get(neighbourSubcell);
				if (neighbourConnections === undefined) {
					throw `Could not find connections data for subcell ${neighbourSubcell}`;
				}
				neighbourConnections.delete(subcellToCheck);
				toPrune.add(neighbourSubcell).add(subcellToCheck);
				pruneDeadEnds();
			} else {
				loop.forEach((i) => inLoops.add(i));
			}
		}
		return inLoops;
	}

	/**
	 * Find subcells that are connected to subcell toSubcell
	 * Excluding connections through subcell fromSubcell
	 * Used when the player breaks up connected components
	 * @param {Number} fromSubcell
	 * @param {Number} toSubcell
	 * @returns {Set<Number>}
	 */
	findConnectedSubcells(fromSubcell, toSubcell) {
		const myComponent = this.components.get(toSubcell);
		if (myComponent === undefined) {
			throw `Could not find component for subcell ${toSubcell}`;
		}
		let subcellsToCheck = new Set([{ fromSubcell: fromSubcell, subcell: toSubcell }]);
		/** @type {Set<Number>} */
		const checked = new Set([]);
		while (subcellsToCheck.size > 0) {
			/** @type {Set<{fromSubcell: Number, subcell: Number}>} */
			const newChecks = new Set([]);
			for (let { fromSubcell, subcell } of subcellsToCheck) {
				const neighbourSubcells = this.connections.get(subcell);
				if (neighbourSubcells === undefined) {
					throw `Could not find connections data for subcell ${subcell}`;
				}
				for (let neighbourSubcell of neighbourSubcells) {
					const neighbourComponent = this.components.get(neighbourSubcell);
					if (neighbourComponent === undefined) {
						throw `Could not find component for subcell ${neighbourSubcell}`;
					}
					if (neighbourComponent !== myComponent) {
						// not from this component, will be handled during merge phase
						continue;
					}
					if (neighbourSubcell === fromSubcell) {
						// came from here
						continue;
					}
					if (checked.has(neighbourSubcell)) {
						continue;
					}
					newChecks.add({ fromSubcell: subcell, subcell: neighbourSubcell });
				}
				checked.add(subcell);
			}
			subcellsToCheck = newChecks;
		}
		return checked;
	}
}
