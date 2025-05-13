import { RegularPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';

const EAST = 1;
const NORTH = 2;
const WEST = 4;
const SOUTH = 8;

const SQRT2 = Math.sqrt(2);
const SQRT3 = Math.sqrt(3);
const COL_DX = 1;
const ROW_DX = COL_DX / 2;
const ROW_DY = SQRT3 / 2;

const TRIANGLE_UP = new RegularPolygonTile(3, Math.PI / 6, SQRT3 / 6, [1, 4, 8]);
const TRIANGLE_DOWN = new RegularPolygonTile(3, -Math.PI / 6, SQRT3 / 6, [1, 2, 4]);

export class TriangularGrid extends AbstractGrid {
	DIRECTIONS = [EAST, NORTH, WEST, SOUTH];
	EDGEMARK_DIRECTIONS = [EAST, NORTH];
	OPPOSITE = new Map([
		[NORTH, SOUTH],
		[SOUTH, NORTH],
		[EAST, WEST],
		[WEST, EAST]
	]);
	NUM_DIRECTIONS = 4;
	KIND = 'triangular';
	PIPE_WIDTH = 0.12;
	STROKE_WIDTH = 0.04;
	PIPE_LENGTH = 0.5;
	SINK_RADIUS = 0.15;
	POLYGONS = [TRIANGLE_UP, TRIANGLE_DOWN];
	OFFSETS = [
		{ dx: 0.25, dy: SQRT3 / 12 },
		{ dx: -0.25, dy: -SQRT3 / 12 }
	];

	/**
	 *
	 * @param {Number} width
	 * @param {Number} height
	 * @param {Boolean} wrap
	 * @param {Number[]} tiles
	 */
	constructor(width, height, wrap, tiles = []) {
		super(width, height, wrap, tiles);
		this.w = Math.round(width / SQRT2);
		this.h = Math.round(height / SQRT2);
		if (!this.wrap) {
			this.w += 1;
			this.h += 1;
		}

		this.total = this.w * this.h * 2;

		if (!wrap && tiles.length === 0) {
			for (let r = 0; r < this.h; r++) {
				if (r % 2 === 0) {
					const index = this._row_col_to_index(r, 0 - Math.floor(r / 2), 1);
					this.makeEmpty(index);
				} else {
					let index = this._row_col_to_index(r, this.w - 1 - Math.floor(r / 2), 0);
					this.makeEmpty(index);
				}
			}
		}

		if (!this.wrap) {
			this.XMIN = 0;
			this.XMAX = this.w * COL_DX;
			this.YMIN = -ROW_DY;
			this.YMAX = ROW_DY * this.h;
		} else {
			this.XMIN = -COL_DX * 1.5;
			this.XMAX = (this.w + 1) * COL_DX;
			this.YMIN = -ROW_DY * 1.5;
			this.YMAX = ROW_DY * this.h;
		}
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
		let row_frac = y / ROW_DY;
		let col_frac = (x - row_frac * ROW_DX) / COL_DX;
		let row = Math.round(row_frac);
		let other_row = row_frac > row ? row + 1 : row - 1;
		let col = Math.round(col_frac);
		let other_col = col_frac > col ? col + 1 : col - 1;
		const options = [
			[row, col],
			[other_row, col],
			[row, other_col],
			[other_row, other_col]
		];
		for (let [r, c] of options) {
			for (let i = 0; i < 2; i++) {
				const index = this._row_col_to_index(r, c, i);
				if (index < 0 || index >= this.total) {
					continue;
				}
				const x0 = r * ROW_DX + c * COL_DX + this.OFFSETS[i].dx;
				const y0 = r * ROW_DY + this.OFFSETS[i].dy;
				const polygon = this.POLYGONS[i];
				if (polygon.is_inside(x - x0, y - y0)) {
					if (this.emptyCells.has(index)) {
						return { x: 0, y: 0, index: -1 };
					} else {
						return { x: x0, y: y0, index };
					}
				}
			}
		}
		return { x: 0, y: 0, index: -1 };
	}

	/**
	 * Return tile index taking care of wrapping
	 * @param {Number} row
	 * @param {Number} col
	 * @param {Number} unit
	 */
	_row_col_to_index(row, col, unit) {
		if (this.wrap) {
			col = col % this.w;
			if (col < 0) {
				col += this.w;
			}
			row = row % this.h;
			if (row < 0) {
				row += this.h;
			}
			let index = 2 * (row * this.w + col) + unit;
			return index;
		} else {
			col = col + Math.floor(row / 2);
			if (col < 0 || col >= this.w || row < 0 || row >= this.h) {
				return -1;
			}
			let index = 2 * (row * this.w + col) + unit;
			return index;
		}
	}

	/**
	 * @param {Number} r
	 * @param {Number} c
	 * @param {Number} unitIndex
	 * @returns {{neighbour: Number, empty: boolean}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	give_neighbour(r, c, unitIndex) {
		const index = this._row_col_to_index(r, c, unitIndex);
		if (index === -1) {
			return { neighbour: -1, empty: true };
		} else {
			return { neighbour: index, empty: this.emptyCells.has(index) };
		}
	}

	/**
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	find_neighbour(index, direction) {
		const unitIndex = index % 2;
		const tileIndex = (index - unitIndex) / 2;
		const r = Math.floor(tileIndex / this.w);
		let c = tileIndex % this.w;
		if (!this.wrap) {
			c -= Math.floor(r / 2);
		}
		if (unitIndex === 0) {
			if (direction === EAST) {
				return this.give_neighbour(r, c + 1, 1);
			} else if (direction === WEST) {
				return this.give_neighbour(r, c, 1);
			} else if (direction === SOUTH) {
				return this.give_neighbour(r + 1, c, 1);
			} else {
				return { neighbour: -1, empty: true };
			}
		} else if (unitIndex === 1) {
			if (direction === EAST) {
				return this.give_neighbour(r, c, 0);
			} else if (direction === NORTH) {
				return this.give_neighbour(r - 1, c, 0);
			} else if (direction === WEST) {
				return this.give_neighbour(r, c - 1, 0);
			} else {
				return { neighbour: -1, empty: true };
			}
		} else {
			throw `Invalid unit index ${unitIndex} at index ${index}`;
		}
	}

	/**
	 * @param {Number} index
	 * @returns {RegularPolygonTile}
	 */
	polygon_at(index) {
		const unitIndex = index % 2;
		return this.POLYGONS[unitIndex];
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
		let r0 = Math.floor(box.ymin / ROW_DY) - 1;
		let total_rows = Math.ceil(box.height / ROW_DY) + 3;
		if (!this.wrap) {
			r0 = Math.max(0, r0);
			total_rows = Math.min(this.h - r0, total_rows);
		}
		let c0 = Math.floor((box.xmin - ROW_DX * r0) / COL_DX) - 1;
		let total_cols = Math.ceil(box.width / COL_DX) + 3;
		if (!this.wrap) {
			c0 = Math.max(Math.floor((-r0 * ROW_DX) / COL_DX) - 1, c0);
			total_cols = Math.min(this.w + 1, total_cols);
		}
		const visibleTiles = [];
		for (let r = r0; r < r0 + total_rows; r++) {
			let dc = Math.floor((r - r0) / 2);
			for (let c = c0 - dc; c < c0 - dc + total_cols; c++) {
				const x0 = c * COL_DX + r * ROW_DX;
				const y0 = r * ROW_DY;
				const hexagonIndex = this._row_col_to_index(r, c, 0);
				if (hexagonIndex == -1) {
					continue;
				}
				for (let unitIndex = 0; unitIndex < 2; unitIndex++) {
					const { dx, dy } = this.OFFSETS[unitIndex];
					const index = hexagonIndex + unitIndex;
					if (this.emptyCells.has(index)) {
						continue;
					}
					visibleTiles.push({
						index,
						x: x0 + dx,
						y: y0 + dy,
						key: `${r}_${c}_${unitIndex}`
					});
				}
			}
		}
		// console.log({ r0, c0, total_rows, total_cols, n: visibleTiles.length });
		return visibleTiles;
	}
}
