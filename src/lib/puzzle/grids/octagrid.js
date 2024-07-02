import { RegularPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';

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

/**
 * Octagonal grid
 * @extends AbstractGrid
 */
export class OctaGrid extends AbstractGrid {
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

	/**
	 *
	 * @param {Number} width
	 * @param {Number} height
	 * @param {Boolean} wrap
	 * @param {Number[]} tiles
	 */
	constructor(width, height, wrap, tiles = []) {
		super(width, height, wrap, tiles);

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
		const x2 = Math.ceil(x) + (x === x1 ? 1 : 0);
		const xm = (x1 + x2) * 0.5;
		const x0 = Math.round(x);

		const y1 = Math.floor(y);
		const y2 = Math.ceil(y) + (y === y1 ? 1 : 0);
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
	 * @param {Number} index
	 */
	getTileTransformCSS(index) {
		return null;
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
	 * Shape the playing field by making some tiles empty
	 * @param {'octagon'|'donut'|'butterfly'|'hole'|'half-wrap-horizontal'|'half-wrap-vertical'} shape
	 */
	useShape(shape) {
		const w = this.width;
		const h = this.height;
		const n = this.width * this.height;
		if (shape === 'octagon') {
			let wrap = false;
			if (this.wrap) {
				this.wrap = false;
				wrap = true;
			}
			const cutoff = Math.round(this.width / 4);
			let left_top_cell = cutoff - 1;
			let right_top_cell = w - cutoff;
			let left_bottom_cell = w * (h - 1) + cutoff - 1;
			let right_bottom_cell = w * h - cutoff;
			for (let [start_cell, shift_direction, erase_direction] of [
				[left_top_cell, SOUTHWEST, NORTHWEST],
				[right_top_cell, SOUTHEAST, NORTHEAST],
				[left_bottom_cell, NORTHWEST, SOUTHWEST],
				[right_bottom_cell, NORTHEAST, SOUTHEAST]
			]) {
				let cell = start_cell;
				this.makeEmpty(start_cell);
				while (true) {
					let new_cell = this.find_neighbour(cell, shift_direction);
					if (new_cell.empty) {
						break;
					} else {
						cell = new_cell.neighbour;
					}
					this.makeEmpty(cell);
					let { neighbour, empty } = this.find_neighbour(cell, erase_direction);
					while (!empty) {
						this.makeEmpty(neighbour);
						({ neighbour, empty } = this.find_neighbour(neighbour, erase_direction));
					}
				}
			}
			this.wrap = wrap;
		} else if (shape === 'hole') {
			if (w % 2 === 1) {
				let middle_octagon = Math.floor(n / 2);
				this.makeEmpty(middle_octagon);
				this.DIRECTIONS.forEach((direction) => {
					const { neighbour, empty } = this.find_neighbour(middle_octagon, direction);
					if (!empty) {
						this.makeEmpty(neighbour);
					}
				});
			} else {
				let middle_square = n - 1 + Math.floor((n - w) / 2);
				this.makeEmpty(middle_square);
				this.DIRECTIONS.forEach((direction) => {
					const { neighbour, empty } = this.find_neighbour(middle_square, direction);
					if (!empty) {
						this.makeEmpty(neighbour);
					}
				});
			}
		} else if (shape === 'butterfly') {
			let wrap = false;
			if (this.wrap) {
				this.wrap = false;
				wrap = true;
			}
			const cutoff = Math.floor((Math.round(w / 3) + 1) / 2);
			let top_cell = w * (cutoff - 1) + Math.floor((w - cutoff) / 2) + 1;
			let right_cell = w * Math.floor(h / 2) + w - cutoff;
			let bottom_cell = w * (h - cutoff) + Math.floor((w - cutoff) / 2) + 1;
			let left_cell = w * Math.floor(h / 2) + cutoff - 1;
			if (w % 2 === 0) {
				top_cell = this.find_neighbour(
					top_cell,
					top_cell % w > (w - 1) / 2 ? SOUTHWEST : SOUTHEAST
				).neighbour;
				right_cell = this.find_neighbour(right_cell, NORTHWEST).neighbour;
				left_cell = this.find_neighbour(left_cell, NORTHEAST).neighbour;
				bottom_cell = this.find_neighbour(
					bottom_cell,
					bottom_cell % w > (w - 1) / 2 ? NORTHWEST : NORTHEAST
				).neighbour;
			}
			for (let [start_cell, shift_direction, erase_direction] of [
				[top_cell, NORTHEAST, NORTHWEST],
				[right_cell, NORTHEAST, SOUTHEAST],
				[left_cell, NORTHWEST, SOUTHWEST],
				[bottom_cell, SOUTHWEST, SOUTHEAST]
			]) {
				let cell = start_cell;
				while (true) {
					this.makeEmpty(cell);
					let { neighbour, empty } = this.find_neighbour(cell, erase_direction);
					while (!empty) {
						this.makeEmpty(neighbour);
						({ neighbour, empty } = this.find_neighbour(neighbour, erase_direction));
					}
					let new_cell = this.find_neighbour(cell, shift_direction);
					if (new_cell.empty) {
						break;
					} else {
						cell = new_cell.neighbour;
					}
				}
			}
			this.wrap = wrap;
		} else if (shape === 'half-wrap-horizontal') {
			for (let i = 0; i < this.width; i++) {
				this.makeEmpty(i);
				this.makeEmpty(n + i);
				this.makeEmpty(n + n - 1 - i);
			}
		} else if (shape === 'half-wrap-vertical') {
			for (let i = 0; i < this.height; i++) {
				this.makeEmpty(w * i);
				this.makeEmpty(n + w * i);
				this.makeEmpty(n + w + w * i - 1);
			}
		} else if (shape === 'donut') {
			this.useShape('octagon');
			this.useShape('hole');
		} else {
			throw 'unknown shape ' + shape;
		}
	}
}
