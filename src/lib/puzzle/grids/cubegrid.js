import { TransformedPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { HexaGrid, EAST, NORTHEAST, NORTHWEST, WEST, SOUTHWEST, SOUTHEAST } from './hexagrid';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';

const DIRA = 1;
const DIRB = 2;
const DIRC = 4;
const DIRD = 8;

const SCALE = 1.5; // cube (x, y) = SCALE * hexagon (x, y)

const RIGHT_FACE = new TransformedPolygonTile(
	4,
	0,
	0.5 * SCALE,
	[],
	0.01,
	1 / Math.sqrt(3),
	0.5,
	Math.PI / 6,
	0,
	-Math.PI / 2,
	'filter: brightness(0.96)'
);
const TOP_FACE = new TransformedPolygonTile(
	4,
	0,
	0.5 * SCALE,
	[],
	0.01,
	1 / Math.sqrt(3),
	0.5,
	Math.PI / 6,
	0,
	(5 * Math.PI) / 6,
	'filter: brightness(1.04)'
);
const LEFT_FACE = new TransformedPolygonTile(
	4,
	0,
	0.5 * SCALE,
	[],
	0.01,
	1 / Math.sqrt(3),
	0.5,
	Math.PI / 6,
	0,
	Math.PI / 6,
	null
);

const FACES = [RIGHT_FACE, TOP_FACE, LEFT_FACE];
const RHOMB_ANGLES = [-Math.PI / 6, Math.PI / 2, (-Math.PI * 5) / 6];
const RHOMB_OFFSETS = RHOMB_ANGLES.map((angle) => {
	return {
		dx: (SCALE * Math.cos(angle) * Math.sqrt(3)) / 6,
		dy: (-SCALE * Math.sin(angle) * Math.sqrt(3)) / 6
	};
});

/**
 * Stacked cubes grid
 * @extends AbstractGrid
 */
export class CubeGrid extends AbstractGrid {
	DIRECTIONS = [DIRA, DIRB, DIRC, DIRD];
	EDGEMARK_DIRECTIONS = [DIRB, DIRC];
	OPPOSITE = new Map([
		[DIRA, DIRB],
		[DIRB, DIRA],
		[DIRC, DIRD],
		[DIRD, DIRC]
	]);
	#RHOMB_NEIGHBOURS = new Map([
		[
			0,
			new Map([
				[DIRA, [0, 1]],
				[DIRB, [0, 2]],
				[DIRC, [SOUTHEAST, 1]],
				[DIRD, [EAST, 2]]
			])
		],
		[
			1,
			new Map([
				[DIRA, [0, 2]],
				[DIRB, [0, 0]],
				[DIRC, [NORTHEAST, 2]],
				[DIRD, [NORTHWEST, 0]]
			])
		],
		[
			2,
			new Map([
				[DIRA, [0, 0]],
				[DIRB, [0, 1]],
				[DIRC, [WEST, 0]],
				[DIRD, [SOUTHWEST, 1]]
			])
		]
	]);
	NUM_DIRECTIONS = 4;
	KIND = 'cube';
	PIPE_WIDTH = 0.15 * SCALE;
	STROKE_WIDTH = 0.06 * SCALE;
	SINK_RADIUS = 0.2 * SCALE;
	EDGEMARK_WIDTH = 0.04 * SCALE;
	GUIDE_DOT_RADIUS = 0.03 * SCALE;
	BEND_EDGEMARKS = true;
	/** @type {"inherit" | "round" | "bevel" | "miter"} */
	LINE_JOIN = 'bevel';

	/**
	 *
	 * @param {Number} width
	 * @param {Number} height
	 * @param {Boolean} wrap
	 * @param {Number[]} tiles
	 */
	constructor(width, height, wrap, tiles = []) {
		super(width, height, wrap, tiles);

		// scale hexagonal grid to keep tile counts about the same
		// as in corresponding square puzzles
		const scale = wrap ? 0.58 : 0.67;
		this.hexWidth = Math.round(width * scale);
		this.hexHeight = Math.round(height * scale);

		this.hexagrid = new HexaGrid(this.hexWidth, this.hexHeight, wrap);
		this.total = this.hexagrid.total * 3;

		if (tiles.length === 0) {
			if (!wrap) {
				this.hexagrid.useShape('hexagon');
			}

			this.hexagrid.emptyCells.forEach((index) => {
				for (let rh = 0; rh < 3; rh++) {
					this.emptyCells.add(index * 3 + rh);
				}
			});
		} else {
			// tiles already provided, they might use another shape
			tiles.forEach((tile, index) => {
				if (tile === 0) {
					this.emptyCells.add(index);
				}
			});
			this.emptyCells.forEach((index) => {
				if (index % 3 !== 0) return;
				if (this.emptyCells.has(index + 1) && this.emptyCells.has(index + 2)) {
					this.hexagrid.emptyCells.add(index / 3);
				}
			});
		}

		this.XMIN = this.hexagrid.XMIN * SCALE;
		this.XMAX = this.hexagrid.XMAX * SCALE;
		this.YMIN = this.hexagrid.YMIN * SCALE;
		this.YMAX = this.hexagrid.YMAX * SCALE;
	}

	/**
	 *
	 * @param {Number} angle
	 */
	angle_to_rhomb(angle) {
		/* Counter-clockwise from lower right of "right side up" cube */
		return (Math.floor(((angle + Math.PI / 2) * 3) / (2 * Math.PI)) + 3) % 3;
	}

	/**
	 * Determines which tile a point at (x, y) belongs to
	 * Returns tile index and tile center coordinates
	 * If the point is over empty space then tileIndex is -1
	 * @param {Number} x
	 * @param {Number} y
	 * @returns {{index: Number, x:Number, y: Number, rh: Number}}
	 */
	which_tile_at(x, y) {
		const xhex = x / SCALE;
		const yhex = y / SCALE;
		const { index: index0, x: x0, y: y0 } = this.hexagrid.which_tile_at(xhex, yhex);
		const rhomb0 = this.angle_to_rhomb(Math.atan2(-(yhex - y0), xhex - x0));
		const index = index0 >= 0 ? 3 * index0 + rhomb0 : -1;
		const { dx, dy } = RHOMB_OFFSETS[rhomb0];
		return { index, x: x0 * SCALE + dx, y: y0 * SCALE + dy, rh: rhomb0 };
	}

	/**
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean, oppositeDirection: Number}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	find_neighbour(index, direction) {
		const rhomb = index % 3;
		const cubei = (index - rhomb) / 3;
		let c = cubei % this.hexWidth;
		let r = (cubei - c) / this.hexWidth;
		let neighbour = -1;
		const oppositeDirection = this.OPPOSITE.get(direction) || 0;
		const [hexdir, rh] = this.#RHOMB_NEIGHBOURS.get(rhomb)?.get(direction) || [0, 0];
		if (hexdir != 0) {
			const { neighbour, empty } = this.hexagrid.find_neighbour(cubei, hexdir);
			const cubeNeighbour = neighbour === -1 ? -1 : neighbour * 3 + rh;
			const cubeEmpty = empty || this.emptyCells.has(cubeNeighbour);
			return { neighbour: cubeNeighbour, empty: cubeEmpty, oppositeDirection };
		}
		const cubeNeighbour = index - rhomb + rh;
		const empty = this.emptyCells.has(cubeNeighbour);
		return { neighbour: cubeNeighbour, empty, oppositeDirection };
	}

	/**
	 * Get index of tile located at row r column c rhomb b
	 * @param {Number} r
	 * @param {Number} c
	 * @param {Number} b
	 * @returns {Number}
	 */
	rcb_to_index(r, c, b) {
		const index = this.hexagrid.rc_to_index(r, c);
		return index * 3 + b;
	}

	/**
	 * @param {Number} index
	 * @returns {TransformedPolygonTile}
	 */
	polygon_at(index) {
		return FACES[index % 3];
	}

	/**
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	getVisibleTiles(box) {
		const { xmin, ymin, width, height } = box;
		const visibleHexagons = this.hexagrid.getVisibleTiles({
			xmin: xmin / SCALE,
			ymin: ymin / SCALE,
			width: width / SCALE,
			height: height / SCALE
		});
		const visibleTiles = [];
		for (const vt of visibleHexagons) {
			let { x, y } = vt;
			x *= SCALE;
			y *= SCALE;
			for (let b = 0; b < 3; ++b) {
				const index = vt.index * 3 + b;
				if (this.emptyCells.has(index)) {
					continue;
				}
				const { dx, dy } = RHOMB_OFFSETS[b];
				const key = `${Math.round(10 * x)}_${Math.round(10 * y)}_${b}`;
				visibleTiles.push({
					index: vt.index * 3 + b,
					x: x + dx,
					y: y + dy,
					key
				});
			}
		}
		return visibleTiles;
	}

	/**
	 * Computes position for drawing the tile guiding dot
	 * @param {Number} tile
	 * * @param {Number} index
	 * @returns {Number[]}
	 */
	getGuideDotPosition(tile, index) {
		const [dx, dy] = this.polygon_at(index).get_guide_dot_position(tile);
		return [0.8 * dx, 0.8 * dy];
	}

	/**
	 * Shape the playing field by making some tiles empty
	 * @param {'hexagon'|'triangle'|'hourglass'|'donut'|'round-hole'|'half-wrap-horizontal'|'half-wrap-vertical'} shape
	 */
	useShape(shape) {
		// just rely on hexagrid...
		this.emptyCells = new Set();
		this.hexagrid.emptyCells = new Set();
		this.hexagrid.useShape(shape);
		this.hexagrid.emptyCells.forEach((i) => {
			this.makeEmpty(3 * i);
			this.makeEmpty(3 * i + 1);
			this.makeEmpty(3 * i + 2);
		});
	}
}
