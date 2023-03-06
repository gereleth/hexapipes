import randomColor from 'randomcolor';
import { writable } from 'svelte/store';

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
 * @property {EdgeMark[]} edgeMarks
 */

/**
 * A component is a group of connected tiles
 * @typedef {Object} Component
 * @property {Set<Number>} tiles - set of indices of included tiles
 * @property {String} color
 */

/**
 * Saved progress for pipes puzzle
 * @typedef {Object} Progress
 * @property {SavedTileState[]} tiles
 */

/**
 * @constructor
 * @param {TileState} initialState
 */
function StateStore(initialState) {
	let self = this;

	const { subscribe, set, update } = writable(initialState);
	self.data = Object.assign({}, initialState);
	self.subscribe = subscribe;

	/**
	 * @param {TileState} newValue
	 */
	self.set = function (newValue) {
		self.data = newValue;
		set(newValue);
	};

	/**
	 * @param {String} color
	 */
	self.setColor = function (color) {
		self.data.color = color;
		set(self.data);
	};

	self.toggleLocked = function () {
		self.data.locked = !self.data.locked;
		set(self.data);
	};

	/**
	 * @param {Boolean} isPartOfLoop
	 */
	self.setPartOfLoop = function (isPartOfLoop) {
		self.data.isPartOfLoop = isPartOfLoop;
		set(self.data);
	};

	/**
	 * @param {Number} times
	 */
	self.rotate = function (times) {
		self.data.rotations += times;
		set(self.data);
	};

	return self;
}

/**
 * Pipes puzzle internal state
 * @constructor
 * @param {import('$lib/puzzle/grids/hexagrid').HexaGrid} grid
 * @param {Number[]} tiles
 * @param {Progress|undefined} savedProgress
 */
