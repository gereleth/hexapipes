import { RegularPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';

const NORTHEAST = 1;
const NORTH = 2;
const NORTHWEST = 4;
const SOUTHWEST = 8;
const SOUTH = 16;
const SOUTHEAST = 32;

const SQRT3 = Math.sqrt(3);
const XSTEP = 1 / SQRT3;
const TRIANGLE_RADIUS_IN = 1 / 6;

const HEXAGON = new RegularPolygonTile(6, Math.PI / 6, 0.5);
const UPTRIANGLE = new RegularPolygonTile(3, Math.PI / 6, TRIANGLE_RADIUS_IN, [1, 4, 16]);
const DOWNTRIANGLE = new RegularPolygonTile(3, -Math.PI / 6, TRIANGLE_RADIUS_IN, [32, 2, 8]);

export class TrihexaGrid extends AbstractGrid {
	DIRECTIONS = [NORTHEAST, NORTH, NORTHWEST, SOUTHWEST, SOUTH, SOUTHEAST];
	EDGEMARK_DIRECTIONS = [NORTHEAST, NORTH, NORTHWEST];
	OPPOSITE = new Map([
		[NORTH, SOUTH],
		[SOUTH, NORTH],
		[NORTHEAST, SOUTHWEST],
		[NORTHWEST, SOUTHEAST],
		[SOUTHEAST, NORTHWEST],
		[SOUTHWEST, NORTHEAST]
	]);
	NUM_DIRECTIONS = 6;
	KIND = 'trihexagonal';
	PIPE_WIDTH = 0.1;
	STROKE_WIDTH = 0.04;
	PIPE_LENGTH = 0.5;
	SINK_RADIUS = 0.12;

	/**
	 *
	 * @param {Number} width
	 * @param {Number} height
	 * @param {Boolean} wrap
	 * @param {Number[]} tiles
	 */
	constructor(width, height, wrap, tiles = []) {
		super(width, height, wrap, tiles);
		this.w = Math.round(width / SQRT3);
		this.h = Math.round(height / SQRT3);
		this.even = this.h % 2 === 0;

		this.total = this.w * this.h * 3;
		if (!wrap) {
			if (this.even) {
				this.makeEmpty((this.w - 1) * 3 + 1); // upper right corner triangle
				this.makeEmpty((this.h - 1) * this.w * 3 + 2); // lower left corner triangle
			} else {
				this.makeEmpty((this.w - 1) * 3 + 1); // upper right corner triangle
				this.makeEmpty(this.h * this.h * 3 - 1); // lower right corner triangle
			}
		}
		this.XMIN = -0.1 - XSTEP - (wrap ? 1 : 0);
		this.XMAX = 0.1 + this.w * 2 * XSTEP + (wrap ? 1 : 0);
		this.YMIN = -0.6 - (wrap ? 1 : 0);
		this.YMAX = this.h - 1 + 0.6 + (wrap ? 1 : 0);
	}

	/**
	 * Return tile index taking care of wrapping
	 * @param {Number} row
	 * @param {Number} fish
	 * @param {Number} unit
	 */
	_fish_to_index(row, fish, unit) {
		if (fish < 0 || fish >= this.w || row < 0 || row >= this.h) {
			if (!this.wrap) {
				return -1;
			} else {
				fish = fish % this.w;
				if (fish < 0) {
					fish += this.w;
				}
				row = row % this.h;
				if (row < 0) {
					row += this.h;
				}
			}
		}
		let index = 3 * (row * this.w + fish) + unit;
		if (this.emptyCells.has(index)) {
			index = -1;
		}
		return index;
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
		const row = Math.round(y);
		const col = Math.round(x / XSTEP);
		const col_offset = this.even ? 0 : Math.floor(row / this.h);
		let fish = Math.floor((col + col_offset) / 2);
		if ((row + col) % 2 === 0) {
			// could only be a hexagon (or empty space)
			return { index: this._fish_to_index(row, fish, 0), x: col * XSTEP, y: row };
		} else {
			// could be triangles or hexagons
			const dx = x - col * XSTEP;
			const dy = y - row;
			let possible = new Set(['top', 'bottom', 'right', 'left']);
			if (dy < -dx * SQRT3) {
				possible.delete('bottom');
				possible.delete('right');
			} else {
				possible.delete('top');
				possible.delete('left');
			}
			if (dy < dx * SQRT3) {
				possible.delete('bottom');
				possible.delete('left');
			} else {
				possible.delete('top');
				possible.delete('right');
			}
			const elem = possible.values().next().value;
			if (elem === 'top') {
				return {
					index: this._fish_to_index(row, fish, 1),
					x: col * XSTEP,
					y: row - 2 * TRIANGLE_RADIUS_IN
				};
			} else if (elem === 'bottom') {
				return {
					index: this._fish_to_index(row, fish, 2),
					x: col * XSTEP,
					y: row + 2 * TRIANGLE_RADIUS_IN
				};
			} else if (elem === 'left') {
				const f = (row + col_offset) % 2 === 0 ? fish : fish - 1;
				return {
					index: this._fish_to_index(row, f, 0),
					x: col * XSTEP - XSTEP,
					y: row
				};
			} else {
				// elem === 'right'
				const f = (row + col_offset) % 2 === 0 ? fish + 1 : fish;
				return {
					index: this._fish_to_index(row, f, 0),
					x: col * XSTEP + XSTEP,
					y: row
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
		// const polygon = this.polygon_at(index);
		// if (polygon.directions.every((d) => d !== direction)) {
		// 	return { neighbour: -1, empty: true };
		// }
		const unitIndex = index % 3;
		const fishIndex = (index - unitIndex) / 3;
		const r = Math.floor(fishIndex / this.w);
		const f = fishIndex % this.w;
		const fishSwimsLeft = r % 2 === 0;
		// neighbours within the same fish
		if (unitIndex === 0) {
			if (fishSwimsLeft) {
				if (direction === NORTHEAST) {
					const neighbour = index + 1;
					return { neighbour, empty: this.emptyCells.has(neighbour) };
				}
				if (direction === SOUTHEAST) {
					const neighbour = index + 2;
					return { neighbour, empty: this.emptyCells.has(neighbour) };
				}
			} else {
				if (direction === NORTHWEST) {
					const neighbour = index + 1;
					return { neighbour, empty: this.emptyCells.has(neighbour) };
				}
				if (direction === SOUTHWEST) {
					const neighbour = index + 2;
					return { neighbour, empty: this.emptyCells.has(neighbour) };
				}
			}
		} else if (unitIndex === 1) {
			if (
				(direction === SOUTHWEST && fishSwimsLeft) ||
				(direction === SOUTHEAST && !fishSwimsLeft)
			) {
				const neighbour = index - 1;
				return { neighbour, empty: this.emptyCells.has(neighbour) };
			}
		} else if (unitIndex === 2) {
			if (
				(direction === NORTHWEST && fishSwimsLeft) ||
				(direction === NORTHEAST && !fishSwimsLeft)
			) {
				const neighbour = index - 2;
				return { neighbour, empty: this.emptyCells.has(neighbour) };
			}
		}
		// go to a neighbour fish
		let fn = f;
		let rn = r;
		let un = 0;
		if (direction === NORTH) {
			rn -= 1;
			if (r === 0) {
				fn -= this.even ? 0 : unitIndex === 0 ? 1 : 0;
			}
			un = unitIndex === 0 ? 2 : 0;
		} else if (direction === SOUTH) {
			rn += 1;
			if (r === this.h - 1) {
				fn += this.even ? 0 : unitIndex === 0 ? 0 : 1;
			}
			un = unitIndex === 0 ? 1 : 0;
		} else if (direction === NORTHEAST || direction === SOUTHEAST) {
			fn += 1;
			un = fishSwimsLeft ? 0 : direction === NORTHEAST ? 1 : 2;
		} else {
			fn -= 1;
			un = fishSwimsLeft ? (direction === NORTHWEST ? 1 : 2) : 0;
		}
		const neighbour = this._fish_to_index(rn, fn, un);
		return { neighbour, empty: neighbour === -1 || this.emptyCells.has(neighbour) };
	}

	/**
	 * @param {Number} index
	 * @returns {RegularPolygonTile}
	 */
	polygon_at(index) {
		const unitIndex = index % 3;
		if (unitIndex === 0) {
			return HEXAGON;
		} else if (unitIndex === 1) {
			return DOWNTRIANGLE;
		} else {
			return UPTRIANGLE;
		}
	}

	/**
	 * Get CSS transform function parameters for this tile
	 * @param {Number} index
	 */
	getTileTransformCSS(index) {
		return null;
	}

	/**
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	getVisibleTiles(box) {
		let colmin = Math.floor(box.xmin / XSTEP);
		let colmax = Math.ceil((box.xmin + box.width) / XSTEP) + 1;
		let rowmin = Math.floor(box.ymin);
		let rowmax = Math.ceil(box.ymin + box.height);
		if (!this.wrap) {
			colmin = Math.max(0, colmin);
			colmax = Math.min(this.w * 2, colmax);
			rowmin = Math.max(0, rowmin);
			rowmax = Math.min(this.h, rowmax);
		}
		const visibleTiles = [];
		for (let r = rowmin; r < rowmax; r++) {
			const col_offset = this.even ? 0 : Math.floor(r / this.h);
			for (let c = colmin; c < colmax; c++) {
				if ((r + c) % 2 === 0) {
					// hexagon
					const index = this._fish_to_index(r, Math.floor((c + col_offset) / 2), 0);
					if (index !== -1) {
						visibleTiles.push({
							index,
							x: c * XSTEP,
							y: r,
							key: `${r}_${c}_0`
						});
					}
				} else {
					const c_hex = (r + col_offset) % 2 === 0 ? c - 1 : c + 1;
					// up triangle
					const up = this._fish_to_index(r, Math.floor((c_hex + col_offset) / 2), 2);
					if (up !== -1) {
						visibleTiles.push({
							index: up,
							x: c * XSTEP,
							y: r + 2 * TRIANGLE_RADIUS_IN,
							key: `${r}_${c}_2`
						});
					}
					// down triangle
					const down = this._fish_to_index(r, Math.floor((c_hex + col_offset) / 2), 1);
					if (down !== -1) {
						visibleTiles.push({
							index: down,
							x: c * XSTEP,
							y: r - 2 * TRIANGLE_RADIUS_IN,
							key: `${r}_${c}_1`
						});
					}
				}
			}
		}
		return visibleTiles;
	}
}
