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
	this.ANGLE_DEG = 60;
	this.ANGLE_RAD = Math.PI / 3;
	this.NUM_DIRECTIONS = 6;
	this.KIND = 'hexagonal';
	this.PIPE_WIDTH = 0.12;
	this.STROKE_WIDTH = 0.05;
	this.PIPE_LENGTH = 0.5;
	this.SINK_RADIUS = 0.17;

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
	 * Determines which tile a point at (x, y) belongs to
	 * Returns tile index and tile center coordinates
	 * If the point is over empty space then tileIndex is -1
	 * @param {Number} x
	 * @param {Number} y
	 * @returns {{index: Number, x:Number, y: Number}}
	 */
	this.which_tile_at = function (x, y) {
		const r = y / self.YSTEP;
		const r0 = Math.round(r);
		const c0 = Math.round(x - (r0 % 2 === 0 ? 0 : 0.5));
		const x0 = c0 + (r0 % 2 === 0 ? 0.0 : 0.5);
		const y0 = r0 * self.YSTEP;
		const distance0 = Math.sqrt((x - x0) ** 2 + (y - y0) ** 2);
		if (distance0 <= 0.5) {
			return {
				index: self.rc_to_index(r0, c0),
				x: x0,
				y: y0
			};
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
				return {
					index: self.rc_to_index(r0, c0),
					x: x0,
					y: y0
				};
			} else {
				return {
					index: self.rc_to_index(r1, c1),
					x: x1,
					y: y1
				};
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
	 * Makes cell at index empty
	 * @param {Number} index
	 */
	this.makeEmpty = function (index) {
		self.emptyCells.add(index);
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
	 * Tells if a point is close to one of tile's edges
	 * @param {import('$lib/puzzle/controls').PointerOrigin} point
	 */
	this.whichEdge = function (point) {
		const { x, y, tileX, tileY } = point;
		const dx = x - tileX;
		const dy = tileY - y;
		const deltaRadius = Math.abs(Math.sqrt(dx ** 2 + dy ** 2) - 0.5);
		let angle = Math.atan2(dy, dx);
		angle += angle < 0 ? 2 * Math.PI : 0;
		const directionIndex = Math.round((angle * 3) / Math.PI) % 6;
		const direction = self.DIRECTIONS[directionIndex];
		const directionAngle = (directionIndex * Math.PI) / 3;
		let deltaAngle = Math.abs(angle - directionAngle);
		deltaAngle = Math.min(deltaAngle, 2 * Math.PI - deltaAngle);
		return {
			direction,
			isClose: deltaRadius <= 0.15 && deltaAngle <= 0.35
		};
	};

	/**
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	this.getVisibleTiles = function (box) {
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
				if (index === -1) {
					continue;
				}
				const x = c + (r % 2 === 0 ? 0.0 : 0.5);
				const y = r * self.YSTEP;
				const key = `${Math.round(10 * x)}_${Math.round(10 * y)}`;
				visibleTiles.push({
					index,
					x,
					y,
					key
				});
			}
		}
		return visibleTiles;
	};

	/**
	 * Get tile index from row and column number
	 * @param {Number} r
	 * @param {Number} c
	 * @returns {Number} tile index or -1 if empty or out of bounds
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
		} else if (r < 0 || r >= self.height || c < 0 || c >= self.width) {
			return -1;
		}
		const index = self.width * r + c;
		if (self.emptyCells.has(index)) {
			return -1;
		}
		return index;
	};

	/**
	 * Shape the playing field by making some tiles empty
	 * @param {'hexagon'|'triangle'} shape
	 */
	this.useShape = function (shape) {
		if (shape === 'hexagon') {
			const wrap = self.wrap;
			self.wrap = false;
			const middle_row = Math.floor(self.height / 2);
			let left_cell = self.width * middle_row;
			let right_cell = left_cell + self.width - 1;
			for (let [start_cell, shift_direction, erase_direction] of [
				[left_cell, NORTHEAST, WEST],
				[right_cell, NORTHWEST, EAST],
				[left_cell, SOUTHEAST, WEST],
				[right_cell, SOUTHWEST, EAST]
			]) {
				let cell = start_cell;
				for (let delta_row = 1; delta_row < middle_row + 1; delta_row++) {
					let new_cell = self.find_neighbour(cell, shift_direction);
					if (new_cell.empty) {
						break;
					} else {
						cell = new_cell.neighbour;
					}
					let { neighbour, empty } = self.find_neighbour(cell, erase_direction);
					while (!empty) {
						self.makeEmpty(neighbour);
						({ neighbour, empty } = self.find_neighbour(neighbour, erase_direction));
					}
				}
			}
			self.wrap = wrap;
		} else if (shape === 'triangle') {
			const wrap = self.wrap;
			self.wrap = false;
			let left_cell = 0;
			let right_cell = self.width - 1;
			for (let [start_cell, shift_direction, erase_direction] of [
				[left_cell, SOUTHEAST, WEST],
				[right_cell, SOUTHWEST, EAST]
			]) {
				let cell = start_cell;
				while (true) {
					let new_cell = self.find_neighbour(cell, shift_direction);
					if (new_cell.empty) {
						break;
					} else {
						cell = new_cell.neighbour;
					}
					let { neighbour, empty } = self.find_neighbour(cell, erase_direction);
					while (!empty) {
						self.makeEmpty(neighbour);
						({ neighbour, empty } = self.find_neighbour(neighbour, erase_direction));
					}
				}
			}
			self.wrap = wrap;
		} else {
			throw 'unknown shape ' + shape;
		}
	};

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

	/* Tile types for use in solver */
	this.T0 = 0;
	this.T1 = 1;
	this.T2v = 3;
	this.T2c = 5;
	this.T2I = 9;
	this.T3w = 7;
	this.T3y = 11;
	this.T3la = 13;
	this.T3Y = 21;
	this.T4K = 15;
	this.T4X = 27;
	this.T4psi = 23;
	this.T5 = 31;
	this.T6 = 63;
	/** @type {Map<Number,Number>} */
	this.tileTypes = new Map();
	for (let t = 0; t < 64; t++) {
		let rotated = t;
		while (!this.tileTypes.has(rotated)) {
			this.tileTypes.set(rotated, t);
			rotated = self.rotate(rotated, 1);
		}
	}

	return this;
}
