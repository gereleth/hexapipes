import { RegularPolygonTile, TransformedPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { HexaGrid, EAST, NORTHEAST, NORTHWEST, WEST, SOUTHWEST, SOUTHEAST } from './hexagrid';

const DIRA = 1;
const DIRB = 2;
const DIRC = 4;
const DIRD = 8;

const YSTEP = Math.sqrt(3) / 2;
const RIGHT_FACE = new TransformedPolygonTile(
	4,
	0,
	0.5,
	[],
	0.01,
	1 / Math.sqrt(3),
	0.5,
	Math.PI / 6,
	0,
	-Math.PI / 2
);
const TOP_FACE = new TransformedPolygonTile(
	4,
	0,
	0.5,
	[],
	0.01,
	1 / Math.sqrt(3),
	0.5,
	Math.PI / 6,
	0,
	(5 * Math.PI) / 6
);
const LEFT_FACE = new TransformedPolygonTile(
	4,
	0,
	0.5,
	[],
	0.01,
	1 / Math.sqrt(3),
	0.5,
	Math.PI / 6,
	0,
	Math.PI / 6
);

const RHOMB_DIRS = new Map([
	[0, -Math.PI / 6],
	[1, Math.PI / 2],
	[2, (-Math.PI * 5) / 6]
]);
const RHOMB_OFFSETS = new Map(
	[...RHOMB_DIRS.entries()].map(([rh, dir]) => [
		rh,
		[(Math.cos(dir) * Math.sqrt(3)) / 6, (-Math.sin(dir) * Math.sqrt(3)) / 6]
	])
);

export class CubeGrid {
	DIRECTIONS = [DIRA, DIRB, DIRC, DIRD];
	EDGEMARK_DIRECTIONS = [DIRB, DIRC];
	EDGEMARK_REFLECTS = [DIRD, DIRA];
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
	PIPE_WIDTH = 0.15;
	STROKE_WIDTH = 0.06;
	PIPE_LENGTH = 0.5;
	SINK_RADIUS = 0.2;

	/** @type {Set<Number>} - indices of empty cells */
	emptyCells;
	/** @type {Number} - total number of cells including empties */
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

		this.hexagrid = new HexaGrid(width, height, wrap);
		if (!wrap) {
			this.hexagrid.useShape('hexagon');
		}

		this.lineJoin = 'bevel';

		this.emptyCells = new Set();
		this.hexagrid.emptyCells.forEach((index) => {
			for (let rh = 0; rh < 3; rh++) {
				this.emptyCells.add(index * 3 + rh);
			}
		});
		tiles.forEach((tile, index) => {
			if (tile === 0) {
				this.emptyCells.add(index);
			}
		});
		this.total = width * height * 3;

		this.XMIN = this.hexagrid.XMIN;
		this.XMAX = this.hexagrid.XMAX;
		this.YMIN = this.hexagrid.YMIN;
		this.YMAX = this.hexagrid.YMAX;
	}

	/**
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
		const { index: index0, x: x0, y: y0 } = this.hexagrid.which_tile_at(x, y);
		const rhomb0 = this.angle_to_rhomb(Math.atan2(-(y - y0), x - x0));
		const index = index0 >= 0 ? 3 * index0 + rhomb0 : -1;
		const ofs = RHOMB_OFFSETS.get(rhomb0);
		return { index, x: x0 + ofs[0], y: y0 + ofs[1], rh: rhomb0 };
	}

	/**
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	find_neighbour(index, direction) {
		const rhomb = index % 3;
		const cubei = (index - rhomb) / 3;
		let c = cubei % this.width;
		let r = (cubei - c) / this.width;
		let neighbour = -1;

		const [hexdir, rh] = this.#RHOMB_NEIGHBOURS.get(rhomb)?.get(direction) || [0, 0];
		if (hexdir != 0) {
			const { neighbour, empty } = this.hexagrid.find_neighbour(cubei, hexdir);
			const cubeNeighbour = neighbour === -1 ? -1 : neighbour * 3 + rh;
			const cubeEmpty = empty || this.emptyCells.has(cubeNeighbour);
			return { neighbour: cubeNeighbour, empty: cubeEmpty };
		}
		const cubeNeighbour = index - rhomb + rh;
		const empty = this.emptyCells.has(cubeNeighbour);
		return { neighbour: cubeNeighbour, empty };
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
	 * Makes cell at index empty
	 * @param {Number} index
	 */
	makeEmpty(index) {
		this.emptyCells.add(index);
	}

	/**
	 * @param {Number} index
	 * @returns {TransformedPolygonTile}
	 */
	polygon_at(index) {
		return [RIGHT_FACE, TOP_FACE, LEFT_FACE][index % 3];
	}

	/**
	 * Compute tile orientation after a number of rotations
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @returns
	 */
	rotate(tile, rotations) {
		return LEFT_FACE.rotate(tile, rotations);
	}

	/**
	 * Get angle for displaying rotated pipes state
	 * @param {Number} rotations
	 * @param {Number} index
	 * @returns
	 */
	getAngle(rotations, index) {
		return this.polygon_at(index).get_angle(rotations);
	}

	/**
	 * Get CSS transform function parameters for this tile
	 * @param {Number} index
	 */
	getTileTransformCSS(index) {
		return this.polygon_at(index).transformCSS;
	}

	/**
	 *
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @returns {Number[]}
	 */
	getDirections(tile, rotations = 0) {
		return LEFT_FACE.get_directions(tile, rotations);
	}

	/**
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	getVisibleTiles(box) {
		const vishex = this.hexagrid.getVisibleTiles(box);
		const visibleTiles = [];
		for (const vt of vishex) {
			for (let b = 0; b < 3; ++b) {
				const { x, y } = vt;
				const ofs = RHOMB_OFFSETS.get(b);
				const key = `${Math.round(10 * x)}_${Math.round(10 * y)}_${b}`;
				visibleTiles.push({
					index: vt.index * 3 + b,
					x: x + ofs[0],
					y: y + ofs[1],
					key
				});
			}
		}
		return visibleTiles;
	}

	/**
	 * Tile contour path for svg drawing
	 * @param {Number} index
	 * @returns
	 */
	getTilePath(index) {
		return this.polygon_at(index).contour_path;
	}

	/**
	 * Pipes lines path
	 * @param {Number} tile
	 * @param {Number} index
	 */
	getPipesPath(tile, index) {
		return this.polygon_at(index).get_pipes_path(tile);
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
	 * Compute number of rotations for orienting a tile with "click to orient" control mode
	 * @param {Number} tile
	 * @param {Number} old_rotations
	 * @param {Number} tx
	 * @param {Number} ty
	 * @param {Number} index
	 */
	clickOrientTile(tile, old_rotations, tx, ty, index = 0) {
		return this.polygon_at(index).click_orient_tile(tile, old_rotations, tx, ty);
	}
	/**
	 * Returns coordinates of endpoints of edgemark line
	 * @param {Number} direction
	 * @param {Boolean} isWall
	 * @param {Number} index
	 * @returns
	 */
	getEdgemarkLine(direction, isWall, index = 0) {
		return this.polygon_at(index).get_edgemark_line(direction, isWall);
	}
	/**
	 * Check if a drag gesture resembles drawing an edge mark
	 * @param {Number} tile_index
	 * @param {Number} x1
	 * @param {Number} x2
	 * @param {Number} y1
	 * @param {Number} y2
	 */
	detectEdgemarkGesture(tile_index, tile_x, tile_y, x1, x2, y1, y2) {
		return this.polygon_at(tile_index).detect_edgemark_gesture(
			x1 - tile_x,
			x2 - tile_x,
			y1 - tile_y,
			y2 - tile_y
		);
	}

	/**
	 * Tells if a point is close to one of tile's edges
	 * @param {import('$lib/puzzle/controls').PointerOrigin} point
	 */
	whichEdge(point) {
		return this.polygon_at(point.tileIndex).is_close_to_edge(
			point.x - point.tileX,
			point.y - point.tileY
		);
	}
}
