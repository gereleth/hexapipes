import { TransformedPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { HexaGrid, EAST, NORTHEAST, NORTHWEST, WEST, SOUTHWEST, SOUTHEAST } from './hexagrid';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';
import { calculatePenroseTiling, trianglesIntersect, Vector, Triangle } from './penrose-fill-polygon';


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
	const TAU = 2*Math.PI;
	const rots = [0, TAU/5, TAU*2/5, TAU*3/5, TAU*4/5,
		TAU*2/10, -TAU/10, -TAU*4/10, TAU*3/10, 0];
	for(var i = 0; i < 10; i++) {
		var scale_y, skew_x;
		if(i < 5) {
			scale_y = Math.sin(TAU/5);
			skew_x = TAU / 20;
		} else {
			scale_y = Math.sin(TAU/10);
			skew_x = TAU * 3 / 20
		}
		const rotate_rad = rots[i];
		ret.push(new TransformedPolygonTile(
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
		));
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

		this.penrose = calculatePenroseTiling(width * height, 1000, 1000,
			'square', 'X', 'fill');
		this.p3rhombs = Object.values(this.penrose.p3Rhombuses);
		const centers = this.p3rhombs.map(({center}) => center);
		this.XMIN = Math.min.apply(null, centers.map(({x}) => x));
		this.XMAX = Math.max.apply(null, centers.map(({x}) => x));
		this.YMIN = Math.min.apply(null, centers.map(({y}) => y));
		this.YMAX = Math.max.apply(null, centers.map(({y}) => y));

		for(const [i, entry] of this.p3rhombs.entries())
			entry.index = i;
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
		const hit = this.p3rhombs.find(({tri1, tri2}) => tri1.pointInside(pt) || tri2.pointInside(pt));
		if(hit) {
			const {index, center: {x, y}} = hit;
			return {index, x, y};
		}
		return {index: -1}
	}

	/**
	 * @param {Number} index
	 * @param {Number} direction
	 * @returns {{neighbour: Number, empty: boolean, oppositeDirection: Number}} - neighbour index, is the neighbour an empty cell or outside the board
	 */
	find_neighbour(index, direction) {
		const diri = Math.log2(direction);
		const entry = this.p3rhombs[index];
		const neicoord = entry.neighbors[diri];
		if(!neicoord)
			return { neighbour: -1, empty: true };
		const neientry = this.penrose.p3Rhombuses[neicoord];
		const oppi = neientry.neighbors.indexOf(entry.coord);
		console.assert(oppi != -1);
		return { neighbour: neientry.index, oppositeDirection: 2 ** oppi};
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
		const boxtri1 = new Triangle(
			new Vector(xmin, ymin),
			new Vector(xmin, ymin + height),
			new Vector(xmin + width, ymin));
		const boxtri2 = new Triangle(
			new Vector(xmin + width, ymin + height),
			new Vector(xmin + width, ymin),
			new Vector(xmin, ymin + height));
		const visibleTiles = [];
		for (const entry of this.p3rhombs) {
			if([[boxtri1, entry.tri1],
				[boxtri1, entry.tri2],
				[boxtri2, entry.tri1],
				[boxtri2, entry.tri2]].some(([A, B]) => trianglesIntersect(A, B)))
				visibleTiles.push({
					index: entry.index,
					x: entry.center.x,
					y: entry.center.y,
					key: entry.coord
				});
		}
		return visibleTiles;
	}

	getEdgemarkDirections(index) {
		return this.p3rhombs[index].base < 5 ? [DIRC, DIRD] : [DIRA, DIRC];
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
