const EAST = 1;
const NORTHEAST = 2;
const NORTHWEST = 4;
const WEST = 8;
const SOUTHWEST = 16;
const SOUTHEAST = 32;

const YSTEP = Math.sqrt(3) / 2;

export class HexaGrid {
	DIRECTIONS = [EAST, NORTHEAST, NORTHWEST, WEST, SOUTHWEST, SOUTHEAST];
	EDGEMARK_DIRECTIONS = [NORTHEAST, NORTHWEST, WEST];
	OPPOSITE = new Map([
		[NORTHEAST, SOUTHWEST],
		[SOUTHWEST, NORTHEAST],
		[EAST, WEST],
		[WEST, EAST],
		[NORTHWEST, SOUTHEAST],
		[SOUTHEAST, NORTHWEST]
	]);
	XY_DELTAS = new Map([
		[EAST, [1, 0]],
		[WEST, [-1, 0]],
		[NORTHEAST, [0.5, YSTEP]],
		[NORTHWEST, [-0.5, YSTEP]],
		[SOUTHEAST, [0.5, -YSTEP]],
		[SOUTHWEST, [-0.5, -YSTEP]]
	]);
	ANGLE_DEG = 60;
	ANGLE_RAD = Math.PI / 3;
	NUM_DIRECTIONS = 6;
	KIND = 'hexagonal';
	PIPE_WIDTH = 0.12;
	STROKE_WIDTH = 0.05;
	PIPE_LENGTH = 0.5;
	SINK_RADIUS = 0.17;

	/** @type {Set<Number>} - indices of empty cells */
	emptyCells;
	/** @type {Number} - total number of cells including empties */
	total;

	#RC_DELTA = new Map([
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
		this.YMIN = -YSTEP * (1 + (wrap ? 1 : 0));
		this.YMAX = YSTEP * (height + (wrap ? 1 : 0));

