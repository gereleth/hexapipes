import { scale, skew, rotate, compose, inverse, applyToPoint } from 'transformation-matrix';

export class TileType {
	/**
	 *
	 * @param {String} str - a string representing connections as 1 and walls as 0
	 * @param {Number} num_directions
	 */
	constructor(str, num_directions) {
		const padded = str.padEnd(num_directions, '0');
		this.str = padded;
		this.isDeadend = str === '1';
		this.isFullyConnected = !padded.includes('0');
		const straightStrHalf = '1'.padEnd(Math.floor(num_directions / 2), '0');
		this.isStraight = padded === straightStrHalf + straightStrHalf;
		this.hasNoAdjacentWalls = !padded.includes('00');
		this.hasNoAdjacentConnections = !padded.includes('11') && !padded.endsWith('1');
		this.hasOnlyAdjacentConnections =
			padded.includes('11') &&
			!padded.includes('010') &&
			!(padded.startsWith('10') && padded.endsWith('0'));
		this.hasThreeOrMoreAdjacentConnections = padded.startsWith('111');
	}
}

export class RegularPolygonTile {
	/**
	 *
	 * @param {Number} num_directions
	 * @param {Number} angle_offset
	 * @param {Number} radius_in
	 * @param {Number[]} directions
	 */
	constructor(num_directions, angle_offset, radius_in, directions = [], border_width = 0.01) {
		this.num_directions = num_directions;
		this.angle_offset = angle_offset;
		this.angle_unit = (Math.PI * 2) / num_directions;
		this.radius_in = radius_in;
		this.radius_out = radius_in / Math.cos(this.angle_unit / 2);
		this.side_length = 2 * this.radius_out * Math.sin(this.angle_unit / 2);
		if (directions.length === num_directions) {
			this.directions = [...directions];
		} else if (directions.length === 0) {
			this.directions = [...Array(num_directions).keys()].map((x) => 2 ** x);
		} else {
			throw `Length of directions ${directions} does not match directions number ${num_directions}`;
		}
		/** @type {Map<Number, Number>} */
		this.direction_to_index = new Map(
			this.directions.map((direction, index) => [direction, index])
		);
		this.fully_connected = this.directions.reduce((a, b) => a + b, 0);

		// Map tile types
		/** @type {Map<Number, TileType>} */
		this.tileTypes = new Map();
		const typeStrings = new Set(['1']);
		while (typeStrings.size > 0) {
			const currentTypeStr = typeStrings.values().next().value;
			typeStrings.delete(currentTypeStr);
			if (currentTypeStr.endsWith('1')) {
				/** @type {Number[]} */
				const indices = [];
				currentTypeStr.split('').forEach((char, index) => {
					if (char === '1') {
						indices.push(index);
					}
				});
				const tileType = new TileType(currentTypeStr, num_directions);
				for (let i = 0; i < num_directions; i++) {
					const value = indices.reduce((a, b) => a + this.directions[(i + b) % num_directions], 0);
					if (this.tileTypes.has(value)) {
						break;
					}
					this.tileTypes.set(value, tileType);
				}
			}
			if (currentTypeStr.length < num_directions) {
				typeStrings.add(currentTypeStr + '1');
				if (currentTypeStr.length < num_directions - 1) {
					typeStrings.add(currentTypeStr + '0');
				}
			}
		}

		// draw tile contour
		let angle = angle_offset - this.angle_unit / 2;
		const r = this.radius_out - border_width;
		this.contour_path = `m ${r * Math.cos(angle)} ${-r * Math.sin(angle)}`;
		for (let i = 1; i <= this.num_directions; i++) {
			angle += this.angle_unit;
			this.contour_path += ` L ${r * Math.cos(angle)} ${-r * Math.sin(angle)}`;
		}
		this.contour_path += ' z';

		// caches for frequently recomputed values
		this.cache = {
			rotate: new Map(),
			pipes_path: new Map(),
			guide_dot_position: new Map(),
			edgemark_line: new Map()
		};
	}

