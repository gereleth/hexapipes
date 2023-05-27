import { RegularPolygonTile } from '$lib/puzzle/grids/polygonutils';

const EAST = 1;
const NORTHEAST = 2;
const NORTH = 4;
const NORTHWEST = 8;
const WEST = 16;
const SOUTHWEST = 32;
const SOUTH = 64;
const SOUTHEAST = 128;

const Roct = 0.5;
const R0 = 0.49;
const d = Roct * Math.sin(Math.PI / 8);
const d0 = R0 * Math.sin(Math.PI / 8);
const Rsq = ((Roct - d) * Math.SQRT2) / 2;
const OCTAGON = new RegularPolygonTile(8, 0, 0.5);
const SQUARE = new RegularPolygonTile(4, Math.PI / 4, Rsq, [2, 8, 32, 128]);

export class OctaGrid {
	DIRECTIONS = [EAST, NORTHEAST, NORTH, NORTHWEST, WEST, SOUTHWEST, SOUTH, SOUTHEAST];
	EDGEMARK_DIRECTIONS = [NORTHEAST, NORTH, NORTHWEST, WEST];
	OPPOSITE = new Map([
		[NORTH, SOUTH],
		[SOUTH, NORTH],
		[EAST, WEST],
		[WEST, EAST],
		[NORTHEAST, SOUTHWEST],
		[SOUTHWEST, NORTHEAST],
		[NORTHWEST, SOUTHEAST],
		[SOUTHEAST, NORTHWEST]
	]);
	RC_DELTAS = new Map([
		[EAST, [1, 0]],
		[NORTHEAST, [0.5, 0.5]],
		[NORTH, [0, 1]],
		[NORTHWEST, [-0.5, 0.5]],
		[WEST, [-1, 0]],
		[SOUTHWEST, [-0.5, -0.5]],
		[SOUTH, [0, -1]],
		[SOUTHEAST, [0.5, -0.5]]
	]);
	XY_DELTAS = new Map([
		[EAST, [1, 0]],
		[NORTHEAST, [Math.SQRT1_2, Math.SQRT1_2]],
		[NORTH, [0, 1]],
		[NORTHWEST, [-Math.SQRT1_2, Math.SQRT1_2]],
		[WEST, [-1, 0]],
		[SOUTHWEST, [-Math.SQRT1_2, -Math.SQRT1_2]],
		[SOUTH, [0, -1]],
		[SOUTHEAST, [Math.SQRT1_2, -Math.SQRT1_2]]
	]);
	ANGLE_DEG = 45;
	ANGLE_RAD = Math.PI / 4;
	NUM_DIRECTIONS = 8;
	KIND = 'octagonal';
	PIPE_WIDTH = 0.1;
	STROKE_WIDTH = 0.04;
	PIPE_LENGTH = 0.5;
	SINK_RADIUS = 0.13;

	/** @type {Set<Number>} - indices of empty cells */
	emptyCells;
	/** @type {Number} - total number of cells excluding empties */
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
		if (tiles.length === 0 && !wrap) {
			const N = 2 * width * height;
			for (let w = 1; w <= width; w++) {
				this.emptyCells.add(N - w);
			}
			for (let h = 1; h < height; h++) {
				this.emptyCells.add(N - 1 - width * h);
			}
		}
		this.total = 2 * width * height;

		this.XMIN = -0.6 - (wrap ? 1 : 0);
		this.XMAX = width - 0.4 + (wrap ? 1 : 0);
		this.YMIN = -(1 + (wrap ? 1 : 0));
		this.YMAX = height + (wrap ? 1 : 0);

		/* Tile types for use in solver */
		this.T0 = 0;
		this.T1 = 1;
		this.T2v = 3;
		this.T2L = 5;
		this.T2C = 9;
		this.T2I = 17;
		this.T3w = 7;
		/** @type {Map<Number,Number>} */
		this.tileTypes = new Map();
		for (let t = 0; t < 256; t++) {
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
		const isSquare = index >= this.width * this.height;
		const i = index - (isSquare ? this.width * this.height : 0);
		const x = i % this.width;
		const y = Math.round((i - x) / this.width);
		return [x + (isSquare ? 0.5 : 0), y + (isSquare ? 0.5 : 0)];
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
		const x1 = Math.floor(x);
		const x2 = Math.ceil(x);
		const xm = (x1 + x2) * 0.5;
		const x0 = Math.round(x);

		const y1 = Math.floor(y);
		const y2 = Math.ceil(y);
		const ym = (y1 + y2) * 0.5;
		const y0 = Math.round(y);

		const r = 0.5 * (1 - Math.sin(Math.PI / 8));
		if (Math.abs(x - xm) + Math.abs(y - ym) <= r) {
			// square tile
			let index = this.rc_to_index(ym, xm);
			if (this.emptyCells.has(index)) {
				index = -1;
			}
			return { index, x: xm, y: ym };
		}
		// octagon tile
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
		let c = 0;
		let r = 0;
		if (index >= this.width * this.height) {
			// square cell
			if ([NORTH, SOUTH, EAST, WEST].some((d) => d === direction)) {
				return { neighbour: -1, empty: true };
			}
			index -= this.width * this.height;
			c += 0.5;
			r += 0.5;
		}
		c += index % this.width;
		r += (index - (index % this.width)) / this.width;
		let neighbour = -1;

		const [dc, dr] = this.RC_DELTAS.get(direction) || [0, 0];
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
		let squareIndexOffset = 0;
		if (r - Math.floor(r) > 0.2) {
			squareIndexOffset = this.width * this.height;
			r = Math.floor(r);
			c = Math.floor(c);
		}
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
		return this.width * r + c + squareIndexOffset;
	}

