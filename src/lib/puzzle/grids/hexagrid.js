import { RegularPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';

export const EAST = 1;
export const NORTHEAST = 2;
export const NORTHWEST = 4;
export const WEST = 8;
export const SOUTHWEST = 16;
export const SOUTHEAST = 32;

const YSTEP = Math.sqrt(3) / 2;

const HEXAGON = new RegularPolygonTile(6, 0, 0.5);

/**
 * Hexagonal grid
 * @extends AbstractGrid
 */
export class HexaGrid extends AbstractGrid {
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
	NUM_DIRECTIONS = 6;
	KIND = 'hexagonal';

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
		super(width, height, wrap, tiles);
		this.total = width * height;

		this.XMIN = -0.6 - (wrap ? 1 : 0);
		this.XMAX = width + 0.1 + (wrap ? 1 : 0);
		this.YMIN = -YSTEP * (1 + (wrap ? 1 : 0));
		this.YMAX = YSTEP * (height + (wrap ? 1 : 0));
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
	 * @param {Number} index
	 * @returns {RegularPolygonTile}
	 */
	polygon_at(index) {
		return HEXAGON;
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
	 * @param {'hexagon'|'triangle'|'hourglass'|'donut'|'round-hole'|'half-wrap-horizontal'|'half-wrap-vertical'} shape
	 */
	useShape(shape) {
		if (shape === 'hexagon') {
			let wrap = false;
			if (this.wrap) {
				this.wrap = false;
				wrap = true;
			}
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
			if (middle_row % 2 === 0) {
				this.XMAX -= 0.5;
			} else {
				this.XMIN += 0.5;
			}
			this.wrap = wrap;
		} else if (shape === 'triangle') {
			let wrap = false;
			if (this.wrap) {
				this.wrap = false;
				wrap = true;
			}
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
			let wrap = false;
			if (this.wrap) {
				this.wrap = false;
				wrap = true;
			}
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
		} else if (shape === 'round-hole') {
			const middle_index = Math.floor(this.total / 2);
			this.emptyCells.add(middle_index);
			this.DIRECTIONS.forEach((direction) => {
				const { neighbour } = this.find_neighbour(middle_index, direction);
				this.emptyCells.add(neighbour);
			});
		} else if (shape === 'half-wrap-horizontal') {
			for (let i = 0; i < this.width; i++) {
				this.emptyCells.add(i);
			}
		} else if (shape === 'half-wrap-vertical') {
			for (let i = 0; i < this.height; i++) {
				this.emptyCells.add(this.width * i);
			}
		} else if (shape === 'donut') {
			this.useShape('hexagon');
			this.useShape('round-hole');
		} else {
			throw 'unknown shape ' + shape;
		}
	}
}