	/**
	 * Return mininum equivalent number of rotations
	 * In case of 4 directions rotating +3 is the same as rotating -1
	 * So the only unique rotations are -1, 0, 1, 2
	 * @param {Number} times
	 */
	normalize_rotations(times) {
		times = times % this.num_directions;
		const half = this.num_directions / 2;
		if (times <= -half) {
			times += this.num_directions;
		} else if (times > half) {
			times -= this.num_directions;
		}
		return times;
	}

	/**
	 * Return the result of rotating a tile a number of times
	 * @param {Number} tile
	 * @param {Number} times
	 * @returns {Number}
	 */
	rotate(tile, times) {
		times = this.normalize_rotations(times);
		const key = [tile, times].join('_');
		const cached = this.cache.rotate.get(key);
		if (cached !== undefined) {
			return cached;
		}
		let result = 0;
		for (let [index, direction] of this.directions.entries()) {
			if ((direction & tile) === 0) {
				continue;
			}
			const rotated_index = (index + this.num_directions - times) % this.num_directions;
			result += this.directions[rotated_index];
		}
		this.cache.rotate.set(key, result);
		return result;
	}

	/**
	 * Get angle in radians corresponding to a certain number of rotations
	 * @param {Number} rotations
	 * @returns {Number}
	 */
	get_angle(rotations) {
		return this.angle_unit * rotations;
	}

	/**
	 * Which directions a tile is pointing to after some rotations
	 * @param {Number} tile
	 * @param {Number} rotations
	 * @returns
	 */
	get_directions(tile, rotations) {
		let rotated = tile;
		if (rotations !== 0) {
			rotated = this.rotate(tile, rotations);
		}
		return this.directions.filter((x) => (x & rotated) > 0);
	}

	/**
	 * A path to draw the pipes
	 * @param {Number} tile
	 */
	get_pipes_path(tile) {
		const cached = this.cache.pipes_path.get(tile);
		if (cached !== undefined) {
			return cached;
		}
		let path = `M 0 0`;
		this.directions.forEach((direction, index) => {
			if ((direction & tile) > 0) {
				const angle = this.angle_offset + this.angle_unit * index;
				const dx = this.radius_in * Math.cos(angle);
				const dy = this.radius_in * Math.sin(angle);
				path += ` l ${dx} ${-dy} L 0 0`;
			}
		});
		this.cache.pipes_path.set(tile, path);
		return path;
	}

