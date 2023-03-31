import { RegularPolygonTile } from '$lib/puzzle/grids/polygonutils';

const EAST = 1;
const NORTH = 2;
const WEST = 4;
const SOUTH = 8;

const SQUARE = new RegularPolygonTile(4, 0, 0.5);

export class SquareGrid {
	DIRECTIONS = [EAST, NORTH, WEST, SOUTH];
	EDGEMARK_DIRECTIONS = [NORTH, WEST];
	OPPOSITE = new Map([
		[NORTH, SOUTH],
		[SOUTH, NORTH],
		[EAST, WEST],
		[WEST, EAST]
	]);
	XY_DELTAS = new Map([
		[NORTH, [0, 1]],
		[SOUTH, [0, -1]],
		[EAST, [1, 0]],
		[WEST, [-1, 0]]
	]);
	NUM_DIRECTIONS = 4;
	KIND = 'square';
	PIPE_WIDTH = 0.15;
	STROKE_WIDTH = 0.06;
	PIPE_LENGTH = 0.5;
	SINK_RADIUS = 0.2;

	/** @type {Set<Number>} - indices of empty cells */
	emptyCells;
	/** @type {Number} - total number of cells including empties */
	total;

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

		this.XMIN = -0.6 - (wrap ? 1 : 0);
		this.XMAX = width + 0.1 + (wrap ? 1 : 0);
		this.YMIN = -(1 + (wrap ? 1 : 0));
		this.YMAX = height + (wrap ? 1 : 0);

		/* Tile types for use in solver */
		this.T0 = 0;
		this.T1 = 1;
		this.T2L = 3;
		this.T2I = 5;
		this.T3 = 7;
		/** @type {Map<Number,Number>} */
		this.tileTypes = new Map();
		for (let t = 0; t < 16; t++) {
			let rotated = t;
			while (!this.tileTypes.has(rotated)) {
				this.tileTypes.set(rotated, t);
				rotated = this.rotate(rotated, 1);
			}
		}
	}

	/**
	 * @param {Number} index
	 */
	index_to_xy(index) {
		const x = index % this.width;
		const y = Math.round((index - x) / this.width);
		return [x, y];
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
		const x0 = Math.round(x);
		const y0 = Math.round(y);
		let index = this.rc_to_index(y0, x0);
		if (this.emptyCells.has(index)) {
			index = -1;
		}
		return { index, x: x0, y: y0 };
	}

	/**
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	find_neighbour(index, direction) {
		let c = index % this.width;
		let r = (index - c) / this.width;
		let neighbour = -1;

		const [dc, dr] = this.XY_DELTAS.get(direction) || [0, 0];
		r -= dr;
		c += dc;
		neighbour = this.rc_to_index(r, c);
		const empty = neighbour === -1 || this.emptyCells.has(neighbour);
		return { neighbour, empty };
	}

	/**
	 * Get index of tile located at row r column c
	 * @param {Number} r
	 * @param {Number} c
	 * @returns {Number}
	 */
	rc_to_index(r, c) {
		if (this.wrap) {
			r = r % this.height;
			if (r < 0) {
				r += this.height;
			}
			c = c % this.width;
			if (c < 0) {
				c += this.width;
			}
		} else {
			if (r < 0 || r >= this.height) {
				return -1;
			} else if (c < 0 || c >= this.width) {
				return -1;
			}
		}
		return this.width * r + c;
	}

	/**
	 * Makes cell at index empty
	 * @param {Number} index
	 */
	makeEmpty(index) {
		this.emptyCells.add(index);
	}

	/**
	 * A number corresponding to fully connected tile
	 * @param {Number} index
	 * @returns {Number}
	 */
	fullyConnected(index) {
		return 15;
	}

	/**
	 * Compute tile orientation after a number of rotations
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @param {Number} index - index of tile, not used here
	 * @returns
	 */
	rotate(tile, rotations, index = 0) {
		return SQUARE.rotate(tile, rotations);
	}

	/**
	 * Get angle for displaying rotated pipes state
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns
	 */
	getAngle(rotations, index) {
		return SQUARE.get_angle(rotations);
	}

	/**
	 *
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @returns {Number[]}
	 */
	getDirections(tile, rotations = 0) {
		return SQUARE.get_directions(tile, rotations);
	}

	/**
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	getVisibleTiles(box) {
		let rmin = Math.floor(box.ymin) - 1;
		let rmax = Math.ceil(box.ymin + box.height) + 1;
		if (!this.wrap) {
			rmin = Math.max(0, rmin);
			rmax = Math.min(this.height - 1, rmax);
		}
		let cmin = Math.floor(box.xmin) - 1;
		let cmax = Math.ceil(box.xmin + box.width) + 1;
		if (!this.wrap) {
			cmin = Math.max(0, cmin);
			cmax = Math.min(this.width - 1, cmax);
		}
		const visibleTiles = [];
		for (let r = rmin; r <= rmax; r++) {
			for (let c = cmin; c <= cmax; c++) {
				const index = this.rc_to_index(r, c);
				if (index === -1) {
					continue;
				}
				const x = c;
				const y = r;
				const key = `${Math.round(x)}_${Math.round(y)}`;
				visibleTiles.push({
					index,
					x,
					y,
					key
				});
			}
		}
		return visibleTiles;
	}

	/**
	 * Tile contour path for svg drawing
	 * @param {Number} index
	 * @returns
	 */
	getTilePath(index) {
		return SQUARE.contour_path;
	}

	/**
	 * Pipes lines path
	 * @param {Number} tile
	 * @param {Number} index
	 */
	getPipesPath(tile, index) {
		return SQUARE.get_pipes_path(tile);
	}

	/**
	 * Computes position for drawing the tile guiding dot
	 * @param {Number} tile
	 * * @param {Number} index
	 * @returns {Number[]}
	 */
	getGuideDotPosition(tile, index) {
		const [dx, dy] = SQUARE.get_guide_dot_position(tile);
		return [0.8 * dx, 0.8 * dy];
	}
	/**
	 * Compute number of rotations for orienting a tile with "click to orient" control mode
	 * @param {Number} tile
	 * @param {Number} old_rotations
	 * @param {Number} new_angle
	 * @param {Number} index
	 */
	clickOrientTile(tile, old_rotations, new_angle, index = 0) {
		return SQUARE.click_orient_tile(tile, old_rotations, new_angle);
	}
	/**
	 * Returns coordinates of endpoints of edgemark line
	 * @param {Number} direction
	 * @param {Number} index
	 * @returns
	 */
	getEdgemarkLine(direction, index = 0) {
		return SQUARE.get_edgemark_line(direction);
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
		return SQUARE.detect_edgemark_gesture(x1 - tile_x, x2 - tile_x, tile_y - y1, tile_y - y2);
	}

	/**
	 * Tells if a point is close to one of tile's edges
	 * @param {import('$lib/puzzle/controls').PointerOrigin} point
	 */
	whichEdge(point) {
		const { x, y, tileX, tileY } = point;
		const dx = x - tileX;
		const dy = tileY - y;
		return SQUARE.is_close_to_edge(dx, dy);
	}
}
