import randomColor from 'randomcolor';
import { createViewBox } from './viewbox';

/**
 * An edge mark
 * none means outer border, show nothing at all
 * @typedef {'wall'|'conn'|'empty'|'none'} EdgeMark
 */

/**
 * Saved progress for a single tile
 * @typedef {Object} SavedTileState
 * @property {Number} rotations
 * @property {String} color
 * @property {Boolean} locked
 * @property {EdgeMark[]} edgeMarks
 */

/**
 * State for a single tile
 * @typedef {Object} TileState
 * @property {Number} tile
 * @property {Number} rotations
 * @property {String} color
 * @property {Boolean} locked
 * @property {Boolean} isPartOfLoop
 * @property {Boolean} isPartOfIsland
 * @property {Boolean} hasDisconnects
 * @property {EdgeMark[]} edgeMarks
 */

/**
 * A component is a group of connected tiles
 * @typedef {Object} Component
 * @property {Set<Number>} tiles - set of indices of included tiles
 * @property {Set<Number>} openEnds - set of indices of tiles that have disconnects
 * @property {String} color
 */

/**
 * Saved progress for pipes puzzle
 * @typedef {Object} Progress
 * @property {SavedTileState[]} tiles
 */

class NewTileState {
	/** @type {number} */
	tile;
	color = $state('white');
	locked = $state(false);
	isPartOfLoop = $state(false);
	isPartOfIsland = $state(false);
	hasDisconnects = $state(false);
	rotations = $state(0);
	/** @type {EdgeMark[]} */
	edgeMarks = $state([]);