	/**
	 * Makes cell at index empty
	 * @param {Number} index
	 */
	makeEmpty(index) {
		this.emptyCells.add(index);
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
			// add octagons row
			for (let c = cmin; c <= cmax; c++) {
				const indexOct = this.rc_to_index(r, c);
				if (indexOct !== -1 && !this.emptyCells.has(indexOct)) {
					const x = c;
					const y = r;
					const key = `${Math.round(2 * x)}_${Math.round(2 * y)}`;
					visibleTiles.push({
						index: indexOct,
						x,
						y,
						key
					});
				}
			}
			// add squares row
			// this ordering ensures edgemarks are visible and not overlapped by other tiles
			const rs = r + 0.5;
			for (let c = cmin; c <= cmax; c++) {
				const cs = c + 0.5;
				const indexSquare = this.rc_to_index(rs, cs);
				if (indexSquare !== -1 && !this.emptyCells.has(indexSquare)) {
					const x = cs;
					const y = rs;
					const key = `${Math.round(2 * x)}_${Math.round(2 * y)}`;
					visibleTiles.push({
						index: indexSquare,
						x,
						y,
						key
					});
				}
			}
		}
		return visibleTiles;
	}

	/**
	 * @param {Number} index
	 * @returns {RegularPolygonTile}
	 */
	polygon_at(index) {
		if (index >= this.width * this.height) {
			return SQUARE;
		}
		return OCTAGON;
	}

	/**
	 * A number corresponding to fully connected tile
	 * @param {Number} index
	 * @returns {Number}
	 */
	fullyConnected(index) {
		return this.polygon_at(index).fully_connected;
	}

	/**
	 * Compute tile orientation after a number of rotations
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @param {Number} index - index of tile, not used here
	 * @returns
	 */
	rotate(tile, rotations, index = 0) {
		return this.polygon_at(index).rotate(tile, rotations);
	}

	/**
	 * Get angle for displaying rotated pipes state
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns
	 */
	getAngle(rotations, index) {
		return this.polygon_at(index).get_angle(rotations);
	}

	/**
	 * @param {Number} index
	 */
	getTileTransformCSS(index) {
		return null;
	}

	/**
	 *
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns {Number[]}
	 */
	getDirections(tile, rotations = 0, index) {
		return this.polygon_at(index).get_directions(tile, rotations);
	}

	/**
	 * Tile contour path for svg drawing
	 * @param {Number} index
	 * @returns
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
	 * * @returns {Number[]}
	 */
	getGuideDotPosition(tile, index = 0) {
		const [dx, dy] = this.polygon_at(index).get_guide_dot_position(tile);
		return [0.7 * dx, 0.7 * dy];
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
		return this.polygon_at(index).click_orient_tile(tile, old_rotations, Math.atan2(-ty, tx));
	}

	/**
	 * Returns coordinates of endpoints of edgemark line
	 * @param {Number} direction
	 * @param {Boolean} isWall
	 * @param {Number} index
	 * @returns
	 */
	getEdgemarkLine(direction, isWall, index = 0) {
		return this.polygon_at(index).get_edgemark_line(direction);
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
		return this.polygon_at(tile_index).detect_edgemark_gesture(
			x1 - tile_x,
			x2 - tile_x,
			tile_y - y1,
			tile_y - y2
		);
	}

	/**
	 * Tells if a point is close to one of tile's edges
	 * @param {import('$lib/puzzle/controls').PointerOrigin} point
	 */
	whichEdge(point) {
		const { x, y, tileX, tileY, tileIndex } = point;
		const dx = x - tileX;
		const dy = tileY - y;
		return this.polygon_at(tileIndex).is_close_to_edge(dx, dy);
	}
}
