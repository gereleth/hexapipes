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
 * @typedef {Object} SavedLayeredTileState
 * @property {Number} rotations
 * @property {String[]} colors
 * @property {Boolean} locked
 * @property {EdgeMark[]} edgeMarks
 */

/**
 * Saved progress for layered pipes puzzle
 * @typedef {Object} LayeredProgress
 * @property {SavedLayeredTileState[]} tiles
 */

/**
 * A component is a group of connected layers
 * @typedef {Object} LayeredComponent
 * @property {Set<Number>} tiles - set of sub-cell ids of included layers
 * @property {Set<Number>} openEnds - set of sub-cell ids of layers that have disconnects
 * @property {String} color
 */

/**
 * State for a single grid cell
 */
class LayeredTileState {
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
 * Game state for layered pipes puzzle
 * Layers of a cell are independent pipes that never connect to each other,
 * a rotation turns all layers of a cell simultaneously.
 * Everything is keyed by sub-cell id = cell index + layer number * grid.total
 */
export class LayeredPipesGame {
	solved = $state(false);
	/**
	 * sub-cell id => set of sub-cell ids that it mutually connects to
	 * @type {Map<Number, Set<Number>>} */
	connections = new Map();
	/**
	 * @type {LayeredTileState[]}
	 */
	tileStates = [];
	/**
	 * sub-cell id => component that it belongs to
	 * @type {Map<Number, LayeredComponent>} - a map of sub-cell id =>
	 * component that it belongs to
	 */
	components = new Map();
	/**
	 * @type {Set<Number>} - set of sub-cell ids of layers with disconnects
	 */
	openEnds = new Set();
	shareDisconnectedTiles = $state(1);
	disconnectStrokeWidthScale = $derived.by(() => {
		if (this.shareDisconnectedTiles > 0.1) {
			return 1;
		} else {
			const amount = 1 - this.shareDisconnectedTiles * 10;
			return 1 + 0.4 * amount;
		}
	});
	disconnectStrokeColor = $derived.by(() => {
		if (this.shareDisconnectedTiles > 0.1) {
			return '#888888';
		} else {
			const amount = 1 - this.shareDisconnectedTiles * 10;
			const color = Math.round(136 - 34 * amount).toString(16);
			return '#' + color + color + color;
		}
	});
	initialized = false;

	/**
	 * @constructor
	 * @param {import('$lib/puzzle/grids/abstractgrid').AbstractGrid} grid
	 * @param {LayeredTiles} tiles
	 * @param {LayeredProgress|undefined} savedProgress
	 */
	constructor(grid, tiles, savedProgress) {
		this.grid = grid;
		this.tiles = tiles;
		this.total = grid.total;
		this.viewBox = createViewBox(grid);
		this.totalSubCells = tiles.reduce((sum, cellLayers) => sum + cellLayers.length, 0);
		if (savedProgress) {
			this.tileStates = tiles.map((cellLayers, index) => {
				const savedTile = savedProgress.tiles[index];
				return new LayeredTileState({
					layers: cellLayers,
					rotations: savedTile.rotations,
					colors: savedTile.colors || cellLayers.map(() => 'white'),
					locked: savedTile.locked,
					edgeMarks: savedTile.edgeMarks
				});
			});
		} else {
			this.tileStates = tiles.map((cellLayers, index) => {
				// disable edge marks on outer edges of non-wrap puzzles
				const edgeMarks = /** @type {EdgeMark[]} */ (
					this.grid.EDGEMARK_DIRECTIONS.map(() => 'empty')
				);
				if (!this.grid.wrap) {
					this.grid.EDGEMARK_DIRECTIONS.forEach((direction, direction_index) => {
						const { empty } = this.grid.find_neighbour(index, direction);
						if (empty) {
							edgeMarks[direction_index] = 'none';
						}
					});
				}
				return new LayeredTileState({
					layers: cellLayers,
					rotations: 0,
					colors: cellLayers.map(() => 'white'),
					locked: false,
					edgeMarks
				});
			});
		}
		this.firstValidIndex = 0;
		while (this.grid.emptyCells.has(this.firstValidIndex)) {
			this.firstValidIndex += 1;
		}
		this.firstValidId = this.idOf(this.firstValidIndex, 0);

		this.initializeBoard();
	}

