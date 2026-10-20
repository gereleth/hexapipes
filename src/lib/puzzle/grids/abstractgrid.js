export class AbstractGrid {
	/** @type {Number[]} */
	DIRECTIONS = [];
	/** @type {Number[]} */
	EDGEMARK_DIRECTIONS = [];
	/** @type {Map<Number,Number>} */
	OPPOSITE = new Map();
	NUM_DIRECTIONS = 0;
	KIND = 'what';
	PIPE_WIDTH = 0.12;
	STROKE_WIDTH = 0.05;
	SINK_RADIUS = 0.17;
	EDGEMARK_WIDTH = 0.04;
	GUIDE_DOT_RADIUS = 0.03;
	BEND_EDGEMARKS = false;
	/** @type {"inherit" | "round" | "bevel" | "miter"}	 */
	LINE_JOIN = 'round';

	/** @type {Set<Number>} - indices of empty cells */
	emptyCells;
	/** @type {Number} - total number of cells including empties */
	total;
	/** @type {Number} - width of grid */
	width;
	/** @type {Number} - height of grid */
	height;
	/** @type {boolean} - wraps around or not */
	wrap;
	/** @type {Number} - X coordinate lower limit */
	XMIN;
	/** @type {Number} - X coordinate upper limit */
	XMAX;
	/** @type {Number} - Y coordinate lower limit */
	YMIN;
	/** @type {Number} - Y coordinate upper limit */
	YMAX;

	/**
	 *
	 * @param {Number} width
	 * @param {Number} height
	 * @param {Boolean} wrap
	 * @param {Number[]|Number[][]} tiles - classic bitmask per cell or a layered list of
	 * layers per cell; classic 0 cells and layered [] cells are empty
	 */
	constructor(width, height, wrap, tiles = []) {
		this.width = width;
		this.height = height;
		this.wrap = wrap;

		this.emptyCells = new Set();
		tiles.forEach((tile, index) => {
			if (tile === 0 || (Array.isArray(tile) && tile.length === 0)) {
				this.emptyCells.add(index);
			}
		});
		this.total = width * height;

		this.XMIN = -1;
		this.XMAX = width;
		this.YMIN = -1;
		this.YMAX = height;
	}

	/**
	 * Determines which cell a point at (x, y) belongs to
	 * Returns cell index and coordinates of cell center
	 * If the point is over empty space then index is -1
	 * @param {Number} x
	 * @param {Number} y
	 * @returns {{index: Number, x:Number, y: Number}}
	 */
	whichCellAt(x, y) {
		throw 'Implement whichCellAt(x, y) method';
	}

	/**
	 * Finds neighbour of cell at index in a certain direction
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	findNeighbour(index, direction) {
		throw 'Implement findNeighbour(index, direction) method';
	}

	/**
	 * Pipe node id for a single pipe of a tile at index
	 * @param {Number} index
	 * @param {Number} pipeIndex
	 * @returns {Number}
	 */
	pipeNodeId(index, pipeIndex) {
		return index + pipeIndex * this.total;
	}

	/**
	 * Cell index and pipe index of a pipe node id
	 * @param {Number} id
	 * @returns {Number[]} - [index, pipeIndex]
	 */
	cellIndexPipeIndexOf(id) {
		return [id % this.total, Math.floor(id / this.total)];
	}

	/**
	 * Makes cell at index empty
	 * @param {Number} index
	 */
	makeEmpty(index) {
		this.emptyCells.add(index);
	}

	/**
	 * Return polygon at index
	 * @param {Number} index
	 * @returns {import('#lib/puzzle/grids/polygonutils.js').RegularPolygonCell|
	 * import('#lib/puzzle/grids/polygonutils.js').TransformedPolygonCell}
	 */
	polygonAt(index) {
		throw 'Implement polygonAt(index) method';
	}

	/**
	 * Compute pipe bitmask after a number of rotations
	 * @param {Number} pipe
	 * @param {Number} rotations
	 * @param {Number} [index = 0]
	 * @returns
	 */
	rotate(pipe, rotations, index = 0) {
		return this.polygonAt(index).rotate(pipe, rotations);
	}

	/**
	 * Get angle for displaying rotated pipes state
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns {Number} - angle in radians
	 */
	getAngle(rotations, index) {
		return this.polygonAt(index).getAngle(rotations);
	}

	/**
	 * Get CSS transform string for this cell
	 * @param {Number} index
	 */
	getCellTransformCSS(index) {
		return this.polygonAt(index).transformCSS;
	}

	/**
	 * Get array of directions where the pipe bitmask is currently pointing
	 * @param {Number} pipe
	 * @param {Number} [rotations = 0]
	 * @param {Number} [index = 0]
	 * @returns {Number[]}
	 */
	getDirections(pipe, rotations = 0, index = 0) {
		return this.polygonAt(index).getDirections(pipe, rotations);
	}

	/**
	 * Given a viewbox return an array of visible cells
	 * @param {import('#lib/puzzle/game/viewbox.js').ViewBox} box
	 * @returns {import('#lib/puzzle/game/viewbox.js').VisibleTile[]}
	 */
	getVisibleCells(box) {
		throw 'Implement getVisibleCells(box) method';
	}

	/**
	 * Cell contour path for svg drawing
	 * @param {Number} index
	 * @returns {String}
	 */
	getCellPath(index) {
		return this.polygonAt(index).contourPath;
	}

	/**
	 * SVG path for drawing a pipe bitmask
	 * @param {Number} pipe
	 * @param {Number} index
	 */
	getPipePath(pipe, index) {
		return this.polygonAt(index).getPipePath(pipe);
	}

	/**
	 * Computes position for drawing the pipe's guiding dot
	 * @param {Number} pipe
	 * @param {Number} [index = 0]
	 * @returns {Number[]}
	 */
	getGuideDotPosition(pipe, index = 0) {
		const [dx, dy] = this.polygonAt(index).getGuideDotPosition(pipe);
		return [0.8 * dx, 0.8 * dy];
	}

	/**
	 * Compute number of rotations for orienting a pipe with "click to orient" control mode
	 * @param {Number} pipe
	 * @param {Number} old_rotations
	 * @param {Number} tx - x of clicked point relative to cell center
	 * @param {Number} ty - y of clicked point relative to cell center
	 * @param {Number} [index = 0]
	 */
	clickOrientPipe(pipe, old_rotations, tx, ty, index = 0) {
		return this.polygonAt(index).clickOrientPipe(pipe, old_rotations, tx, ty);
	}

	/**
	 * Returns coordinates of endpoints of edgemark line
	 * @param {Number} direction
	 * @param {Boolean} isWall
	 * @param {Number} [index = 0]
	 * @returns
	 */
	getEdgemarkLine(direction, isWall, index = 0) {
		let extendOut = true;
		if (this.BEND_EDGEMARKS) {
			extendOut = isWall;
		}
		return this.polygonAt(index).getEdgemarkLine(direction, extendOut);
	}

	/**
	 * Check if a drag gesture resembles drawing an edge mark
	 * @param {Number} index
	 * @param {Number} cell_x
	 * @param {Number} cell_y
	 * @param {Number} x1
	 * @param {Number} x2
	 * @param {Number} y1
	 * @param {Number} y2
	 */
	detectEdgemarkGesture(index, cell_x, cell_y, x1, x2, y1, y2) {
		const polygon = this.polygonAt(index);
		return polygon.detectEdgemarkGesture(x1 - cell_x, x2 - cell_x, y1 - cell_y, y2 - cell_y);
	}

	/**
	 * Tells if a point is close to one of cell's edges
	 * @param {import('#lib/puzzle/game/controls.js').PointerOrigin} point
	 */
	whichEdge(point) {
		const { x, y, cellX, cellY, index } = point;
		const dx = x - cellX;
		const dy = y - cellY;
		return this.polygonAt(index).isCloseToEdge(dx, dy);
	}

	/**
	 * Exports the grid's data
	 */
	export() {
		let tiles = [];
		if (this.emptyCells.size > 0) {
			tiles = Array(this.total).fill(-1);
			this.emptyCells.forEach((i) => (tiles[i] = 0));
		}
		return {
			width: this.width,
			height: this.height,
			wrap: this.wrap,
			kind: this.KIND,
			tiles
		};
	}
}
