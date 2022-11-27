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

/**
 * A hexagonal grid
 * @constructor
 * @param {Number} width
 * @param {Number} height
 * @param {Boolean} wrap
 * @param {Number[]} tiles
 */
export function HexaGrid(width, height, wrap = false, tiles = []) {
	let self = this;

	const EAST = 1;
	const NORTHEAST = 2;
	const NORTHWEST = 4;
	const WEST = 8;
	const SOUTHWEST = 16;
	const SOUTHEAST = 32;

	this.YSTEP = Math.sqrt(3) / 2;

	this.DIRECTIONS = [EAST, NORTHEAST, NORTHWEST, WEST, SOUTHWEST, SOUTHEAST];
	// Only use these directions for edge marks because they should be
	// rendered above tiles
	// Since the order of rendering is right to left, top to bottom
	// these directions are "looking back"
	// and edge marks won't be overlapped by previous tiles
	this.EDGEMARK_DIRECTIONS = [NORTHEAST, NORTHWEST, WEST];

	this.OPPOSITE = new Map([
		[NORTHEAST, SOUTHWEST],
		[SOUTHWEST, NORTHEAST],
		[EAST, WEST],
		[WEST, EAST],
		[NORTHWEST, SOUTHEAST],
		[SOUTHEAST, NORTHWEST]
	]);

	this.XY_DELTAS = new Map([
		[EAST, [1, 0]],
		[WEST, [-1, 0]],
		[NORTHEAST, [0.5, this.YSTEP]],
		[NORTHWEST, [-0.5, this.YSTEP]],
		[SOUTHEAST, [0.5, -this.YSTEP]],
		[SOUTHWEST, [-0.5, -this.YSTEP]]
	]);

	this.width = width;
	this.height = height;
	/** @type {Set<Number>} */
	this.emptyCells = new Set();
	tiles.forEach((tile, index) => {
		if (tile === 0) {
			this.emptyCells.add(index);
		}
	});
	this.total = width * height;
	this.wrap = wrap;

	this.RC_DELTA = new Map([
		[
			EAST,
			[
				[0, 1],
				[0, 1]
			]
		],
		[
			NORTHEAST,
			[
				[-1, 0],
				[-1, 1]
			]
		],
		[
			NORTHWEST,
			[
				[-1, -1],
				[-1, 0]
			]
		],
		[
			WEST,
			[
				[0, -1],
				[0, -1]
			]
		],
		[
			SOUTHWEST,
			[
				[1, -1],
				[1, 0]
			]
		],
		[
			SOUTHEAST,
			[
				[1, 0],
				[1, 1]
			]
		]
	]);

	this.XMIN = -0.6 - (self.wrap ? 1 : 0);
	this.XMAX = self.width + 0.1 + (self.wrap ? 1 : 0);
	this.YMIN = -self.YSTEP * (1 + (self.wrap ? 1 : 0));
	this.YMAX = self.YSTEP * (self.height + (self.wrap ? 1 : 0));

	this.viewBox = writable({
		xmin: this.XMIN,
		ymin: this.YMIN,
		width: this.XMAX - this.XMIN,
		height: this.YMAX - this.YMIN
	});

	/**
	 * Makes sure non-wrap view box doesn't go over puzzle bounds
	 * @param {ViewBox} box
	 * @returns {ViewBox}
	 */
	function fixBoxBounds(box) {
		if (self.wrap) {
			return box;
		}
		let xmin = box.xmin;
		let ymin = box.ymin;
		let width = box.width;
		let height = box.height;
		const dw = box.width - (self.XMAX - self.XMIN);
		const dh = box.height - (self.YMAX - self.YMIN);
		if (dw > 0 && dh > 0) {
			// zoomed too far out, bring them back
			if (dw <= dh) {
				width = box.width - dw;
				height = box.height - (dw * box.height) / box.width;
			} else {
				height = box.height - dh;
				width = box.width - (dh * box.width) / box.height;
			}
			xmin = 0.5 * (self.XMIN + self.XMAX) - width / 2;
			ymin = 0.5 * (self.YMIN + self.YMAX) - height / 2;
		} else {
			if (dw < 0) {
				// zoomed in horizontally, don't allow bounds to leave [XMIN, XMAX]
				xmin = Math.max(self.XMIN, xmin);
				xmin = Math.min(xmin, self.XMAX - width);
			}
			if (dh < 0) {
				// zoomed in vertically, don't allow bounds to leave [YMIN, YMAX]
				ymin = Math.max(self.YMIN, ymin);
				ymin = Math.min(ymin, self.YMAX - height);
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
	this.zoom = function (newWidth, x, y) {
		self.viewBox.update((box) => {
			// const delta = -box.width * magnitude * 0.07;
			const delta = box.width - newWidth;
			const xyScale = box.height / box.width;
			const relativeX = (x - box.xmin) / box.width;
			const relativeY = (y - box.ymin) / box.height;
			let xmin = box.xmin + relativeX * delta;
			let ymin = box.ymin + relativeY * delta * xyScale;
			let xmax = box.xmin + box.width - (1 - relativeX) * delta;
			let ymax = box.ymin + box.height - (1 - relativeY) * delta * xyScale;
			return fixBoxBounds({
				xmin: xmin,
				ymin: ymin,
				width: xmax - xmin,
				height: ymax - ymin
			});
		});
	};

	/**
	 * Move viewbox around
	 * @param {Number} dx
	 * @param {Number} dy
	 */
	this.pan = function (dx, dy) {
		self.viewBox.update((box) => {
			const newBox = fixBoxBounds({
				xmin: box.xmin - dx,
				ymin: box.ymin - dy,
				width: box.width,
				height: box.height
			});
			return newBox;
		});
	};

	/**
	 * @param {Number} index
	 */
	this.index_to_xy = function (index) {
		const c = index % self.width;
		const r = Math.round((index - c) / self.width);
		const x = c + (r % 2 === 0 ? 0.0 : 0.5);
		const y = r * self.YSTEP;
		return [x, y];
	};

	/**
	 * @param {Number} x
	 * @param {Number} y
	 * @returns {Number}
	 */
	this.xy_to_index = function (x, y) {
		const r = y / self.YSTEP;
		const r0 = Math.round(r);
		const c0 = Math.round(x - (r0 % 2 === 0 ? 0 : 0.5));
		const x0 = c0 + (r0 % 2 === 0 ? 0.0 : 0.5);
		const y0 = r0 * self.YSTEP;
		const distance0 = Math.sqrt((x - x0) ** 2 + (y - y0) ** 2);
		if (distance0 <= 0.5) {
			return self.rc_to_index(r0, c0);
		} else {
			let r1 = Math.floor(r);
			if (r1 === r0) {
				r1 = Math.ceil(r);
			}
			const c1 = Math.round(x - (r1 % 2 === 0 ? 0 : 0.5));
			const x1 = c1 + (r1 % 2 === 0 ? 0.0 : 0.5);
			const y1 = r1 * self.YSTEP;
			const distance1 = Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
			if (distance0 < distance1) {
				return self.rc_to_index(r0, c0);
			} else {
				return self.rc_to_index(r1, c1);
			}
		}
	};

	/**
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	this.find_neighbour = function (index, direction) {
		let c = index % self.width;
		let r = (index - c) / self.width;
		let neighbour = -1;

		const [dr, dc] = self.RC_DELTA.get(direction)[r % 2];
		r += dr;
		c += dc;
		if (self.wrap) {
			if (r == -1) {
				r = self.height - 1;
				c += 1;
			}
			if (r == self.height) {
				r = 0;
				c -= 1 - (self.height % 2);
			}
			if (c < 0 || c === self.width) {
				c = (c + self.width) % self.width;
			}
		}
		if (r < 0 || r >= self.height) {
			neighbour = -1;
		} else if (c < 0 || c >= self.width) {
			neighbour = -1;
		} else {
			neighbour = self.width * r + c;
		}
		const empty = neighbour === -1 || self.emptyCells.has(neighbour);
		return { neighbour, empty };
	};

	/**
	 * A number corresponding to fully connected tile
	 * @param {Number} index
	 * @returns {Number}
	 */
	this.fullyConnected = function (index) {
		return 63;
	};

	/**
	 * Compute tile orientation after a number of rotations
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @param {Number} index - index of tile, not used here
	 * @returns
	 */
	this.rotate = function (tile, rotations, index = 0) {
		let rotated = tile;
		rotations = rotations % 6;
		if (rotations > 3) {
			rotations -= 6;
		} else if (rotations < -3) {
			rotations += 6;
		}
		while (rotations < 0) {
			rotated = ((rotated * 2) % 64) + Math.floor(rotated / 32);
			rotations += 1;
		}
		while (rotations > 0) {
			rotated = Math.floor(rotated / 2) + 32 * (rotated % 2);
			rotations -= 1;
		}
		return rotated;
	};

	/**
	 * Computes angle for drawing the tile guiding dot
	 * @param {Number} tile
	 * @returns {Number}
	 */
	this.getTileAngle = function (tile) {
		const tileDirections = self.getDirections(tile);
		const deltas = tileDirections.map((direction) => self.XY_DELTAS.get(direction));

		let dx = 0,
			dy = 0;
		for (let [deltax, deltay] of deltas) {
			dx += deltax;
			dy += deltay;
		}
		dx /= tileDirections.length;
		dy /= tileDirections.length;
		if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
			// a symmetric tile - I, X, Y or fully connected
			if (
				tileDirections.length <= self.DIRECTIONS.length / 2 ||
				tileDirections.length === self.DIRECTIONS.length
			) {
				// I or Y or fully connected tile
				// grab any leg
				dx = deltas[0][0];
				dy = deltas[0][1];
			} else {
				// X - treat as "not I" - grab I direction and rotate 90deg
				const direction = self.DIRECTIONS.find((d) => !tileDirections.includes(d));
				const [deltaX, deltaY] = self.XY_DELTAS.get(direction);
				dx = -deltaY;
				dy = deltaX;
			}
		}
		return Math.atan2(dy, dx);
	};

	/**
	 *
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @returns {Number[]}
	 */
	this.getDirections = function (tile, rotations = 0) {
		const rotated = self.rotate(tile, rotations);
		return self.DIRECTIONS.filter((direction) => (direction & rotated) > 0);
	};

	/**
	 * @param {ViewBox} box
	 * @returns {VisibleTile[]}
	 */
	const getVisibleTiles = function (box) {
		let rmin = Math.floor(box.ymin / self.YSTEP) - 1;
		let rmax = Math.ceil((box.ymin + box.height) / self.YSTEP) + 1;
		if (!self.wrap) {
			rmin = Math.max(0, rmin);
			rmax = Math.min(self.height - 1, rmax);
		}
		let cmin = Math.floor(box.xmin - (rmin % 2 === 0 ? 0 : 0.5)) - 1;
		let cmax = Math.ceil(box.xmin + box.width - (rmin % 2 === 0 ? 0 : 0.5)) + 1;
		if (!self.wrap) {
			cmin = Math.max(0, cmin);
			cmax = Math.min(self.width - 1, cmax);
		}
		const visibleTiles = [];
		for (let r = rmin; r <= rmax; r++) {
			for (let c = cmin; c <= cmax; c++) {
				const index = self.rc_to_index(r, c);
				if (self.emptyCells.has(index)) {
					continue;
				}
				const x = c + (r % 2 === 0 ? 0.0 : 0.5);
				const y = r * self.YSTEP;
				const key = `${Math.round(10 * x)}_${Math.round(10 * y)}`;
				visibleTiles.push({
					index: self.rc_to_index(r, c),
					x,
					y,
					key
				});
			}
		}
		return visibleTiles;
	};

	/**
	 *
	 * @param {Number} r
	 * @param {Number} c
	 * @returns {Number}
	 */
	this.rc_to_index = function (r, c) {
		if (self.wrap) {
			while (r < 0) {
				const evenRow = r % 2 === 0;
				r += self.height;
				if (self.height % 2 !== 0) {
					c += evenRow ? 0 : 1;
				} else {
					c += 1;
				}
			}
			while (r >= self.height) {
				const evenRow = r % 2 === 0;
				r -= self.height;
				if (self.height % 2 !== 0) {
					c -= evenRow ? 1 : 0;
				} else {
					c -= 1;
				}
			}
			c = c % self.width;
			if (c < 0) {
				c += self.width;
			}
		}
		return self.width * r + c;
	};

	// Throttled derived store to get visible tiles from viewbox
	/** @type {NodeJS.Timer|null} */
	let visibleTilesTimeoutId = null;
	/** @type {ViewBox} */
	let lastBox;
	this.visibleTiles = derived(
		this.viewBox,
		(box, set) => {
			lastBox = box;
			if (visibleTilesTimeoutId === null) {
				visibleTilesTimeoutId = setTimeout(() => {
					visibleTilesTimeoutId = null;
					set(getVisibleTiles(lastBox));
				}, 50);
			}
		},
		getVisibleTiles(get(self.viewBox))
	);

	let tilePath = '';
	for (let p = 0; p < 6; p++) {
		const angle = (Math.PI * (2 * p + 1)) / 6;
		const dx = (0.49 * Math.cos(angle)) / self.YSTEP;
		const dy = (-0.49 * Math.sin(angle)) / self.YSTEP;
		if (tilePath === '') {
			tilePath += ` m ${dx - 0.49} ${dy + 0.98 * self.YSTEP}`;
		}
		tilePath += ` l ${dx} ${dy}`;
	}
	tilePath += ' z';
	this.tilePath = tilePath;
	return this;
}
