import { TransformedPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';
import {
	calculatePenroseTiling,
	trianglesIntersect,
	Vector,
	Triangle,
	triangleListsIntersect
} from './penrose-fill-polygon';

const DIRA = 1;
const DIRB = 2;
const DIRC = 4;
const DIRD = 8;

const SCALE = 1;

// equivalent to calculateBaseRhombuses in penrose-fill-polygon
// except generates transform parameters rather than coordinates
function calculateBaseTransformedPolygons() {
	const ret = [];
	const num_directions = 4,
		angle_offset = 0,
		radius_in = 0.5 * SCALE,
		directions = [],
		border_width = 0.01,
		scale_x = 1,
		skew_y = 0,
		style = null;
	const TAU = 2 * Math.PI;
	const rots = [
		0,
		TAU / 5,
		(TAU * 2) / 5,
		(TAU * 3) / 5,
		(TAU * 4) / 5,
		(TAU * 2) / 10,
		-TAU / 10,
		(-TAU * 4) / 10,
		(TAU * 3) / 10,
		0
	];
	for (var i = 0; i < 10; i++) {
		var scale_y, skew_x;
		if (i < 5) {
			scale_y = Math.sin(TAU / 5);
			skew_x = TAU / 20;
		} else {
			scale_y = Math.sin(TAU / 10);
			skew_x = (TAU * 3) / 20;
		}
		const rotate_rad = rots[i];
		ret.push(
			new TransformedPolygonTile(
				num_directions,
				angle_offset,
				radius_in,
				directions,
				border_width,
				scale_x,
				scale_y,
				skew_x,
				skew_y,
				rotate_rad,
				style
			)
		);
	}
	return ret;
}

const BASE_RHOMBS = calculateBaseTransformedPolygons();

/**
 * Stacked cubes grid
 * @extends AbstractGrid
 */
export class P3Grid extends AbstractGrid {
	DIRECTIONS = [DIRA, DIRB, DIRC, DIRD];
	EDGEMARK_DIRECTIONS = [DIRA, DIRB, DIRC, DIRD];
	NUM_DIRECTIONS = 4;
	KIND = 'p3';
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

		this.penrose = calculatePenroseTiling(width * height, 1000, 1000, 'square', 'X', 'fill');
		this.p3rhombs = Object.values(this.penrose.p3Rhombuses);
		this.total = this.p3rhombs.length;
		const centers = this.p3rhombs.map(({ center }) => center);
		this.rotation_offsets = new Map();
		this.XMIN =
			Math.min.apply(
				null,
				centers.map(({ x }) => x)
			) - SCALE;
		this.XMAX =
			Math.max.apply(
				null,
				centers.map(({ x }) => x)
			) + SCALE;
		this.YMIN =
			Math.min.apply(
				null,
				centers.map(({ y }) => y)
			) - SCALE;
		this.YMAX =
			Math.max.apply(
				null,
				centers.map(({ y }) => y)
			) + SCALE;

		for (const [i, entry] of this.p3rhombs.entries()) entry.index = i;
		this.fix_rotation_offsets();
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
		const pt = new Vector(x, y);
		const hit = this.p3rhombs.find(({ rhombus }) =>
			rhombus.getTriangles().some((tri) => tri.pointInside(pt))
		);
		if (hit) {
			const {
				index,
				center: { x, y }
			} = hit;
			return { index, x, y };
		}
		return { index: -1, x, y };
	}

	/**
	 * A hack to get rotations to display correctly
	 * Draws an edgemark and checks in which neighbouring tile it ends
	 * That should be our neighbour in this direction =>
	 * Find out what offset into directions array makes this happen
	 * @returns {void}
	 */
	fix_rotation_offsets() {
		for (let [index, rhomb] of this.p3rhombs.entries()) {
			const polygon = this.polygon_at(index);
			let neighbour = -1;
			let direction_index = -1;
			let offset = 0;
			for (let i = 0; i < 4; i++) {
				direction_index = i;
				const direction = 2 ** i;
				const edgemark = polygon.get_edgemark_line(direction, false);
				neighbour = this.which_tile_at(
					this.p3rhombs[index].center.x + edgemark.grid_x2 * 1.1,
					this.p3rhombs[index].center.y + edgemark.grid_y2 * 1.1
				).index;
				if (neighbour !== -1) {
					break;
				}
			}
			for (let i = 0; i < 4; i++) {
				const neicoord = rhomb.neighbors[i];
				if (!neicoord) continue;
				const neighbor_index = this.penrose.p3Rhombuses[neicoord].index;
				if (neighbor_index === neighbour) {
					offset = (i - direction_index + 4) % 4;
					break;
				}
			}
			rhomb.neighbors_idx = rhomb.neighbors.map((_, i, neighbors) => {
				const coord = neighbors[(i + offset) % 4];
				if (coord === null) return null;
				return this.penrose.p3Rhombuses[coord].index;
			});
		}
	}

	/**
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean, oppositeDirection: Number}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	find_neighbour(index, direction) {
		const polygon = this.polygon_at(index);
		const diri = polygon.direction_to_index.get(direction);
		const entry = this.p3rhombs[index];
		const neighbor_index = entry.neighbors_idx[diri];
		if (neighbor_index === null) {
			return { neighbour: -1, empty: true };
		}
		const neientry = this.p3rhombs[neighbor_index];
		const oppi = neientry.neighbors_idx.indexOf(index);
		console.assert(oppi != -1);

		return {
			neighbour: neientry.index,
			empty: false,
			oppositeDirection: this.polygon_at(neientry.index).directions[oppi]
		};
	}

	/**
	 * @param {Number} index
	 * @returns {TransformedPolygonTile}
	 */
	polygon_at(index) {
		return BASE_RHOMBS[this.p3rhombs[index].base];
	}

	/**
	 * @param {import('$lib/puzzle/viewbox').ViewBox} box
	 * @returns {import('$lib/puzzle/viewbox').VisibleTile[]}
	 */
	getVisibleTiles(box) {
		const { xmin, ymin, width, height } = box;
		const boxtris = [
			new Triangle(
				new Vector(xmin, ymin),
				new Vector(xmin, ymin + height),
				new Vector(xmin + width, ymin)
			),
			new Triangle(
				new Vector(xmin + width, ymin + height),
				new Vector(xmin + width, ymin),
				new Vector(xmin, ymin + height)
			)
		];
		const visibleTiles = [];
		for (const {
			rhombus,
			index,
			center: { x, y }
		} of this.p3rhombs) {
			if (triangleListsIntersect(boxtris, rhombus.getTriangles()))
				visibleTiles.push({
					index,
					x,
					y,
					key: rhombus.coord
				});
		}
		return visibleTiles;
	}

	/**
	 * Computes position for drawing the tile guiding dot
	 * @param {Number} tile
	 * @param {Number} index
	 * @returns {Number[]}
	 */
	getGuideDotPosition(tile, index) {
		const [dx, dy] = this.polygon_at(index).get_guide_dot_position(tile);
		return [0.8 * dx, 0.8 * dy];
	}
}
