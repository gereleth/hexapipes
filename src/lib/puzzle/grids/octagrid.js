const EAST = 1;
const NORTHEAST = 2;
const NORTH = 4;
const NORTHWEST = 8;
const WEST = 16;
const SOUTHWEST = 32;
const SOUTH = 64;
const SOUTHEAST = 128;

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
	XY_DELTAS = new Map([
		[EAST, [1, 0]],
		[NORTHEAST, [0.5, 0.5]],
		[NORTH, [0, 1]],
		[NORTHWEST, [-0.5, 0.5]],
		[WEST, [-1, 0]],
		[SOUTHWEST, [-0.5, -0.5]],
		[SOUTH, [0, -1]],
		[SOUTHEAST, [0.5, -0.5]]
	]);
	ANGLE_DEG = 45;
	ANGLE_RAD = Math.PI / 4;
	NUM_DIRECTIONS = 8;
	KIND = 'octagonal';
	PIPE_WIDTH = 0.15;
	STROKE_WIDTH = 0.06;
	PIPE_LENGTH = 0.5;
	SINK_RADIUS = 0.2;

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
		this.total = width * height - this.emptyCells.size;

		this.XMIN = -0.6 - (wrap ? 1 : 0);
		this.XMAX = width + 0.1 + (wrap ? 1 : 0);
		this.YMIN = -(1 + (wrap ? 1 : 0));
		this.YMAX = height + (wrap ? 1 : 0);

		const d = 0.49;
		let tilePath = `M ${d} ${d} L ${-d} ${d} L ${-d} ${-d} L ${d} ${-d} z`;
		this.tilePath = tilePath;

		/* Tile types for use in solver */
		this.T0 = 0;
		this.T1 = 1;
		this.T2L = 3;
		this.T2I = 5;
		this.T3 = 7;
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
	 * Tells if a point is close to one of tile's edges
	 * @param {import('$lib/puzzle/controls').PointerOrigin} point
	 */
	whichEdge(point) {
		const { x, y, tileX, tileY } = point;
		const dx = x - tileX;
		const dy = tileY - y;
		const deltaRadius = Math.abs(Math.sqrt(dx ** 2 + dy ** 2) - 0.5);
		let angle = Math.atan2(dy, dx);
		angle += angle < 0 ? 2 * Math.PI : 0;
		const directionIndex = Math.round((angle * 2) / Math.PI) % 4;
		const direction = this.DIRECTIONS[directionIndex];
		const directionAngle = (directionIndex * Math.PI) / 2;
		let deltaAngle = Math.abs(angle - directionAngle);
		deltaAngle = Math.min(deltaAngle, 2 * Math.PI - deltaAngle);
		return {
			direction,
			isClose: deltaRadius <= 0.15 && deltaAngle <= 0.35
		};
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
		let rotated = tile;
		rotations = rotations % 4;
		if (rotations > 2) {
			rotations -= 4;
		} else if (rotations < -2) {
			rotations += 4;
		}
		while (rotations < 0) {
			rotated = ((rotated * 2) % 16) + Math.floor(rotated / 8);
			rotations += 1;
		}
		while (rotations > 0) {
			rotated = Math.floor(rotated / 2) + 8 * (rotated % 2);
			rotations -= 1;
		}
		return rotated;
	}

	/**
	 *
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @returns {Number[]}
	 */
	getDirections(tile, rotations = 0) {
		const rotated = this.rotate(tile, rotations);
		return this.DIRECTIONS.filter((direction) => (direction & rotated) > 0);
	}

	/**
	 * Computes angle for drawing the tile guiding dot
	 * @param {Number} tile
	 * @returns {Number}
	 */
	getTileAngle(tile) {
		const tileDirections = this.getDirections(tile);
		const deltas = tileDirections.map((direction) => this.XY_DELTAS.get(direction) || [0, 0]);

		let dx = 0,
			dy = 0;
		for (let [deltax, deltay] of deltas) {
			dx += deltax;
			dy += deltay;
		}
		dx /= tileDirections.length;
		dy /= tileDirections.length;
		if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
			// a symmetric tile - I or X - grab any leg
			dx = deltas[0][0];
			dy = deltas[0][1];
		}
		return Math.atan2(dy, dx);
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
}