export function PipesGame(grid, tiles, savedProgress) {
	let self = this;

	self.grid = grid;
	self.tiles = tiles;
	self.initialized = false;
	self._solved = false;
	self.solved = writable(false);

	/**
	 * @type {Map<Number, Set<Number>>} - a map of
	 * tile index => set of neighbours that it points to */
	self.connections = new Map();

	/**
	 * @type {StateStore[]}
	 */
	self.tileStates = [];

	/**
	 * @type {Map<Number, Component>} - a map of tile index =>
	 * component that it belongs to
	 */
	self.components = new Map();

	/**
	 * @type {EdgeMark[]}
	 */
	const defaultEdgeMarks = ['empty', 'empty', 'empty'];
	if (savedProgress) {
		self.tileStates = savedProgress.tiles.map((savedTile, index) => {
			return new StateStore({
				tile: tiles[index],
				rotations: savedTile.rotations,
				color: savedTile.color,
				isPartOfLoop: false,
				locked: savedTile.locked,
				edgeMarks: savedTile.edgeMarks || [...defaultEdgeMarks]
			});
		});
	} else {
		self.tileStates = tiles.map((tile) => {
			return new StateStore({
				tile: tile,
				rotations: 0,
				color: 'white',
				isPartOfLoop: false,
				locked: false,
				edgeMarks: [...defaultEdgeMarks]
			});
		});
	}

	self.initializeBoard = function () {
		// create components and fill in connections data
		self.tileStates.forEach((tileState, index) => {
			const state = tileState.data;
			let directions = self.grid.getDirections(state.tile, state.rotations);
			const connections = new Set();
			for (let direction of directions) {
				const { neighbour, empty } = grid.find_neighbour(index, direction);
				if (!empty) {
					connections.add(neighbour);
				}
			}
			self.connections.set(index, connections);
		});
		// merge initial components of connected tiles
		const checked = new Set();
		let i = 0;
		const empty = new Set();
		while (checked.size < self.tileStates.length) {
			const toCheck = new Set([i]);
			const state = self.tileStates[i].data;
			const component = {
				color: state.color,
				tiles: new Set([i])
			};
			const connectedThrough = new Map();
			let loop = false;
			while (toCheck.size > 0) {
				const index = toCheck.values().next().value;
				toCheck.delete(index);
				checked.add(index);
				self.components.set(index, component);
				component.tiles.add(index);
				const connected = self.connections.get(index) || empty;
				for (let neighbour of connected) {
					const through = connectedThrough.get(neighbour) || -1;
					if (through === index) {
						// seen this connection before
						continue;
					} else if (through !== -1) {
						// connected to the same component through some other tile
						loop = true;
						continue;
					}
					if ((self.connections.get(neighbour) || empty).has(index)) {
						toCheck.add(neighbour);
						connectedThrough.set(neighbour, index);
					}
				}
			}
			if (loop) {
				const loopTiles = self.detectLoops(component.tiles);
				for (let loopTile of loopTiles) {
					self.tileStates[loopTile].setPartOfLoop(true);
				}
			}

			while (checked.has(i)) {
				i += 1;
			}
		}
		self.initialized = true;
	};

	self.startOver = function () {
		self.connections.clear();
		self.components.clear();
		self.initialized = false;
		self.solved.set(false);
		self._solved = false;

		self.tileStates.forEach((tileState, index) => {
			tileState.set({
				tile: tiles[index],
				rotations: 0,
				color: 'white',
				isPartOfLoop: false,
				locked: false,
				// some tiles could have set their edgemarks to none
				// if they are on the outer border
				// remember that and remove edgemarks otherwise
				edgeMarks: tileState.data.edgeMarks.map((edgemark) => {
					return edgemark === 'none' ? 'none' : 'empty';
				})
			});
		});

		self.initializeBoard();
	};

	/**
	 * Rotate tile a certain number of times
	 * @param {Number} tileIndex
	 * @param {Number} times
	 */
	self.rotateTile = function (tileIndex, times) {
		if (self._solved) {
			return;
		}
		const tileState = self.tileStates[tileIndex];
		if (tileState === undefined || tileState.data.locked) {
			return;
		}
		const oldDirections = self.grid.getDirections(tileState.data.tile, tileState.data.rotations);
		tileState.rotate(times);
		const newDirections = self.grid.getDirections(tileState.data.tile, tileState.data.rotations);

		const dirOut = oldDirections.filter((direction) => !newDirections.some((d) => d === direction));
		const dirIn = newDirections.filter((direction) => !oldDirections.some((d) => d === direction));

		self.handleConnections({
			detail: { tileIndex, dirOut, dirIn }
		});
	};

	/**
	 * Rotate tile to a certain orientation
	 * @param {Number} tileIndex
	 * @param {Number} orientation
	 */
	self.setTileOrientation = function (tileIndex, orientation, animate = false) {
		const tileState = self.tileStates[tileIndex];
		if (tileState === undefined) {
			return;
		}
		const initial = self.tiles[tileIndex];
		let newState = initial;
		let rotations = 0;
		while (newState !== orientation && rotations < self.grid.DIRECTIONS.length) {
			newState = self.grid.rotate(newState, 1, tileIndex);
			rotations += 1;
		}
		if (rotations === self.grid.DIRECTIONS.length) {
			throw `No way to rotate tile at ${tileIndex} from ${initial} to ${orientation}`;
		}
		const current = tileState.data.rotations;
		const delta = (rotations - current) % self.grid.DIRECTIONS.length;
		if (delta !== 0 || animate) {
			self.rotateTile(tileIndex, delta || self.grid.DIRECTIONS.length);
		}
	};

	/**
	 *
	 * @param {EdgeMark} mark
	 * @param {Number} tileIndex
	 * @param {Number} direction
	 * @param {Boolean} assistant
	 */
	self.toggleEdgeMark = function (mark, tileIndex, direction, assistant = false) {
		const { neighbour, empty } = self.grid.find_neighbour(tileIndex, direction);
		const index = self.grid.EDGEMARK_DIRECTIONS.indexOf(direction);
		if (index === -1) {
			// toggle mark on the neighbour instead
			const opposite = self.grid.OPPOSITE.get(direction);
			if (!empty && opposite) {
				self.toggleEdgeMark(mark, neighbour, opposite, assistant);
			}
			return;
		}
		const tileState = self.tileStates[tileIndex];
		if (tileState.data.edgeMarks[index] === mark) {
			tileState.data.edgeMarks[index] = 'empty';
		} else if (tileState.data.edgeMarks[index] !== 'none') {
			tileState.data.edgeMarks[index] = mark;
		}
		tileState.set(tileState.data);
		if (tileState.data.edgeMarks[index] !== 'empty' && assistant) {
			self.rotateToMatchMarks(tileIndex);
			self.rotateToMatchMarks(neighbour);
		}
	};

	/**
	 * Rotate a tile so that it fits existing edgemarks and locked tiles
	 * @param {number} tileIndex
	 */
	self.rotateToMatchMarks = function (tileIndex) {
		const tileState = self.tileStates[tileIndex];
		if (tileState.data.locked) {
			return;
		}
		let walls = 0;
		let connections = 0;
		for (let direction of self.grid.DIRECTIONS) {
			const { neighbour, empty } = self.grid.find_neighbour(tileIndex, direction);
			if (empty) {
				walls += direction;
				continue;
			}
			if (self.tileStates[neighbour].data.locked) {
				if (self.connections.get(neighbour)?.has(tileIndex)) {
					connections += direction;
				} else {
					walls += direction;
				}
				continue;
			}
			const index = self.grid.EDGEMARK_DIRECTIONS.indexOf(direction);
			/** @type {EdgeMark} */
			let mark = 'empty';
			if (index === -1) {
				// neighbour state has info about this mark
				const opposite = self.grid.OPPOSITE.get(direction) || 0;
				const oppositeIndex = self.grid.EDGEMARK_DIRECTIONS.indexOf(opposite);
				mark = self.tileStates[neighbour].data.edgeMarks[oppositeIndex];
			} else {
				mark = tileState.data.edgeMarks[index];
			}
			if (mark === 'conn') {
				connections += direction;
			} else if (mark === 'wall') {
				walls += direction;
			}
		}
		for (let r = 0; r < grid.DIRECTIONS.length; r++) {
			const rotations = tileState.data.rotations + r;
			const rotated = self.grid.rotate(tileState.data.tile, rotations, tileIndex);
			if ((rotated & connections) === connections && (rotated & walls) === 0) {
				self.rotateTile(tileIndex, r);
				break;
			}
		}
	};

	/**
	 * @param {{detail: {
	 *  tileIndex: Number,
	 *  dirIn: Number[],
	 *  dirOut: Number[],
	 * }}} event
	 * @returns {void}
	 */
	self.handleConnections = function (event) {
		const { tileIndex, dirIn, dirOut } = event.detail;
		// console.log('==========================')
		// console.log(tileIndex, dirIn, dirOut)
		const tileConnections = self.connections.get(tileIndex);
		if (tileConnections === undefined) {
			return;
		}
		dirOut.forEach((direction) => {
			const { neighbour, empty } = self.grid.find_neighbour(tileIndex, direction);
			if (empty) {
				return;
			}
			tileConnections.delete(neighbour);
			const neighbourConnections = self.connections.get(neighbour);
			if (neighbourConnections === undefined) {
				throw `Could not find connections data for tile ${neighbour}`;
			}
			if (!neighbourConnections.has(tileIndex)) {
				return; // this connection wasn't mutual, no action needed
			}
			const neighbourComponent = self.components.get(neighbour);
			const tileComponent = self.components.get(tileIndex);
			if (tileComponent === neighbourComponent) {
				// console.log('disconnecting components between tiles', tileIndex, neighbour)
				self.disconnectComponents(tileIndex, neighbour);
			}
		});
		dirIn.forEach((direction) => {
			const { neighbour, empty } = grid.find_neighbour(tileIndex, direction);
			if (empty) {
				return;
			}
			tileConnections.add(neighbour);
			const neighbourConnections = self.connections.get(neighbour);
			if (neighbourConnections === undefined) {
				throw `Could not find connections data for tile ${neighbour}`;
			}
			if (!neighbourConnections.has(tileIndex)) {
				return; // non-mutual link shouldn't lead to merging
			}
			// console.log('merging components of tiles', tileIndex, neighbour)
			self.mergeComponents(tileIndex, neighbour);
		});
		if (self.initialized) {
			self._solved = self.isSolved();
			if (self._solved) {
				self.solved.set(self._solved);
			}
		}
	};

	let firstValidIndex = 0;
	while (self.grid.emptyCells.has(firstValidIndex)) {
		firstValidIndex += 1;
	}
	/**
	 * @returns {boolean}
	 */
	self.isSolved = function () {
		// console.log('=================== Solved check ======================')
		const total = self.grid.total - self.grid.emptyCells.size;
		const component = self.components.get(firstValidIndex);
		if (component === undefined) {
			return false;
		}
		if (component.tiles.size < total) {
			// console.log('not everything connected yet')
			// not everything connected yet
			return false;
		}
		let startCheckAtIndex = firstValidIndex;
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
				const neighbours = self.connections.get(tileIndex);
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
					const neighbourConnections = self.connections.get(neighbour);
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
	};

	/**
	 * @param {Number} fromIndex
	 * @param {Number} toIndex
	 * @returns {void}
	 */
	self.mergeComponents = function (fromIndex, toIndex) {
		const fromComponent = self.components.get(fromIndex);
		const toComponent = self.components.get(toIndex);
		// makes jsdoc stop complaining about
		// "object is possibly undefined"
		if (fromComponent === undefined || toComponent === undefined) {
			// console.log('could not find component for tile')
			return;
		}
		if (fromComponent === toComponent) {
			// console.log('merge component to itself, its a loop', fromIndex, toIndex)
			const loopTiles = self.detectLoops(fromComponent.tiles);
			for (let tile of fromComponent.tiles) {
				self.tileStates[tile].setPartOfLoop(loopTiles.has(tile));
			}
			return;
		}
		const fromIsBigger = fromComponent.tiles.size >= toComponent.tiles.size;
		const constantComponent = fromIsBigger ? fromComponent : toComponent;
		const changedComponent = fromIsBigger ? toComponent : fromComponent;
		if (self.initialized) {
			let newColor = constantComponent.color;
			if (newColor === 'white') {
				newColor = changedComponent.color;
			}
			if (newColor === 'white') {
				newColor = randomColor({ luminosity: 'light' });
			}
			if (constantComponent.color !== newColor) {
				constantComponent.tiles.forEach((tileIndex) => {
					self.tileStates[tileIndex].setColor(newColor);
				});
			}
			constantComponent.color = newColor;
		}
		for (let changedTile of changedComponent.tiles) {
			self.components.set(changedTile, constantComponent);
			constantComponent.tiles.add(changedTile);
			self.tileStates[changedTile].setColor(constantComponent.color);
		}
	};

	/**
	 * Toggle tile's locked state, return new state
	 * @param {Number} tileIndex
	 * @param {boolean|undefined} state
	 * @param {boolean} assistant
	 * @returns {boolean} - new locked value
	 */
	self.toggleLocked = function (tileIndex, state = undefined, assistant = false) {
		const tileState = self.tileStates[tileIndex];
		let targetState = false;
		if (state === undefined) {
			targetState = !tileState.data.locked;
		} else {
			targetState = state;
		}
		if (tileState.data.locked !== targetState) {
			tileState.toggleLocked();
		}
		if (targetState && assistant) {
			for (let direction of self.grid.DIRECTIONS) {
				const { neighbour, empty } = self.grid.find_neighbour(tileIndex, direction);
				if (empty) {
					continue;
				}
				self.rotateToMatchMarks(neighbour);
			}
		}
		return targetState;
	};

	/**
	 * @param {Number} fromIndex
	 * @param {Number} toIndex
	 * @returns {void}
	 */
	self.disconnectComponents = function (fromIndex, toIndex) {
		const bigComponent = self.components.get(fromIndex);
		if (bigComponent === undefined) {
			return;
		} // this shouldn't really happen, jsdoc
		const fromTiles = self.findConnectedTiles(toIndex, fromIndex);
		const toTiles = self.findConnectedTiles(fromIndex, toIndex);
		if ([...fromTiles].some((tile) => toTiles.has(tile))) {
			// it was a loop or maybe it still is
			// console.log('not disconnecting because of other connection', fromIndex, toIndex)
			const loopTiles = self.detectLoops(bigComponent.tiles);
			for (let tile of bigComponent.tiles) {
				self.tileStates[tile].setPartOfLoop(loopTiles.has(tile));
			}
			return;
		}
		const fromIsBigger = fromTiles.size >= toTiles.size;
		// const leaveTiles = fromIsBigger ? fromTiles : toTiles
		const changeTiles = fromIsBigger ? toTiles : fromTiles;
		const newComponent = {
			color: randomColor({ luminosity: 'light' }),
			tiles: changeTiles
		};

		for (let tileIndex of changeTiles) {
			self.components.set(tileIndex, newComponent);
			bigComponent.tiles.delete(tileIndex);
			self.tileStates[tileIndex].setColor(newComponent.color);
		}
		// console.log('created new component', newComponent.id, 'with tiles', [...changeTiles])
	};

	/**
	 * @param {Set<Number>} tilesSet
	 * @returns {Set<Number>}
	 */
	self.detectLoops = function (tilesSet) {
		// console.log('detect loops in set', tilesSet)
		/**
		 * @type {Map<Number, Set<Number>>}
		 */
		const myConnections = new Map();
		let toPrune = new Set();
		for (let tile of tilesSet) {
			const tileConnections = self.connections.get(tile);
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
					const conn = self.connections.get(x);
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
				const tile = toPrune.values().next().value;
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
		 * and back to itself
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
			const neighbour = neighbours.values().next().value;
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
	};

	/** Find tiles that are connected to tile toIndex
	 * Excluding connections through tile fromIndex
	 * Used when the player breaks up connected components
	 * @param {Number} fromIndex
	 * @param {Number} toIndex
	 * @returns {Set<Number>}
	 */
	self.findConnectedTiles = function (fromIndex, toIndex) {
		let tileToCheck = new Set([{ fromIndex: fromIndex, tileIndex: toIndex }]);
		const myComponent = self.components.get(toIndex);
		/** @type {Set<Number>} */
		const checked = new Set([]);
		while (tileToCheck.size > 0) {
			/** @type {Set<{fromIndex: Number, tileIndex: Number}>} */
			const newChecks = new Set([]);
			for (let { fromIndex, tileIndex } of tileToCheck) {
				const neighbours = self.connections.get(tileIndex);
				if (neighbours === undefined) {
					throw `Could not find connections data for tile ${tileIndex}`;
				}
				for (let neighbour of neighbours) {
					if (neighbour === -1) {
						// no neighbour
						continue;
					}
					const neighbourComponent = self.components.get(neighbour);
					if (neighbourComponent === undefined) {
						throw `Could not find component for tile ${neighbour}`;
					}
					if (neighbourComponent !== myComponent) {
						// not from this component, will be handled during merge phase
						continue;
					}
					const neighbourConnections = self.connections.get(neighbour);
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
	};

	return self;
}