	/**
	 *
	 * @param {TileState} data
	 */
	constructor(data) {
		this.tile = data.tile;
		this.color = data.color;
		this.locked = data.locked;
		this.isPartOfLoop = data.isPartOfLoop;
		this.isPartOfIsland = data.isPartOfIsland;
		this.hasDisconnects = data.hasDisconnects;
		this.rotations = data.rotations;
		this.edgeMarks = data.edgeMarks;
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

export class PipesGame {
	solved = $state(false);
	/**
	 * tile index => set of neighbours that it points to
	 * @type {Map<Number, Set<Number>>} */
	connections = new Map();
	/**
	 * @type {NewTileState[]}
	 */
	tileStates = [];
	/**
	 * @type {Map<Number, Component>} - a map of tile index =>
	 * component that it belongs to
	 */
	components = new Map();
	/**
	 * @type {Set<Number>} - set of indices of tiles with disconnects
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
	 * @param {import('#lib/puzzle/grids/abstractgrid.js').AbstractGrid} grid
	 * @param {Number[]} tiles
	 * @param {Progress|undefined} savedProgress
	 */
	constructor(grid, tiles, savedProgress) {
		this.grid = grid;
		this.tiles = tiles;
		this.initializes = false;
		this.viewBox = createViewBox(grid);
		this.totalTiles = grid.total - grid.emptyCells.size;

		/**
		 * @type {EdgeMark[]}
		 */
		const defaultEdgeMarks = ['empty', 'empty', 'empty'];
		if (savedProgress) {
			this.tileStates = savedProgress.tiles.map((savedTile, index) => {
				return new NewTileState({
					tile: tiles[index],
					rotations: savedTile.rotations,
					color: savedTile.color,
					isPartOfLoop: false,
					isPartOfIsland: false,
					hasDisconnects: false,
					locked: savedTile.locked,
					edgeMarks: savedTile.edgeMarks || [...defaultEdgeMarks]
				});
			});
		} else {
			this.tileStates = tiles.map((tile, index) => {
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
				return new NewTileState({
					tile: tile,
					rotations: 0,
					color: 'white',
					isPartOfLoop: false,
					isPartOfIsland: false,
					hasDisconnects: false,
					locked: false,
					edgeMarks
				});
			});
		}
		this.firstValidIndex = 0;
		while (this.grid.emptyCells.has(this.firstValidIndex)) {
			this.firstValidIndex += 1;
		}

		this.initializeBoard();
	}

	initializeBoard() {
		// create components and fill in connections data
		this.tileStates.forEach((state, index) => {
			let directions = this.grid.getDirections(state.tile, state.rotations, index);
			const connections = new Set();
			for (let direction of directions) {
				const { neighbour, empty } = this.grid.find_neighbour(index, direction);
				if (!empty) {
					connections.add(neighbour);
				}
			}
			if (connections.size < directions.length) {
				// some connections point outside the grid
				state.hasDisconnects = true;
			}
			this.connections.set(index, connections);
		});
		// merge initial components of connected tiles
		const checked = new Set();
		let i = 0;
		const empty = new Set();
		while (checked.size < this.tileStates.length) {
			const toCheck = new Set([i]);
			const state = this.tileStates[i];
			const component = {
				color: state.color,
				tiles: new Set([i]),
				openEnds: new Set()
			};
			const connectedThrough = new Map();
			let loop = false;
			while (toCheck.size > 0) {
				const [index] = toCheck;
				const tileState = this.tileStates[index];
				toCheck.delete(index);
				checked.add(index);
				this.components.set(index, component);
				component.tiles.add(index);
				if (tileState.hasDisconnects) {
					component.openEnds.add(index);
					this.openEnds.add(index);
				}
				const connected = this.connections.get(index) || empty;
				for (let neighbour of connected) {
					const through = connectedThrough.get(neighbour) || -1;
					if (through === index) {
						// seen this connection before
						continue;
					}
					if ((this.connections.get(neighbour) || empty).has(index)) {
						if (through !== -1) {
							// connected to the same component through some other tile
							loop = true;
							continue;
						}
						toCheck.add(neighbour);
						connectedThrough.set(neighbour, index);
					} else {
						tileState.hasDisconnects = true;
						component.openEnds.add(index);
						this.openEnds.add(index);
					}
				}
			}
			if (loop) {
				const loopTiles = this.detectLoops(component.tiles);
				for (let loopTile of loopTiles) {
					this.tileStates[loopTile].isPartOfLoop = true;
				}
			}
			if (component.openEnds.size === 0) {
				for (let islandTile of component.tiles) {
					this.tileStates[islandTile].isPartOfIsland = true;
				}
			}

			while (checked.has(i)) {
				i += 1;
			}
		}
		this.shareDisconnectedTiles = this.openEnds.size / this.totalTiles;
		this.initialized = true;
	}

	startOver() {
		this.connections.clear();
		this.components.clear();
		this.initialized = false;
		this.solved = false;
		this.openEnds.clear();
		this.disconnectStrokeWidthScale = 1;
		this.disconnectStrokeColor = '#888888';

		this.tileStates.forEach((tileState, index) => {
			tileState.rotations = 0;
			tileState.color = 'white';
			tileState.locked = false;
			tileState.isPartOfIsland = false;
			tileState.isPartOfLoop = false;
			tileState.hasDisconnects = false;
			// edgemarks on outer edges may be 'none'
			// keep that info and discard other edgemarks
			tileState.edgeMarks = tileState.edgeMarks.map((edgemark) => {
				return edgemark === 'none' ? 'none' : 'empty';
			});
		});

		this.initializeBoard();
	}

	/**
	 * Rotate tile a certain number of times
	 * @param {Number} tileIndex
	 * @param {Number} times
	 */
	rotateTile(tileIndex, times) {
		if (this.solved || times === 0) {
			return;
		}
		const tileState = this.tileStates[tileIndex];
		if (tileState === undefined || tileState.locked) {
			return;
		}
		const oldDirections = this.grid.getDirections(tileState.tile, tileState.rotations, tileIndex);
		tileState.rotate(times);
		const newDirections = this.grid.getDirections(tileState.tile, tileState.rotations, tileIndex);

		const dirOut = oldDirections.filter((direction) => !newDirections.some((d) => d === direction));
		const dirIn = newDirections.filter((direction) => !oldDirections.some((d) => d === direction));

		this.handleConnections({
			detail: { tileIndex, dirOut, dirIn }
		});
	}

	/**
	 * Rotate tile to a certain orientation
	 * @param {Number} tileIndex
	 * @param {Number} orientation
	 */
	setTileOrientation(tileIndex, orientation, animate = false) {
		const tileState = this.tileStates[tileIndex];
		const polygon = this.grid.polygon_at(tileIndex);
		if (tileState === undefined) {
			return;
		}
		const initial = this.grid.rotate(this.tiles[tileIndex], tileState.rotations, tileIndex);
		let newState = initial;
		let rotations = 0;
		while (newState !== orientation && rotations < polygon.directions.length) {
			newState = this.grid.rotate(newState, 1, tileIndex);
			rotations += 1;
		}
		if (rotations === polygon.directions.length) {
			throw `No way to rotate tile at ${tileIndex} from ${initial} to ${orientation}`;
		}
		if (rotations !== 0 || animate) {
			this.rotateTile(tileIndex, rotations === 0 ? polygon.directions.length : rotations);
		}
	}

	/**
	 *
	 * @param {EdgeMark} mark
	 * @param {Number} tileIndex
	 * @param {Number} direction
	 * @param {Boolean} assistant
	 */
	toggleEdgeMark(mark, tileIndex, direction, assistant = false) {
		const { neighbour, empty } = this.grid.find_neighbour(tileIndex, direction);
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
		const tileState = this.tileStates[tileIndex];
		if (tileState.edgeMarks[index] === mark) {
			tileState.edgeMarks[index] = 'empty';
		} else if (tileState.edgeMarks[index] !== 'none') {
			tileState.edgeMarks[index] = mark;
		}
		if (tileState.edgeMarks[index] !== 'empty' && assistant) {
			this.rotateToMatchMarks(tileIndex);
			this.rotateToMatchMarks(neighbour);
		}
	}

	/**
	 * Rotate a tile so that it fits existing edgemarks and locked tiles
	 * @param {number} tileIndex
	 */
	rotateToMatchMarks(tileIndex) {
		const tileState = this.tileStates[tileIndex];
		if (tileState.locked) {
			return;
		}
		let walls = 0;
		let connections = 0;
		const polygon = this.grid.polygon_at(tileIndex);
		for (let direction of polygon.directions) {
			const { neighbour, empty } = this.grid.find_neighbour(tileIndex, direction);
			if (empty) {
				walls += direction;
				continue;
			}
			if (this.tileStates[neighbour].locked) {
				if (this.connections.get(neighbour)?.has(tileIndex)) {
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
			const rotated = polygon.rotate(tileState.tile, rotations);
			if ((rotated & connections) === connections && (rotated & walls) === 0) {
				this.rotateTile(tileIndex, r);
				break;
			}
		}
	}

	/**
	 * @param {{detail: {
	 *  tileIndex: Number,
	 *  dirIn: Number[],
	 *  dirOut: Number[],
	 * }}} event
	 * @returns {void}
	 */
	handleConnections(event) {
		const { tileIndex, dirIn, dirOut } = event.detail;
		// console.log('==========================');
		// console.log(tileIndex, dirIn, dirOut);
		const tileConnections = this.connections.get(tileIndex);
		if (tileConnections === undefined) {
			return;
		}
		dirOut.forEach((direction) => {
			const { neighbour, empty } = this.grid.find_neighbour(tileIndex, direction);
			if (empty) {
				return;
			}
			tileConnections.delete(neighbour);
			const neighbourConnections = this.connections.get(neighbour);
			if (neighbourConnections === undefined) {
				throw `Could not find connections data for tile ${neighbour}`;
			}
			if (!neighbourConnections.has(tileIndex)) {
				return; // this connection wasn't mutual, no action needed
			}
			const neighbourComponent = this.components.get(neighbour);
			const tileComponent = this.components.get(tileIndex);
			if (tileComponent === neighbourComponent) {
				// console.log('disconnecting components between tiles', tileIndex, neighbour)
				this.disconnectComponents(tileIndex, neighbour);
			}
			this.setTileDisconnects(neighbour, true);
			this.setTileDisconnects(tileIndex, true);
		});
		let hasDisconnects = false;
		dirIn.forEach((direction) => {
			const { neighbour, empty } = this.grid.find_neighbour(tileIndex, direction);
			if (empty) {
				hasDisconnects = true;
				this.setTileDisconnects(tileIndex, true);
				return;
			}
			tileConnections.add(neighbour);
			const neighbourConnections = this.connections.get(neighbour);
			if (neighbourConnections === undefined) {
				throw `Could not find connections data for tile ${neighbour}`;
			}
			if (!neighbourConnections.has(tileIndex)) {
				hasDisconnects = true;
				return; // non-mutual link shouldn't lead to merging
			}
			// console.log('merging components of tiles', tileIndex, neighbour)
			this.mergeComponents(tileIndex, neighbour);
			this.setTileDisconnects(neighbour);
		});
		if (hasDisconnects) {
			this.setTileDisconnects(tileIndex, true);
		} else {
			this.setTileDisconnects(tileIndex);
		}
		if (this.initialized) {
			this.solved = this.isSolved();
		}
	}

	/**
	 *
	 * @param {Number} tileIndex
	 * @param {Boolean|undefined} [hasDisconnects]
	 */
	setTileDisconnects(tileIndex, hasDisconnects = undefined) {
		let newHasDisconnects = hasDisconnects || false;
		if (hasDisconnects === undefined) {
			const directions = this.grid.getDirections(this.tileStates[tileIndex].tile, 0, tileIndex);
			const connections = this.connections.get(tileIndex);
			if (connections === undefined) {
				throw `Connections data for tile ${tileIndex} not found`;
			}
			if (directions.length > connections.size) {
				newHasDisconnects = true;
			} else {
				for (let neighbour of connections || []) {
					if (!this.connections.get(neighbour)?.has(tileIndex)) {
						newHasDisconnects = true;
						break;
					}
				}
			}
		}
		this.tileStates[tileIndex].hasDisconnects = newHasDisconnects;
		const component = this.components.get(tileIndex);
		if (component === undefined) {
			throw `Component open ends data for tile ${tileIndex} not found`;
		}
		if (newHasDisconnects) {
			if (component.openEnds.size === 0) {
				for (let index of component.tiles) {
					this.tileStates[index].isPartOfIsland = false;
				}
			}
			component.openEnds.add(tileIndex);
			this.openEnds.add(tileIndex);
		} else {
			component.openEnds.delete(tileIndex);
			this.openEnds.delete(tileIndex);
			if (component.openEnds.size === 0 && component.tiles.size < this.totalTiles) {
				for (let index of component.tiles) {
					this.tileStates[index].isPartOfIsland = true;
				}
			}
		}
		this.shareDisconnectedTiles = this.openEnds.size / this.totalTiles;
	}

	/**
	 * @returns {boolean}
	 */
	isSolved() {
		// console.log('=================== Solved check ======================')
		const total = this.grid.total - this.grid.emptyCells.size;
		const component = this.components.get(this.firstValidIndex);
		if (component === undefined) {
			return false;
		}
		if (component.tiles.size < total) {
			// console.log('not everything connected yet')
			// not everything connected yet
			return false;
		}
		let startCheckAtIndex = this.firstValidIndex;
		let toCheck = new Set([{ fromIndex: -1, tileIndex: startCheckAtIndex }]);
		// console.log('start at', startCheckAtIndex)
		/** @type Set<Number> */
		const checked = new Set([]);
		while (toCheck.size > 0) {
			// console.log('toCheck = ', toCheck)
			/** @type {Set<{fromIndex: Number, tileIndex: Number}>} */
			const newChecks = new Set([]);
			for (let { fromIndex, tileIndex } of toCheck) {
				// console.log('checking tile', tileIndex, 'coming from', fromIndex)
				const neighbours = this.connections.get(tileIndex);
				if (neighbours === undefined) {
					throw `Could not find connections data for tile ${tileIndex}`;
				}
				// console.log('tile neighbours', neighbours)
				for (let neighbour of neighbours) {
					// console.log('checking neighbour', neighbour)
					if (neighbour === -1) {
						// not solved if any tiles point outside
						// console.log('not solved for outside connection in tile', tileIndex)
						startCheckAtIndex = tileIndex;
						return false;
					}
					const neighbourConnections = this.connections.get(neighbour);
					if (neighbourConnections === undefined) {
						throw `Could not find connections data for tile ${neighbour}`;
					}
					// console.log('neighbour connections', neighbourConnections)
					if (!neighbourConnections.has(tileIndex)) {
						// not solved if a connection is not mutual
						// console.log('not solved for non-mutual connection between tiles', tileIndex, neighbour)
						startCheckAtIndex = tileIndex;
						return false;
					}
					if (neighbour !== fromIndex) {
						if (checked.has(neighbour)) {
							// it's a loop
							// console.log('not solved because of loop detected at tile', tileIndex)
							startCheckAtIndex = tileIndex;
							return false;
						} else {
							newChecks.add({ fromIndex: tileIndex, tileIndex: neighbour });
						}
					}
				}
				checked.add(tileIndex);
				toCheck = newChecks;
			}
		}
		if (checked.size < total) {
			// console.log('not solved because only', checked.size, 'of', total, 'were reached')
			// it's an island
			return false;
		}
		return true;
	}

	/**
	 * @param {Number} fromIndex
	 * @param {Number} toIndex
	 * @returns {void}
	 */
	mergeComponents(fromIndex, toIndex) {
		const fromComponent = this.components.get(fromIndex);
		const toComponent = this.components.get(toIndex);
		// makes jsdoc stop complaining about
		// "object is possibly undefined"
		if (fromComponent === undefined || toComponent === undefined) {
			// console.log('could not find component for tile')
			return;
		}
		if (fromComponent === toComponent) {
			// console.log('merge component to itthis, its a loop', fromIndex, toIndex)
			const loopTiles = this.detectLoops(fromComponent.tiles);
			for (let tile of fromComponent.tiles) {
				this.tileStates[tile].isPartOfLoop = loopTiles.has(tile);
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
				constantComponent.tiles.forEach((tileIndex) => {
					this.tileStates[tileIndex].color = newColor;
				});
			}
			constantComponent.color = newColor;
		}
		for (let changedTile of changedComponent.tiles) {
			this.components.set(changedTile, constantComponent);
			constantComponent.tiles.add(changedTile);
			this.tileStates[changedTile].color = constantComponent.color;
		}
		for (let changedTile of changedComponent.openEnds) {
			constantComponent.openEnds.add(changedTile);
		}
	}

	/**
	 * Toggle tile's locked state, return new state
	 * @param {Number} tileIndex
	 * @param {boolean|undefined} [state]
	 * @param {boolean} [assistant=false]
	 * @returns {boolean} - new locked value
	 */
	toggleLocked(tileIndex, state = undefined, assistant = false) {
		const tileState = this.tileStates[tileIndex];
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
			for (let direction of this.grid.polygon_at(tileIndex).directions) {
				const { neighbour, empty } = this.grid.find_neighbour(tileIndex, direction);
				if (empty) {
					continue;
				}
				this.rotateToMatchMarks(neighbour);
			}
		}
		return targetState;
	}

	/**
	 * @param {Number} fromIndex
	 * @param {Number} toIndex
	 * @returns {void}
	 */
	disconnectComponents(fromIndex, toIndex) {
		const bigComponent = this.components.get(fromIndex);
		if (bigComponent === undefined) {
			return;
		} // this shouldn't really happen, jsdoc
		const fromTiles = this.findConnectedTiles(toIndex, fromIndex);
		const toTiles = this.findConnectedTiles(fromIndex, toIndex);
		if ([...fromTiles].some((tile) => toTiles.has(tile))) {
			// it was a loop or maybe it still is
			// console.log('not disconnecting because of other connection', fromIndex, toIndex)
			const loopTiles = this.detectLoops(bigComponent.tiles);
			for (let tile of bigComponent.tiles) {
				this.tileStates[tile].isPartOfLoop = loopTiles.has(tile);
			}
			return;
		}
		const fromIsBigger = fromTiles.size >= toTiles.size;
		// const leaveTiles = fromIsBigger ? fromTiles : toTiles
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
			this.tileStates[tileIndex].color = newComponent.color;
		}
		// console.log('created new component', newComponent.id, 'with tiles', [...changeTiles])
	}

	/**
	 * @param {Set<Number>} tilesSet
	 * @returns {Set<Number>}
	 */
	detectLoops(tilesSet) {
		// console.log('detect loops in set', tilesSet)
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
					// return true for mutual connections that are
					// part of this component
					if (!tilesSet.has(x)) {
						return false;
					}
					const conn = this.connections.get(x);
					if (conn === undefined) {
						throw `Could not find connections data for tile ${x}`;
					}
					return conn.has(tile);
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
		 * and back to itthis
		 * @param {Number} fromTile
		 * @param {Number} throughTile
		 * @returns {Number[]} - tile indices that make a looping path.
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
			// console.log('myconnections', myConnections.size, ', in loops', inLoops.size)
			let tileToCheck = -1;
			for (let tile of myConnections.keys()) {
				if (!inLoops.has(tile)) {
					tileToCheck = tile;
					break;
				}
			}
			// console.log('checking tile', tileToCheck)
			const neighbours = myConnections.get(tileToCheck);
			if (neighbours === undefined) {
				throw `Could not find connections data for tile ${tileToCheck}`;
			}
			const [neighbour] = neighbours;
			// console.log('checking neighbour', neighbour)
			const loop = traceLoopPath(tileToCheck, neighbour);
			// console.log('found loop', loop)
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

	/** Find tiles that are connected to tile toIndex
	 * Excluding connections through tile fromIndex
	 * Used when the player breaks up connected components
	 * @param {Number} fromIndex
	 * @param {Number} toIndex
	 * @returns {Set<Number>}
	 */
	findConnectedTiles(fromIndex, toIndex) {
		let tileToCheck = new Set([{ fromIndex: fromIndex, tileIndex: toIndex }]);
		const myComponent = this.components.get(toIndex);
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
					if (neighbour === -1) {
						// no neighbour
						continue;
					}
					const neighbourComponent = this.components.get(neighbour);
					if (neighbourComponent === undefined) {
						throw `Could not find component for tile ${neighbour}`;
					}
					if (neighbourComponent !== myComponent) {
						// not from this component, will be handled during merge phase
						continue;
					}
					const neighbourConnections = this.connections.get(neighbour);
					if (neighbourConnections === undefined) {
						throw `Could not find connections data for tile ${neighbour}`;
					}
					if (!neighbourConnections.has(tileIndex)) {
						// not mutual
						continue;
					}
					if (neighbour === fromIndex) {
						// came from here
						continue;
					}
					if (checked.has(neighbour)) {
						// it's a loop?
						continue;
					}
					newChecks.add({ fromIndex: tileIndex, tileIndex: neighbour });
				}
				checked.add(tileIndex);
				tileToCheck = newChecks;
			}
		}
		return checked;
	}
}