		const d = 0.49;
		let tilePath = '';
		for (let p = 0; p < 6; p++) {
			const angle = (Math.PI * (2 * p + 1)) / 6;
			const dx = (d * Math.cos(angle)) / YSTEP;
			const dy = (-d * Math.sin(angle)) / YSTEP;
			if (tilePath === '') {
				tilePath += ` m ${dx - d} ${dy + 2 * d * YSTEP}`;
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
				rotated = this.rotate(rotated, 1);
			}
		}
	}

	/**
	 * @param {Number} index
	 */
	index_to_xy(index) {
		const c = index % this.width;
		const r = Math.round((index - c) / this.width);
		const x = c + (r % 2 === 0 ? 0.0 : 0.5);
		const y = r * YSTEP;
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
		const r = y / YSTEP;
		const r0 = Math.round(r);
		const c0 = Math.round(x - (r0 % 2 === 0 ? 0 : 0.5));
		const x0 = c0 + (r0 % 2 === 0 ? 0.0 : 0.5);
		const y0 = r0 * YSTEP;
		const distance0 = Math.sqrt((x - x0) ** 2 + (y - y0) ** 2);
		if (distance0 <= 0.5) {
			return {
				index: this.rc_to_index(r0, c0),
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
			const y1 = r1 * YSTEP;
			const distance1 = Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
			if (distance0 < distance1) {
				return {
					index: this.rc_to_index(r0, c0),
					x: x0,
					y: y0
				};
			} else {
				return {
					index: this.rc_to_index(r1, c1),
					x: x1,
					y: y1
				};
			}
		}
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
		const directionIndex = Math.round((angle * 3) / Math.PI) % 6;
		const direction = this.DIRECTIONS[directionIndex];
		const directionAngle = (directionIndex * Math.PI) / 3;
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

		const [dr, dc] = (this.#RC_DELTA.get(direction) || [[]])[r % 2];
		r += dr;
		c += dc;
		if (this.wrap) {
			if (r == -1) {
				r = this.height - 1;
				c += 1;
			}
			if (r == this.height) {
				r = 0;
				c -= 1 - (this.height % 2);
			}
			if (c < 0 || c === this.width) {
				c = (c + this.width) % this.width;
			}
		}
		if (r < 0 || r >= this.height) {
			neighbour = -1;
		} else if (c < 0 || c >= this.width) {
			neighbour = -1;
		} else {
			neighbour = this.width * r + c;
		}
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
			while (r < 0) {
				const evenRow = r % 2 === 0;
				r += this.height;
				if (this.height % 2 !== 0) {
					c += evenRow ? 0 : 1;
				} else {
					c += 1;
				}
			}
			while (r >= this.height) {
				const evenRow = r % 2 === 0;
				r -= this.height;
				if (this.height % 2 !== 0) {
					c -= evenRow ? 1 : 0;
				} else {
					c -= 1;
				}
			}
			c = c % this.width;
			if (c < 0) {
				c += this.width;
			}
		} else if (r < 0 || r >= this.height || c < 0 || c >= this.width) {
			return -1;
		}
		const index = this.width * r + c;
		if (this.emptyCells.has(index)) {
			return -1;
		}
		return index;
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
		return 63;
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
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	getVisibleTiles(box) {
		let rmin = Math.floor(box.ymin / YSTEP) - 1;
		let rmax = Math.ceil((box.ymin + box.height) / YSTEP) + 1;
		if (!this.wrap) {
			rmin = Math.max(0, rmin);
			rmax = Math.min(this.height - 1, rmax);
		}
		let cmin = Math.floor(box.xmin - (rmin % 2 === 0 ? 0 : 0.5)) - 1;
		let cmax = Math.ceil(box.xmin + box.width - (rmin % 2 === 0 ? 0 : 0.5)) + 1;
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
				const x = c + (r % 2 === 0 ? 0.0 : 0.5);
				const y = r * YSTEP;
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
	}

	/**
	 * Shape the playing field by making some tiles empty
	 * @param {'hexagon'|'triangle'|'hourglass'} shape
	 */
	useShape(shape) {
		if (shape === 'hexagon') {
			const wrap = this.wrap;
			this.wrap = false;
			const middle_row = Math.floor(this.height / 2);
			let left_cell = this.width * middle_row;
			let right_cell = left_cell + this.width - 1;
			for (let [start_cell, shift_direction, erase_direction] of [
				[left_cell, NORTHEAST, WEST],
				[right_cell, NORTHWEST, EAST],
				[left_cell, SOUTHEAST, WEST],
				[right_cell, SOUTHWEST, EAST]
			]) {
				let cell = start_cell;
				for (let delta_row = 1; delta_row < middle_row + 1; delta_row++) {
					let new_cell = this.find_neighbour(cell, shift_direction);
					if (new_cell.empty) {
						break;
					} else {
						cell = new_cell.neighbour;
					}
					let { neighbour, empty } = this.find_neighbour(cell, erase_direction);
					while (!empty) {
						this.makeEmpty(neighbour);
						({ neighbour, empty } = this.find_neighbour(neighbour, erase_direction));
					}
				}
			}
			this.wrap = wrap;
		} else if (shape === 'triangle') {
			const wrap = this.wrap;
			this.wrap = false;
			let left_cell = 0;
			let right_cell = this.width - 1;
			for (let [start_cell, shift_direction, erase_direction] of [
				[left_cell, SOUTHEAST, WEST],
				[right_cell, SOUTHWEST, EAST]
			]) {
				let cell = start_cell;
				while (true) {
					let new_cell = this.find_neighbour(cell, shift_direction);
					if (new_cell.empty) {
						break;
					} else {
						cell = new_cell.neighbour;
					}
					let { neighbour, empty } = this.find_neighbour(cell, erase_direction);
					while (!empty) {
						this.makeEmpty(neighbour);
						({ neighbour, empty } = this.find_neighbour(neighbour, erase_direction));
					}
				}
			}
			this.wrap = wrap;
		} else if (shape === 'hourglass') {
			console.log('hourglass');
			const wrap = this.wrap;
			this.wrap = false;
			const middle_row = Math.floor(this.height / 2);
			for (let [start_cell, shift_direction, erase_direction] of [
				[0, SOUTHEAST, WEST],
				[this.width - 1, SOUTHWEST, EAST],
				[this.width * (this.height - 1), NORTHEAST, WEST],
				[this.width * this.height - 1, NORTHWEST, EAST]
			]) {
				let cell = start_cell;
				for (let delta_row = 1; delta_row < middle_row + 1; delta_row++) {
					let new_cell = this.find_neighbour(cell, shift_direction);
					if (new_cell.empty) {
						break;
					} else {
						cell = new_cell.neighbour;
					}
					let { neighbour, empty } = this.find_neighbour(cell, erase_direction);
					while (!empty) {
						this.makeEmpty(neighbour);
						({ neighbour, empty } = this.find_neighbour(neighbour, erase_direction));
					}
				}
			}
			this.wrap = wrap;
		} else {
			throw 'unknown shape ' + shape;
		}
	}

	/**
	 * Tile contour path for svg drawing
	 * @param {Number} index
	 * @returns
	 */
	getTilePath(index) {
		return this.tilePath;
	}

	/**
	 * Pipes lines path
	 * @param {Number} tile
	 * @param {Number} index
	 */
	getPipesPath(tile, index) {
		const myDirections = this.getDirections(tile);
		let path = `M 0 0`;
		myDirections.forEach((direction) => {
			const [dx, dy] = this.XY_DELTAS.get(direction) || [0, 0];
			path += ` l ${0.5 * dx} ${-0.5 * dy} L 0 0`;
		});
		return path;
	}

	/**
	 * Computes position for drawing the tile guiding dot
	 * @param {Number} tile
	 * @param {Number} index
	 * @returns {Number[]}
	 */
	getGuideDotPosition(tile, index = 0) {
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
			// a symmetric tile - I, X, Y or fully connected
			if (
				tileDirections.length <= this.DIRECTIONS.length / 2 ||
				tileDirections.length === this.DIRECTIONS.length
			) {
				// I or Y or fully connected tile
				// grab any leg
				dx = deltas[0][0];
				dy = deltas[0][1];
			} else {
				// X - treat as "not I" - grab I direction and rotate 90deg
				const direction = this.DIRECTIONS.find((d) => !tileDirections.includes(d)) || 1;
				const [deltaX, deltaY] = this.XY_DELTAS.get(direction) || [0, 0];
				dx = -deltaY;
				dy = deltaX;
			}
		}
		const l = Math.sqrt(dx * dx + dy * dy);
		return [(0.4 * dx) / l, (0.4 * dy) / l];
	}
}