	/**
	 * Where to draw a guiding dot for a tile
	 * @param {Number} tile
	 */
	get_guide_dot_position(tile) {
		const cached = this.cache.guide_dot_position.get(tile);
		if (cached !== undefined) {
			return cached;
		}
		let dx = 0,
			dy = 0,
			n = 0;
		const legs = [];
		for (let [index, direction] of this.directions.entries()) {
			if ((tile & direction) === 0) {
				continue;
			}
			n += 1;
			const angle = this.angle_offset + this.angle_unit * index;
			const leg = {
				dx: this.radius_in * Math.cos(angle),
				dy: this.radius_in * Math.sin(angle),
				index,
				direction,
				angle
			};
			dx += leg.dx;
			dy += leg.dy;
			legs.push(leg);
		}
		dx /= n;
		dy /= n;
		if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
			// a symmetric tile - I, X, Y or fully connected
			if (legs.length <= 3 || legs.length === this.num_directions) {
				// I or Y or fully connected tile
				// grab any leg
				dx = legs[0].dx;
				dy = legs[0].dy;
			} else {
				const distances = legs.map((leg, i, legs) => {
					const next_leg = legs[(i + 1) % legs.length];
					return Math.abs(this.normalize_rotations(leg.index - next_leg.index));
				});
				if (distances.slice(1).every((x) => x === distances[0])) {
					// octagonal + tile, no direction is better than the others
					// grab any leg
					dx = legs[0].dx;
					dy = legs[0].dy;
				} else {
					// X, Ж and the like
					// cut off "top" half of X and get the guide dot for that
					const half = legs.length / 2;
					const distance_sums = distances.map((d) => 0);
					for (let i = 0; i < half; i++) {
						const multiple = this.num_directions ** (half - i - 1);
						for (let sum_index of distance_sums.keys()) {
							distance_sums[sum_index] += multiple * distances[(sum_index + i) % legs.length];
						}
					}
					const min_sum = Math.min(...distance_sums);
					const base_leg_index = distance_sums.indexOf(min_sum);
					for (let leg of legs.slice(base_leg_index, base_leg_index + half)) {
						dx += leg.dx;
						dy += leg.dy;
					}
					dx /= half;
					dy /= half;
				}
			}
		}
		const l = Math.sqrt(dx * dx + dy * dy);
		const result = [(this.radius_in * dx) / l, (this.radius_in * dy) / l];
		this.cache.guide_dot_position.set(tile, result);
		return result;
	}

	/**
	 * Compute number of rotations for orienting a tile with "click to orient" control mode
	 * @param {Number} tile
	 * @param {Number} old_rotations
	 * @param {Number} tx - x coordinate of clicked point relative to tile center
	 * @param {Number} ty - y coordinate of clicked point relative to tile center
	 * @returns {Number}
	 */
	click_orient_tile(tile, old_rotations, tx, ty) {
		const new_angle = Math.atan2(-ty, tx);
		const [guideX, guideY] = this.get_guide_dot_position(tile);
		const old_angle = Math.atan2(guideY, guideX);
		let times_rotate =
			(Math.round((old_angle - new_angle) / this.angle_unit) - old_rotations) % this.num_directions;
		const half = this.num_directions / 2;
		if (times_rotate > half) {
			times_rotate -= this.num_directions;
		} else if (times_rotate < -half) {
			times_rotate += this.num_directions;
		}
		return times_rotate;
	}

	/**
	 * Detects gesture for drawing wall or connection marks
	 * Coordinates should be relative to tile center
	 * @param {Number} x1
	 * @param {Number} x2
	 * @param {Number} y1
	 * @param {Number} y2
	 */
	detect_edgemark_gesture(x1, x2, y1, y2) {
		let start_angle = Math.atan2(y1, x1);
		let end_angle = Math.atan2(y2, x2);
		start_angle += start_angle < 0 ? 2 * Math.PI : 0;
		end_angle += end_angle < 0 ? 2 * Math.PI : 0;
		let delta_angle = Math.abs(start_angle - end_angle);
		let mean_angle = 0.5 * (start_angle + end_angle);
		if (delta_angle > Math.PI) {
			delta_angle = 2 * Math.PI - delta_angle;
			mean_angle -= Math.PI;
		}
		const direction_index = Math.round((mean_angle - this.angle_offset) / this.angle_unit);
		const start_radius = Math.sqrt(y1 ** 2 + x1 ** 2);
		const end_radius = Math.sqrt(y2 ** 2 + x2 ** 2);
		const mean_radius = 0.5 * (start_radius + end_radius);

		const radius_is_close = Math.abs(mean_radius - this.radius_in) <= 0.4 * this.radius_in;
		const angle_is_close =
			Math.abs(mean_angle - (this.angle_offset + direction_index * this.angle_unit)) <=
			0.5 * this.angle_unit;
		/** @type {{mark:import('$lib/puzzle/game').EdgeMark, direction: Number}} */
		const result = {
			mark: 'none',
			direction: this.directions[(direction_index + this.num_directions) % this.num_directions]
		};

		if (radius_is_close && angle_is_close) {
			// was close to tile border
			// in a well defined direction
			// toggle an edgemark here
			const distance_along_border = this.radius_in * delta_angle;
			const distance_across_border = Math.abs(start_radius - end_radius);
			if (distance_along_border > distance_across_border) {
				result.mark = 'wall';
			} else if (distance_along_border < distance_across_border) {
				result.mark = 'conn';
			}
		}
		return result;
	}

	/**
	 * Tells if a point is close to the middle of a polygon's edge
	 * Input coordinates are relative to tile's center
	 * @param {Number} x
	 * @param {Number} y
	 */
	is_close_to_edge(x, y) {
		const delta_radius = Math.abs(Math.sqrt(x ** 2 + y ** 2) - this.radius_in);
		let angle = Math.atan2(y, x);
		angle += angle < 0 ? 2 * Math.PI : 0;
		const direction_index = Math.round((angle - this.angle_offset) / this.angle_unit);
		const direction_angle = this.angle_offset + this.angle_unit * direction_index;
		let delta_angle = Math.abs(angle - direction_angle);
		delta_angle = Math.min(delta_angle, 2 * Math.PI - delta_angle);
		const direction =
			this.directions[(direction_index + this.num_directions) % this.num_directions];
		return {
			direction,
			isClose: delta_radius <= 0.3 * this.radius_in && delta_angle <= 0.3 * this.angle_unit
		};
	}

	/**
	 * Returns coordinates for drawing edgemark line relative to tile center
	 * @param {Number} direction
	 */
	get_edgemark_line(direction, extendOut = true) {
		const cached = this.cache.edgemark_line.get(`${direction}-${extendOut}`);
		if (cached !== undefined) {
			return cached;
		}
		const index = this.direction_to_index.get(direction) || 0;
		const angle = this.angle_offset + index * this.angle_unit;
		const ax = Math.cos(angle);
		const ay = Math.sin(angle);
		const offset_x = ax * this.radius_in;
		const offset_y = ay * this.radius_in;
		const dx = 0.25 * this.side_length * ax;
		const dy = 0.25 * this.side_length * ay;
		const line = {
			x1: offset_x - dx,
			y1: -offset_y + dy,
			x2: offset_x + (extendOut ? dx : 0),
			y2: -offset_y - (extendOut ? dy : 0)
		};
		this.cache.edgemark_line.set(`${direction}-${extendOut}`, line);
		return line;
	}
}

