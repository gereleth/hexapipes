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
	 * @param {Number[]} tiles
	 */
	constructor(width, height, wrap, tiles = []) {
		this.width = width;
		this.height = height;
		this.wrap = wrap;

		this.emptyCells = new Set();
		tiles.forEach((tile, index) => {
			if (tile === 0) {
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
	 * Determines which tile a point at (x, y) belongs to
	 * Returns tile index and tile center coordinates
	 * If the point is over empty space then tileIndex is -1
	 * @param {Number} x
	 * @param {Number} y
	 * @returns {{index: Number, x:Number, y: Number}}
	 */
	which_tile_at(x, y) {
		throw 'Implement which_tile_at(x, y) method';
	}

	/**
	 * Finds neighbour of tile at index in a certain direction
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	find_neighbour(index, direction) {
		throw 'Implement find_neighbour(index, direction) method';
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
	 * @returns {import('$lib/puzzle/grids/polygonutils').RegularPolygonTile|
	 * import('$lib/puzzle/grids/polygonutils').TransformedPolygonTile}
	 */
	polygon_at(index) {
		throw 'Implement polygon_at(index) method';
	}

	/**
	 * Compute tile orientation after a number of rotations
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns
	 */
	rotate(tile, rotations, index = 0) {
		return this.polygon_at(index).rotate(tile, rotations);
	}

	/**
	 * Get angle for displaying rotated pipes state
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns {Number} - angle in radians
	 */
	getAngle(rotations, index) {
		return this.polygon_at(index).get_angle(rotations);
	}

	/**
	 * Get CSS transform string for this tile
	 * @param {Number} index
	 */
	getTileTransformCSS(index) {
		return this.polygon_at(index).transformCSS;
	}

	/**
	 * Get array of directions where the tile is currently pointing
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns {Number[]}
	 */
	getDirections(tile, rotations = 0, index = 0) {
		return this.polygon_at(index).get_directions(tile, rotations);
	}

	/**
	 * Given a viewbox return an array of visible tiles
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	getVisibleTiles(box) {
		throw 'Implement getVisibleTiles(box) method';
	}

	/**
	 * Tile contour path for svg drawing
	 * @param {Number} index
	 * @returns {String}
	 */
	getTilePath(index) {
		return this.polygon_at(index).contour_path;
	}

	/**
	 * Pipes lines path
	 * @param {Number} tile
	 * @param {Number} index
	 */
	getPipesPath(tile, index) {
		return this.polygon_at(index).get_pipes_path(tile);
	}

	/**
	 * Computes position for drawing the tile guiding dot
	 * @param {Number} tile
	 * @param {Number} index
	 * @returns {Number[]}
	 */
	getGuideDotPosition(tile, index = 0) {
		const [dx, dy] = this.polygon_at(index).get_guide_dot_position(tile);
		return [0.8 * dx, 0.8 * dy];
	}

	/**
	 * Compute number of rotations for orienting a tile with "click to orient" control mode
	 * @param {Number} tile
	 * @param {Number} old_rotations
	 * @param {Number} tx
	 * @param {Number} ty
	 * @param {Number} index
	 */
	clickOrientTile(tile, old_rotations, tx, ty, index = 0) {
		return this.polygon_at(index).click_orient_tile(tile, old_rotations, tx, ty);
	}

	/**
	 * Returns coordinates of endpoints of edgemark line
	 * @param {Number} direction
	 * @param {Boolean} isWall
	 * @param {Number} index
	 * @returns
	 */
	getEdgemarkLine(direction, isWall, index = 0) {
		let extendOut = true;
		if (this.BEND_EDGEMARKS) {
			extendOut = isWall;
		}
		return this.polygon_at(index).get_edgemark_line(direction, extendOut);
	}

	/**
	 * Check if a drag gesture resembles drawing an edge mark
	 * @param {Number} tile_index
	 * @param {Number} tile_x
	 * @param {Number} tile_y
	 * @param {Number} x1
	 * @param {Number} x2
	 * @param {Number} y1
	 * @param {Number} y2
	 */
	detectEdgemarkGesture(tile_index, tile_x, tile_y, x1, x2, y1, y2) {
		const polygon = this.polygon_at(tile_index);
		return polygon.detect_edgemark_gesture(x1 - tile_x, x2 - tile_x, y1 - tile_y, y2 - tile_y);
	}

	/**
	 * Tells if a point is close to one of tile's edges
	 * @param {import('$lib/puzzle/controls').PointerOrigin} point
	 */
	whichEdge(point) {
		const { x, y, tileX, tileY, tileIndex } = point;
		const dx = x - tileX;
		const dy = y - tileY;
		return this.polygon_at(tileIndex).is_close_to_edge(dx, dy);
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
