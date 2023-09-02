import { TransformedPolygonTile } from '$lib/puzzle/grids/polygonutils';
import { AbstractGrid } from '$lib/puzzle/grids/abstractgrid';
import {
	calculatePenroseTiling,
	trianglesIntersect,
	triangleListsIntersect,
	Vector,
	Triangle,
	Rhombus
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
	for (var i = 0; i < 20; i++) {
		var scale_y, skew_x;
		if (i % 10 < 5) {
			scale_y = Math.sin(TAU / 5);
			skew_x = - TAU / 20;
		} else {
			scale_y = Math.sin(TAU / 10);
			skew_x = - (TAU * 3) / 20;
		}
		// reverse rotation because browser coordinates are y increasing downward
		const rotate_rad = i < 10 ? -rots[i] : -rots[i-10] + TAU / 2;
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
export class PenroseGrid extends AbstractGrid {
	DIRECTIONS = [DIRA, DIRB, DIRC, DIRD];
	EDGEMARK_DIRECTIONS = [DIRA, DIRB, DIRC, DIRD];
	NUM_DIRECTIONS = 4;
	KIND = 'penrose';
	PIPE_WIDTH = 0.15 * SCALE;
	STROKE_WIDTH = 0.06 * SCALE;
	SINK_RADIUS = 0.2 * SCALE;
	EDGEMARK_WIDTH = 0.04 * SCALE;
	GUIDE_DOT_RADIUS = 0.03 * SCALE;
	BEND_EDGEMARKS = true;
	/** @type {"inherit" | "round" | "bevel" | "miter"} */
	LINE_JOIN = 'bevel';
	ZERO_POINT = new Vector(0, 0);

	/**
	 *
	 * @param {Number} width
	 * @param {Number} height
	 * @param {Boolean} wrap
	 * @param {Number[]} tiles
	 */
	constructor(width, height, wrap, tiles = []) {
		super(width, height, wrap, tiles);
		this.initialize();
	}

	initialize(state) {
		if (state) {
			this.coordRhomb = {}
			for (const [coord, rhomb] of Object.entries(state)) {
				const {index, neighbors, base} = rhomb;
				let {rhombus, center} = rhomb;
				center = new Vector(center.x, center.y);
				rhombus = Rhombus.fromJson(rhombus);
				this.coordRhomb[coord] = {index, neighbors, rhombus, center, base};
			}
			this.outsideNeighbours = {}; // put them in same map with a flag?
		}
		else {
			const before = performance.now();
			const penrose = calculatePenroseTiling(this.width * this.height, 1000, 1000, 'square', 'X', 'cull');
			this.coordRhomb = penrose.p3Rhombuses;
			this.outsideNeighbours = penrose.outsideNeighbors;
			console.log('calculatePenrose took', performance.now() - before, 'ms', Object.keys(this.coordRhomb).length, 'tiles');
		}
		this.p3rhombs = Object.values(this.coordRhomb);
		this.total = this.p3rhombs.length;
		const points = this.p3rhombs.flatMap(({ rhombus }) => [rhombus.v1, rhombus.v2, rhombus.v3, rhombus.v4]);
		this.rotation_offsets = new Map();
		this.XMIN =
			Math.min.apply(
				null,
				points.map(({ x }) => x)
			);
		this.XMAX =
			Math.max.apply(
				null,
				points.map(({ x }) => x)
			);
		this.YMIN =
			Math.min.apply(
				null,
				points.map(({ y }) => y)
			);
		this.YMAX =
			Math.max.apply(
				null,
				points.map(({ y }) => y)
			);

		for (const [i, entry] of this.p3rhombs.entries()) entry.index = i;
		this.fix_rotation_offsets();
	}

	getState() {
		return this.coordRhomb;
	}

	getSymbolEnd(dirind, rhombus, center, base, direction, portion) {
		const points = rhombus.getPoints().reverse();
		// this shouldn't be necessary; all rhomb points should consistently start with side 0
		const index1 = (base % 10 < 5 ? dirind + 3 : dirind + 2) % 4;
		const p1 = points[index1].subtract(center), p2 = points[(index1 + 1) % 4].subtract(center);
		return new Vector((p1.x + p2.x) * portion / 2, (p1.y + p2.y) * portion / 2);
	}

	getTileSymbolEnd(index, direction, portion) {
		const dirind = this.polygon_at(index).direction_to_index.get(direction);
		let {rhombus, center, base } = this.p3rhombs[index];
		return this.getSymbolEnd(dirind, rhombus, center, base, direction, portion);
	}

	getPipesPath(tile, index, rotations) {
		let directions = this.DIRECTIONS;
		rotations = rotations % directions.length;
		if (rotations < 0) {
			directions = [...directions.slice(rotations), ...directions.slice(0, rotations)]
		} else if (rotations > 0) {
			directions = [...directions.slice(-rotations), ...directions.slice(0, -rotations)]
		}
		const symbol_portion = 0.7;
		let bezier = true;
		if(symbol_portion > 1)
			bezier = false; 
		tile = this.polygon_at(index).rotate(tile, rotations);
		const {center} = this.p3rhombs[index];
		const {direction_to_index} = this.polygon_at(index);
		return [`M 0 0`, ...directions.map(direction => {
			if ((direction & tile) > 0) {
				// use the fully rotated direction for geometry
				let dirind = direction_to_index.get(direction);
				dirind = (dirind + rotations) % 4;
				while(dirind < 0) dirind += 4;
				direction = directions[dirind];
				const {neighbour, oppositeDirection} = this.find_neighbour(index, direction);
				if (neighbour === -1) {
					return; // deal with literal edge case later
				}
				const {center: neicenter} = this.p3rhombs[neighbour];
				let points;
				const A = this.getTileSymbolEnd(index, direction, symbol_portion);
				if(symbol_portion <= 1) {
					const B = neicenter.add(this.getTileSymbolEnd(neighbour, oppositeDirection, symbol_portion)).subtract(center);
					if(bezier) {
						const C = new Vector((A.x + B.x)/2, (A.y + B.y)/2);
						points = [[A, A, C], [C, B, B], [B, C, C], [A, A, this.ZERO_POINT]]
					} else {
						points = [A, B, A, this.ZERO_POINT];
					}
				}
				else { 
					points = [A, this.ZERO_POINT];
				}
				let path;
				if(bezier) {
					path = points.map(bez => 'C ' + bez.map(p => `${p.x} ${p.y}`).join(', ')).join(' '); 
				} else {
					path = points.map((p, i) => `L ${p.x} ${p.y}`).join(' ');
				}
				console.log('gpp', path);
				return path;
			}
			return null;
		})].filter(x => x).join(' ');
	}

	getClipPath(index) {
		let {rhombus, center} = this.p3rhombs[index];
		let vs = [rhombus.v1, rhombus.v2, rhombus.v3, rhombus.v4, rhombus.v1]
			.map(v => v.subtract(center));
		let path = `m ${vs[0].x} ${vs[0].y}`;
		for (let i = 1; i < vs.length; i++) {
			path += ` L ${vs[i].x} ${vs[i].y}`;
		}
		path += ' z';
		return path;
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
		const before = performance.now();
		const hit = this.p3rhombs.find(({ rhombus }) =>
			rhombus.getTriangles().some((tri) => tri.pointInside(pt))
		);
		console.log('PenroseGrid which_tile_at took', performance.now() - before, 'ms')
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
	 * The offset is 1 for thick rhombs and 0 for thin rhombs.
	 * @returns {void}
	 */
	fix_rotation_offsets() {
		for (let [index, rhomb] of this.p3rhombs.entries()) {
			const offset = rhomb.base % 10 < 5 ? 1 : 0;
			rhomb.neighbors_idx = rhomb.neighbors.map((_, i, neighbors) => {
				const coord = neighbors[(i + offset) % 4];
				if (coord === null) return null;
				return this.coordRhomb[coord].index;
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
		const before = performance.now();
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
		console.log('PenroseGrid getVisibleTiles took', performance.now() - before, 'ms');
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