	/**
	 * Sub-cell id for a layer of a cell
	 * @param {Number} cell
	 * @param {Number} layer
	 * @returns {Number}
	 */
	idOf(cell, layer) {
		return cell + layer * this.total;
	}

	/**
	 * Grid cell index of a sub-cell id
	 * @param {Number} id
	 * @returns {Number}
	 */
	cellOf(id) {
		return id % this.total;
	}

	/**
	 * Layer number of a sub-cell id
	 * @param {Number} id
	 * @returns {Number}
	 */
	layerOf(id) {
		return Math.floor(id / this.total);
	}

	/**
	 * Tells if the sub-cell id points to an actual layer of a non-empty cell
	 * @param {Number} id
	 * @returns {Boolean}
	 */
	isValidId(id) {
		const cellLayers = this.tileStates[this.cellOf(id)]?.layers;
		return cellLayers !== undefined && this.layerOf(id) < cellLayers.length;
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

	/**
	 * Tells if layers of two cells have a mutual connection
	 * @param {Number} cellA
	 * @param {Number} cellB
	 * @returns {Boolean}
	 */
	areCellsConnected(cellA, cellB) {
		const layersA = this.tileStates[cellA].layers.length;
		const layersB = this.tileStates[cellB].layers.length;
		for (let layerA = 0; layerA < layersA; layerA++) {
			const connections = this.connections.get(this.idOf(cellA, layerA));
			for (let layerB = 0; layerB < layersB; layerB++) {
				if (connections?.has(this.idOf(cellB, layerB))) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Tells if any layer of a cell has disconnects
	 * @param {Number} cell
	 * @returns {Boolean}
	 */
	cellHasDisconnects(cell) {
		return this.tileStates[cell].hasDisconnects.some((x) => x);
	}

	/**
	 * Tells if any layer of a cell is part of a loop
	 * @param {Number} cell
	 * @returns {Boolean}
	 */
	cellIsPartOfLoop(cell) {
		return this.tileStates[cell].isPartOfLoop.some((x) => x);
	}

	/**
	 * Tells if any layer of a cell is part of an island
	 * @param {Number} cell
	 * @returns {Boolean}
	 */
	cellIsPartOfIsland(cell) {
		return this.tileStates[cell].isPartOfIsland.some((x) => x);
	}

	initializeBoard() {
		// create components and fill in connections data
		this.tileStates.forEach((state, cell) => {
			for (let layer = 0; layer < state.layers.length; layer++) {
				const id = this.idOf(cell, layer);
				const connections = new Set();
				this.connections.set(id, connections);
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
					connections.add(this.idOf(neighbour, backLayer));
				}
			}
		});
		// merge initial components of connected layers
		const checked = new Set();
		let i = 0;
		while (checked.size < this.totalSubCells) {
			while (!this.isValidId(i) || checked.has(i)) {
				i += 1;
			}
			const toCheck = new Set([i]);
			const cell = this.cellOf(i);
			const layer = this.layerOf(i);
			const component = {
				color: this.tileStates[cell].colors[layer],
				tiles: new Set([i]),
				openEnds: new Set()
			};
			const connectedThrough = new Map();
			let loop = false;
			while (toCheck.size > 0) {
				const [index] = toCheck;
				const tileCell = this.cellOf(index);
				const tileLayer = this.layerOf(index);
				const tileState = this.tileStates[tileCell];
				toCheck.delete(index);
				checked.add(index);
				this.components.set(index, component);
				component.tiles.add(index);
				if (tileState.hasDisconnects[tileLayer]) {
					component.openEnds.add(index);
					this.openEnds.add(index);
				}
				const connected = this.connections.get(index) || new Set();
				for (let neighbour of connected) {
					const through = connectedThrough.get(neighbour) || -1;
					if (through === index) {
						// seen this connection before
						continue;
					}
					if (through !== -1) {
						// connected to the same component through some other layer
						loop = true;
						continue;
					}
					toCheck.add(neighbour);
					connectedThrough.set(neighbour, index);
				}
			}
			if (loop) {
				const loopTiles = this.detectLoops(component.tiles);
				for (let loopTile of loopTiles) {
					this.tileStates[this.cellOf(loopTile)].isPartOfLoop[this.layerOf(loopTile)] = true;
				}
			}
			if (component.openEnds.size === 0) {
				for (let islandTile of component.tiles) {
					this.tileStates[this.cellOf(islandTile)].isPartOfIsland[this.layerOf(islandTile)] = true;
				}
			}
		}
		this.shareDisconnectedTiles = this.openEnds.size / this.totalSubCells;
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
		const oldDirections = tileState.layers.map((layer, index) => this.layerDirections(cell, index));
		tileState.rotate(times);
		tileState.layers.forEach((layer, index) => {
			const newDirections = this.layerDirections(cell, index);
			oldDirections[index].forEach((direction) => {
				if (!newDirections.includes(direction)) {
					dirOut.push({ layer: index, direction });
				}
			});
			newDirections.forEach((direction) => {
				if (!oldDirections[index].includes(direction)) {
					dirIn.push({ layer: index, direction });
				}
			});
		});

		this.handleConnections(cell, dirIn, dirOut);
	}

	/**
	 *
	 * @param {Number} cell
	 * @param {{layer: Number, direction: Number}[]} dirIn
	 * @param {{layer: Number, direction: Number}[]} dirOut
	 * @returns {void}
	 */
	handleConnections(cell, dirIn, dirOut) {
		dirOut.forEach(({ layer, direction }) => {
			const id = this.idOf(cell, layer);
			const tileConnections = this.connections.get(id);
			if (tileConnections === undefined) {
				throw `Could not find connections data for tile ${id}`;
			}
			const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
			if (empty) {
				return;
			}
			const backLayer = this.findBackLayer(neighbour, direction);
			if (backLayer === -1) {
				// this connection wasn't mutual, nothing is stored
				return;
			}
			const neighbourId = this.idOf(neighbour, backLayer);
			tileConnections.delete(neighbourId);
			const neighbourConnections = this.connections.get(neighbourId);
			if (neighbourConnections === undefined) {
				throw `Could not find connections data for tile ${neighbourId}`;
			}
			neighbourConnections.delete(id);
			const tileComponent = this.components.get(id);
			const neighbourComponent = this.components.get(neighbourId);
			if (tileComponent === neighbourComponent) {
				this.disconnectComponents(id, neighbourId);
			}
			this.setTileDisconnects(cell, layer, true);
			this.setTileDisconnects(neighbour, backLayer, true);
		});
		dirIn.forEach(({ layer, direction }) => {
			const id = this.idOf(cell, layer);
			const tileConnections = this.connections.get(id);
			if (tileConnections === undefined) {
				throw `Could not find connections data for tile ${id}`;
			}
			const { neighbour, empty } = this.grid.find_neighbour(cell, direction);
			if (empty) {
				this.setTileDisconnects(cell, layer, true);
				return;
			}
			const backLayer = this.findBackLayer(neighbour, direction);
			if (backLayer === -1) {
				// non-mutual link shouldn't lead to merging
				this.setTileDisconnects(cell, layer, true);
				return;
			}
			const neighbourId = this.idOf(neighbour, backLayer);
			if (tileConnections.has(neighbourId)) {
				// already connected
				return;
			}
			tileConnections.add(neighbourId);
			const neighbourConnections = this.connections.get(neighbourId);
			if (neighbourConnections === undefined) {
				throw `Could not find connections data for tile ${neighbourId}`;
			}
			neighbourConnections.add(id);
			this.mergeComponents(id, neighbourId);
			this.setTileDisconnects(neighbour, backLayer);
		});
		// recompute disconnect state of all layers of the rotated cell
		for (let layer = 0; layer < this.tileStates[cell].layers.length; layer++) {
			this.setTileDisconnects(cell, layer);
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
	 *
	 * @param {Number} cell
	 * @param {Number} layer
	 * @param {Boolean|undefined} [hasDisconnects]
	 */
	setTileDisconnects(cell, layer, hasDisconnects = undefined) {
		let newHasDisconnects = hasDisconnects || false;
		if (hasDisconnects === undefined) {
			newHasDisconnects = this.computeLayerDisconnects(cell, layer);
		}
		const id = this.idOf(cell, layer);
		this.tileStates[cell].hasDisconnects[layer] = newHasDisconnects;
		const component = this.components.get(id);
		if (component === undefined) {
			throw `Component open ends data for tile ${id} not found`;
		}
		if (newHasDisconnects) {
			if (component.openEnds.size === 0) {
				for (let index of component.tiles) {
					this.tileStates[this.cellOf(index)].isPartOfIsland[this.layerOf(index)] = false;
				}
			}
			component.openEnds.add(id);
			this.openEnds.add(id);
		} else {
			component.openEnds.delete(id);
			this.openEnds.delete(id);
			if (component.openEnds.size === 0 && component.tiles.size < this.totalSubCells) {
				for (let index of component.tiles) {
					this.tileStates[this.cellOf(index)].isPartOfIsland[this.layerOf(index)] = true;
				}
			}
		}
		this.shareDisconnectedTiles = this.openEnds.size / this.totalSubCells;
	}

	/**
	 * @returns {boolean}
	 */
	isSolved() {
		if (this.openEnds.size > 0) {
			// some layers have disconnects
			return false;
		}
		const component = this.components.get(this.firstValidId);
		if (component === undefined) {
			return false;
		}
		if (component.tiles.size < this.totalSubCells) {
			// not everything connected yet
			return false;
		}
		let toCheck = new Set([{ fromIndex: -1, tileIndex: this.firstValidId }]);
		/** @type Set<Number> */
		const checked = new Set([]);
		while (toCheck.size > 0) {
			/** @type {Set<{fromIndex: Number, tileIndex: Number}>} */
			const newChecks = new Set([]);
			for (let { fromIndex, tileIndex } of toCheck) {
				const neighbours = this.connections.get(tileIndex);
				if (neighbours === undefined) {
					throw `Could not find connections data for tile ${tileIndex}`;
				}
				for (let neighbour of neighbours) {
					if (neighbour !== fromIndex) {
						if (checked.has(neighbour)) {
							// it's a loop
							return false;
						} else {
							newChecks.add({ fromIndex: tileIndex, tileIndex: neighbour });
						}
					}
				}
				checked.add(tileIndex);
			}
			toCheck = newChecks;
		}
		if (checked.size < this.totalSubCells) {
			// it's an island
			return false;
		}
		return true;
	}

	/**
	 * @param {Number} fromId
	 * @param {Number} toId
	 * @returns {void}
	 */
	mergeComponents(fromId, toId) {
		const fromComponent = this.components.get(fromId);
		const toComponent = this.components.get(toId);
		// makes jsdoc stop complaining about
		// "object is possibly undefined"
		if (fromComponent === undefined || toComponent === undefined) {
			return;
		}
		if (fromComponent === toComponent) {
			// its a loop
			const loopTiles = this.detectLoops(fromComponent.tiles);
			for (let tile of fromComponent.tiles) {
				this.tileStates[this.cellOf(tile)].isPartOfLoop[this.layerOf(tile)] = loopTiles.has(tile);
			}
			return;
		}
		const fromIsBigger = fromComponent.tiles.size >= toComponent.tiles.size;
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
				constantComponent.tiles.forEach((tile) => {
					this.tileStates[this.cellOf(tile)].colors[this.layerOf(tile)] = newColor;
				});
			}
			constantComponent.color = newColor;
		}
		for (let changedTile of changedComponent.tiles) {
			this.components.set(changedTile, constantComponent);
			constantComponent.tiles.add(changedTile);
			this.tileStates[this.cellOf(changedTile)].colors[this.layerOf(changedTile)] =
				constantComponent.color;
		}
		for (let changedTile of changedComponent.openEnds) {
			constantComponent.openEnds.add(changedTile);
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
				if (this.areCellsConnected(cell, neighbour)) {
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
		for (let r = 0; r < polygon.directions.length; r++) {
			const rotations = tileState.rotations + r;
			let union = 0;
			let fitsWalls = true;
			for (let layer = 0; layer < tileState.layers.length; layer++) {
				const rotated = polygon.rotate(tileState.layers[layer], rotations);
				if ((rotated & walls) > 0) {
					fitsWalls = false;
					break;
				}
				union |= rotated;
			}
			if (fitsWalls && (union & connections) === connections) {
				this.rotateTile(cell, r);
				break;
			}
		}
	}

	/**
	 * @param {Number} fromId
	 * @param {Number} toId
	 * @returns {void}
	 */
	disconnectComponents(fromId, toId) {
		const bigComponent = this.components.get(fromId);
		if (bigComponent === undefined) {
			return;
		} // this shouldn't really happen, jsdoc
		const fromTiles = this.findConnectedTiles(toId, fromId);
		const toTiles = this.findConnectedTiles(fromId, toId);
		if ([...fromTiles].some((tile) => toTiles.has(tile))) {
			// it was a loop or maybe it still is
			const loopTiles = this.detectLoops(bigComponent.tiles);
			for (let tile of bigComponent.tiles) {
				this.tileStates[this.cellOf(tile)].isPartOfLoop[this.layerOf(tile)] = loopTiles.has(tile);
			}
			return;
		}
		const fromIsBigger = fromTiles.size >= toTiles.size;
		const changeTiles = fromIsBigger ? toTiles : fromTiles;
		const newComponent = {
			color: randomColor({ luminosity: 'light' }),
			tiles: changeTiles,
			/** @type {Set<Number>}*/
			openEnds: new Set([])
		};

		for (let tileIndex of changeTiles) {
			this.components.set(tileIndex, newComponent);
			bigComponent.tiles.delete(tileIndex);
			if (bigComponent.openEnds.delete(tileIndex)) {
				newComponent.openEnds.add(tileIndex);
			}
			this.tileStates[this.cellOf(tileIndex)].colors[this.layerOf(tileIndex)] = newComponent.color;
		}
	}

	/**
	 * @param {Set<Number>} tilesSet - set of sub-cell ids
	 * @returns {Set<Number>}
	 */
	detectLoops(tilesSet) {
		/**
		 * @type {Map<Number, Set<Number>>}
		 */
		const myConnections = new Map();
		let toPrune = new Set();
		for (let tile of tilesSet) {
			const tileConnections = this.connections.get(tile);
			if (tileConnections === undefined) {
				throw `Could not find connections data for tile ${tile}`;
			}
			const inComponent = new Set(
				[...tileConnections].filter((x) => {
					// return true for connections that are
					// part of this component
					if (!tilesSet.has(x)) {
						return false;
					}
					return true;
				})
			);
			myConnections.set(tile, inComponent);
			if (inComponent.size === 1) {
				toPrune.add(tile);
			}
		}

		/**
		 * Prune deadend tile to exclude it from loop highlighting
		 * @param {Number} tile
		 * @returns {Set<Number>}
		 */
		function pruneTile(tile) {
			const neighbours = myConnections.get(tile);
			if (neighbours === undefined) {
				throw `Could not find connections data for tile ${tile}`;
			}
			if (neighbours.size <= 1) {
				myConnections.delete(tile);
				neighbours.forEach((neighbour) => {
					const neighbourConn = myConnections.get(neighbour);
					if (neighbourConn === undefined) {
						throw `Could not find connections data for tile ${neighbour}`;
					}
					neighbourConn.delete(tile);
				});
				return neighbours;
			}
			return new Set();
		}

		function pruneDeadEnds() {
			while (toPrune.size > 0) {
				const [tile] = toPrune;
				toPrune.delete(tile);
				const changedNeighbours = pruneTile(tile);
				changedNeighbours.forEach((n) => toPrune.add(n));
			}
		}

		pruneDeadEnds();

		// at this point we have all the loops but maybe also
		// some bridges between loops
		// need to prune them too
		const inLoops = new Set();

		/**
		 * Tries to find a path from one tile through another
		 * and back to it
		 * @param {Number} fromTile
		 * @param {Number} throughTile
		 * @returns {Number[]} - sub-cell ids that make a looping path.
		 * Empty array if there is no such path.
		 */
		function traceLoopPath(fromTile, throughTile) {
			let paths = [[fromTile, throughTile]];
			while (paths.length > 0) {
				const path = paths.pop();
				if (path === undefined || path.length === 0) {
					throw 'Wrong path encountered while tracing loops';
				}
				const lastTile = path[path.length - 1];
				const neighbours = myConnections.get(lastTile);
				if (neighbours === undefined) {
					throw `Could not find connections data for tile ${lastTile}`;
				}
				for (let neighbour of neighbours) {
					if (neighbour === fromTile) {
						if (path.length > 2) {
							// successful loop
							return path;
						} else {
							continue;
						}
					}
					if (path.slice(1).some((x) => x === neighbour)) {
						// already been here
						continue;
					}
					paths.push([...path, neighbour]);
				}
			}
			return [];
		}
		while (inLoops.size < myConnections.size) {
			let tileToCheck = -1;
			for (let tile of myConnections.keys()) {
				if (!inLoops.has(tile)) {
					tileToCheck = tile;
					break;
				}
			}
			const neighbours = myConnections.get(tileToCheck);
			if (neighbours === undefined) {
				throw `Could not find connections data for tile ${tileToCheck}`;
			}
			const [neighbour] = neighbours;
			const loop = traceLoopPath(tileToCheck, neighbour);
			if (loop.length === 0) {
				// no loop found
				neighbours.delete(neighbour);
				const nConn = myConnections.get(neighbour);
				if (nConn === undefined) {
					throw `Could not find connections data for tile ${neighbour}`;
				}
				nConn.delete(tileToCheck);
				toPrune.add(neighbour).add(tileToCheck);
				pruneDeadEnds();
			} else {
				loop.forEach((i) => inLoops.add(i));
			}
		}
		return inLoops;
	}

	/**
	 * Find layers that are connected to layer toId
	 * Excluding connections through layer fromId
	 * Used when the player breaks up connected components
	 * @param {Number} fromId
	 * @param {Number} toId
	 * @returns {Set<Number>}
	 */
	findConnectedTiles(fromId, toId) {
		const myComponent = this.components.get(toId);
		if (myComponent === undefined) {
			throw `Could not find component for tile ${toId}`;
		}
		let tileToCheck = new Set([{ fromIndex: fromId, tileIndex: toId }]);
		/** @type {Set<Number>} */
		const checked = new Set([]);
		while (tileToCheck.size > 0) {
			/** @type {Set<{fromIndex: Number, tileIndex: Number}>} */
			const newChecks = new Set([]);
			for (let { fromIndex, tileIndex } of tileToCheck) {
				const neighbours = this.connections.get(tileIndex);
				if (neighbours === undefined) {
					throw `Could not find connections data for tile ${tileIndex}`;
				}
				for (let neighbour of neighbours) {
					const neighbourComponent = this.components.get(neighbour);
					if (neighbourComponent === undefined) {
						throw `Could not find component for tile ${neighbour}`;
					}
					if (neighbourComponent !== myComponent) {
						// not from this component, will be handled during merge phase
						continue;
					}
					if (neighbour === fromIndex) {
						// came from here
						continue;
					}
					if (checked.has(neighbour)) {
						continue;
					}
					newChecks.add({ fromIndex: tileIndex, tileIndex: neighbour });
				}
				checked.add(tileIndex);
			}
			tileToCheck = newChecks;
		}
		return checked;
	}
}
