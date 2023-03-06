import { writable, derived, get } from 'svelte/store';

/**
 * ViewBox represents the bounds of the visible game area
 * @typedef {Object} ViewBox
 * @property {Number} xmin
 * @property {Number} ymin
 * @property {Number} width
 * @property {Number} height
 */

/**
 * VisibleTile represents a tile within view
 * @typedef {Object} VisibleTile
 * @property {Number} index
 * @property {Number} x
 * @property {Number} y
 * @property {String} key
 */

const EAST = 1;
const NORTH = 2;
const WEST = 4;
const SOUTH = 8;

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
	ANGLE_DEG = 90;
	ANGLE_RAD = Math.PI / 2;
	NUM_DIRECTIONS = 4;

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
		this.total = width * height - this.emptyCells.size;

		this.XMIN = -0.6 - (wrap ? 1 : 0);
		this.XMAX = width + 0.1 + (wrap ? 1 : 0);
		this.YMIN = -(1 + (wrap ? 1 : 0));
		this.YMAX = height + (wrap ? 1 : 0);

		this.lastBox = {
			xmin: this.XMIN,
			ymin: this.YMIN,
			width: this.XMAX - this.XMIN,
			height: this.YMAX - this.YMIN
		};
		this.viewBox = writable(this.lastBox);

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
		for (let t = 0; t < 16; t++) {
			let rotated = t;
			while (!this.tileTypes.has(rotated)) {
				this.tileTypes.set(rotated, t);
				rotated = this.rotate(rotated, 1);
			}
		}

		this.visibleTiles = derived(
			this.viewBox,
			(box, set) => {
				this.lastBox = box;
				if (this.visibleTilesTimeoutId === null) {
					this.visibleTilesTimeoutId = setTimeout(() => {
						this.visibleTilesTimeoutId = null;
						set(this.#getVisibleTiles(this.lastBox));
					}, 50);
				}
			},
			this.#getVisibleTiles(get(this.viewBox))
		);
	}

	/**
	 * Makes sure non-wrap view box doesn't go over puzzle bounds
	 * @param {ViewBox} box
	 * @returns {ViewBox}
	 */
	#fixBoxBounds(box) {
		if (this.wrap) {
			return box;
		}
		let xmin = box.xmin;
		let ymin = box.ymin;
		let width = box.width;
		let height = box.height;
		const dw = box.width - (this.XMAX - this.XMIN);
		const dh = box.height - (this.YMAX - this.YMIN);
		if (dw > 0 && dh > 0) {
			// zoomed too far out, bring them back
			if (dw <= dh) {
				width = box.width - dw;
				height = box.height - (dw * box.height) / box.width;
			} else {
				height = box.height - dh;
				width = box.width - (dh * box.width) / box.height;
			}
			xmin = 0.5 * (this.XMIN + this.XMAX) - width / 2;
			ymin = 0.5 * (this.YMIN + this.YMAX) - height / 2;
		} else {
			if (dw < 0) {
				// zoomed in horizontally, don't allow bounds to leave [XMIN, XMAX]
				xmin = Math.max(this.XMIN, xmin);
				xmin = Math.min(xmin, this.XMAX - width);
			}
			if (dh < 0) {
				// zoomed in vertically, don't allow bounds to leave [YMIN, YMAX]
				ymin = Math.max(this.YMIN, ymin);
				ymin = Math.min(ymin, this.YMAX - height);
			}
		}
		return { xmin, ymin, width, height };
	}

	/**
	 *
	 * @param {Number} newWidth
	 * @param {Number} x
	 * @param {Number} y
	 */
	zoom(newWidth, x, y) {
		this.viewBox.update((box) => {
			// const delta = -box.width * magnitude * 0.07;
			const delta = box.width - newWidth;
			const xyScale = box.height / box.width;
			const relativeX = (x - box.xmin) / box.width;
			const relativeY = (y - box.ymin) / box.height;
			let xmin = box.xmin + relativeX * delta;
			let ymin = box.ymin + relativeY * delta * xyScale;
			let xmax = box.xmin + box.width - (1 - relativeX) * delta;
			let ymax = box.ymin + box.height - (1 - relativeY) * delta * xyScale;
			return this.#fixBoxBounds({
				xmin: xmin,
				ymin: ymin,
				width: xmax - xmin,
				height: ymax - ymin
			});
		});
	}

	/**
	 * Move viewbox around
	 * @param {Number} dx
	 * @param {Number} dy
	 */
	pan(dx, dy) {
		this.viewBox.update((box) => {
			const newBox = this.#fixBoxBounds({
				xmin: box.xmin - dx,
				ymin: box.ymin - dy,
				width: box.width,
				height: box.height
			});
			return newBox;
		});
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
	 * @param {ViewBox} box
	 * @returns {VisibleTile[]}
	 */
	#getVisibleTiles(box) {
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

	// Throttled derived store to get visible tiles from viewbox
	/** @type {NodeJS.Timer|null} */
	visibleTilesTimeoutId = null;
	/** @type {ViewBox} */
	lastBox;
}