export class TransformedPolygonTile extends RegularPolygonTile {
	constructor(
		num_directions,
		angle_offset,
		radius_in,
		directions,
		border_width,
		scaleX,
		scaleY,
		skewX,
		skewY,
		rotateTh
	) {
		super(num_directions, angle_offset, radius_in, directions, border_width);
		// we could instead simplify the CSS & matrix construction
		scaleX = scaleX || 1;
		scaleY = scaleY || 1;
		skewX = skewX || 0;
		skewY = skewY || 0;
		rotateTh = rotateTh || 0;
		this.transformCSS = `rotate(${rotateTh}rad) skew(${skewX}rad, ${skewY}rad) scale(${scaleX}, ${scaleY})`;
		this.transformMatrix = compose(rotate(rotateTh), skew(skewX, skewY), scale(scaleX, scaleY));
		this.transformInverse = inverse(this.transformMatrix);
	}

	click_orient_tile(tile, old_rotations, tx, ty) {
		const { x, y } = applyToPoint(this.transformInverse, { x: tx, y: ty });
		return super.click_orient_tile(tile, old_rotations, x, y);
	}

	detect_edgemark_gesture(tx1, tx2, ty1, ty2) {
		const gridTileDownPt = { x: tx1, y: ty1 };
		const gridTileUpPt = { x: tx2, y: ty2 };
		const polygonDownPt = applyToPoint(this.transformInverse, gridTileDownPt);
		const polygonUpPt = applyToPoint(this.transformInverse, gridTileUpPt);
		return super.detect_edgemark_gesture(
			polygonDownPt.x,
			polygonUpPt.x,
			-polygonDownPt.y,
			-polygonUpPt.y
		);
	}

	is_close_to_edge(tx, ty) {
		const polyPt = applyToPoint(this.transformInverse, { x: tx, y: ty });
		return super.is_close_to_edge(polyPt.x, -polyPt.y);
	}
}
