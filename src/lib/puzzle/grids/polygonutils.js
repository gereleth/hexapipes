import { scale, skew, rotate, compose, inverse, applyToPoint } from 'transformation-matrix';

export class PipeShape {
	/**
	 *
	 * @param {String} str - a string representing connections as 1 and walls as 0
	 * @param {Number} numDirections
	 */
	constructor(str, numDirections) {
		const padded = str.padEnd(numDirections, '0');
		this.str = padded;
		this.isDeadend = str === '1';
		this.isFullyConnected = !padded.includes('0');
		const straightStrHalf = '1'.padEnd(Math.floor(numDirections / 2), '0');
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

export class RegularPolygonCell {
	/** @type {String|null} */
	transformCSS = null;
	/** @type {String|null} */
	style = null;

	/**
	 *
	 * @param {Number} numDirections
	 * @param {Number} angleOffset - angle of the first direction in the list (0=E, pi/2=N, pi=W)
	 * @param {Number} radiusIn - inscribed circumference radius
	 * @param {Number[]} [directions = []]
	 * @param {Number} [borderWidth = 0.01]
	 */
	constructor(numDirections, angleOffset, radiusIn, directions = [], borderWidth = 0.01) {
		this.numDirections = numDirections;
		this.angleOffset = angleOffset;
		this.angleUnit = (Math.PI * 2) / numDirections;
		this.radiusIn = radiusIn;
		this.radiusOut = radiusIn / Math.cos(this.angleUnit / 2);
		this.sideLength = 2 * this.radiusOut * Math.sin(this.angleUnit / 2);
		this.pipesBendFraction = 0.7;
		this.pipesCornerRounding = 0.9;
		if (directions.length === numDirections) {
			this.directions = [...directions];
		} else if (directions.length === 0) {
			this.directions = [...Array(numDirections).keys()].map((x) => 2 ** x);
		} else {
			throw `Length of directions ${directions} does not match directions number ${numDirections}`;
		}
		/** @type {Map<Number, Number>} */
		this.directionToIndex = new Map(this.directions.map((direction, index) => [direction, index]));
		this.fullyConnected = this.directions.reduce((a, b) => a + b, 0);

		// Map tile types
		/** @type {Map<Number, PipeShape>} */
		this.pipeShapes = new Map();
		const shapeStrings = new Set(['1']);
		while (shapeStrings.size > 0) {
			const currentShapeStr = shapeStrings.values().next().value;
			if (currentShapeStr === undefined) {
				break;
			}
			shapeStrings.delete(currentShapeStr);
			if (currentShapeStr.endsWith('1')) {
				/** @type {Number[]} */
				const indices = [];
				currentShapeStr
					.split('')
					.forEach((/** @type {String} */ char, /** @type {Number} */ index) => {
						if (char === '1') {
							indices.push(index);
						}
					});
				const tileType = new PipeShape(currentShapeStr, numDirections);
				for (let i = 0; i < numDirections; i++) {
					const value = indices.reduce((a, b) => a + this.directions[(i + b) % numDirections], 0);
					if (this.pipeShapes.has(value)) {
						break;
					}
					this.pipeShapes.set(value, tileType);
				}
			}
			if (currentShapeStr.length < numDirections) {
				shapeStrings.add(currentShapeStr + '1');
				if (currentShapeStr.length < numDirections - 1) {
					shapeStrings.add(currentShapeStr + '0');
				}
			}
		}

		// draw tile contour
		let angle = angleOffset - this.angleUnit / 2;
		const r = this.radiusOut - borderWidth;
		this.contourPath = `m ${r * Math.cos(angle)} ${-r * Math.sin(angle)}`;
		this.vertices = [];
		for (let i = 1; i <= this.numDirections; i++) {
			angle += this.angleUnit;
			this.contourPath += ` L ${r * Math.cos(angle)} ${-r * Math.sin(angle)}`;
			this.vertices.push({
				x: this.radiusOut * Math.cos(angle),
				y: -this.radiusOut * Math.sin(angle)
			});
		}
		this.contourPath += ' z';

		// caches for frequently recomputed values
		this.cache = {
			rotate: new Map(),
			pipePath: new Map(),
			guideDotPosition: new Map(),
			edgemarkLine: new Map(),
			wallLine: new Map(),
			pipeCenter: new Map()
		};
	}

	/**
	 * Return mininum equivalent number of rotations
	 * In case of 4 directions rotating +3 is the same as rotating -1
	 * So the only unique rotations are -1, 0, 1, 2
	 * @param {Number} times
	 */
	normalizeRotations(times) {
		times = times % this.numDirections;
		const half = this.numDirections / 2;
		if (times <= -half) {
			times += this.numDirections;
		} else if (times > half) {
			times -= this.numDirections;
		}
		return times;
	}

	/**
	 * Return the result of rotating a pipe bitmask a number of times
	 * @param {Number} pipe
	 * @param {Number} times
	 * @returns {Number}
	 */
	rotate(pipe, times) {
		times = this.normalizeRotations(times);
		const key = [pipe, times].join('_');
		const cached = this.cache.rotate.get(key);
		if (cached !== undefined) {
			return cached;
		}
		let result = 0;
		// polygons on mixed grids have non-consecutive direction bits like [1, 2, 16]
		for (let [index, direction] of this.directions.entries()) {
			if ((direction & pipe) === 0) {
				continue;
			}
			const rotated_index = (index + this.numDirections - times) % this.numDirections;
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
	getAngle(rotations) {
		return this.angleUnit * rotations;
	}

	/**
	 * Which directions a pipe is pointing to after some rotations
	 * @param {Number} pipe
	 * @param {Number} rotations
	 * @returns
	 */
	getDirections(pipe, rotations) {
		let rotated = pipe;
		if (rotations !== 0) {
			rotated = this.rotate(pipe, rotations);
		}
		return this.directions.filter((x) => (x & rotated) > 0);
	}

	/**
	 * A path to draw the pipe
	 * @param {Number} pipe
	 */
	getPipePath(pipe) {
		const cached = this.cache.pipePath.get(pipe);
		if (cached !== undefined) {
			return cached;
		}
		if (pipe >= 0) {
			// classic case
			let path = `M 0 0`;
			this.directions.forEach((direction, index) => {
				if ((direction & pipe) > 0) {
					const angle = this.angleOffset + this.angleUnit * index;
					const dx = this.radiusIn * Math.cos(angle);
					const dy = this.radiusIn * Math.sin(angle);
					path += ` l ${dx} ${-dy} L 0 0`;
				}
			});
			this.cache.pipePath.set(pipe, path);
			return path;
		} else {
			// multipipes case
			const actualPipe = -pipe;
			const { cx, cy } = this.getPipeCenter(actualPipe);
			let path = '';
			this.directions.forEach((direction, index) => {
				if ((direction & actualPipe) > 0) {
					const angle = this.angleOffset + this.angleUnit * index;
					const ux = Math.cos(angle);
					const uy = Math.sin(angle);
					const bx = this.pipesBendFraction * this.radiusIn * ux;
					const by = this.pipesBendFraction * this.radiusIn * uy;
					const dx = this.radiusIn * ux;
					const dy = this.radiusIn * uy;
					let towards_x = cx - bx;
					let towards_y = cy - by;
					const center_distance = Math.hypot(towards_x, towards_y);
					const rho = Math.min(
						this.pipesCornerRounding * (1 - this.pipesBendFraction) * this.radiusIn,
						0.5 * center_distance
					);
					if (center_distance > 1e-9) {
						towards_x /= center_distance;
						towards_y /= center_distance;
					} else {
						towards_x = -ux;
						towards_y = -uy;
					}
					const p1x = bx + rho * towards_x;
					const p1y = by + rho * towards_y;
					const p2x = bx + rho * ux;
					const p2y = by + rho * uy;
					path += ` M ${cx} ${-cy} L ${p1x} ${-p1y} Q ${bx} ${-by} ${p2x} ${-p2y} L ${dx} ${-dy} L ${p2x} ${-p2y}`;
				}
			});
			this.cache.pipePath.set(pipe, path);
			return path;
		}
	}
	/**
	 * Slightly offset pipe centers in layered case
	 * @param {Number} pipe
	 */
	getPipeCenter(pipe) {
		const cached = this.cache.pipeCenter.get(pipe);
		if (cached !== undefined) {
			return cached;
		}
		let dx = 0,
			dy = 0,
			n = 0;
		this.directions.forEach((direction, index) => {
			if ((direction & pipe) > 0) {
				const angle = this.angleOffset + this.angleUnit * index;
				dx += this.radiusIn * Math.cos(angle);
				dy += this.radiusIn * Math.sin(angle);
				n += 1;
			}
		});
		const center = { cx: dx / (n + 1), cy: dy / (n + 1) };
		this.cache.pipeCenter.set(pipe, center);
		return center;
	}

	/**
	 * Where to draw a guiding dot for a pipe
	 * @param {Number} pipe
	 */
	getGuideDotPosition(pipe) {
		const cached = this.cache.guideDotPosition.get(pipe);
		if (cached !== undefined) {
			return cached;
		}
		let dx = 0,
			dy = 0,
			n = 0;
		const legs = [];
		for (let [index, direction] of this.directions.entries()) {
			if ((pipe & direction) === 0) {
				continue;
			}
			n += 1;
			const angle = this.angleOffset + this.angleUnit * index;
			const leg = {
				dx: this.radiusIn * Math.cos(angle),
				dy: this.radiusIn * Math.sin(angle),
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
			if (legs.length <= 3 || legs.length === this.numDirections) {
				// I or Y or fully connected tile
				// grab any leg
				dx = legs[0].dx;
				dy = legs[0].dy;
			} else {
				const distances = legs.map((leg, i, legs) => {
					const next_leg = legs[(i + 1) % legs.length];
					return Math.abs(this.normalizeRotations(leg.index - next_leg.index));
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
						const multiple = this.numDirections ** (half - i - 1);
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
		const result = [(this.radiusIn * dx) / l, (this.radiusIn * dy) / l];
		this.cache.guideDotPosition.set(pipe, result);
		return result;
	}

	/**
	 * Compute number of rotations for orienting a pipe with "click to orient" control mode
	 * @param {Number} pipe
	 * @param {Number} old_rotations
	 * @param {Number} tx - x coordinate of clicked point relative to cell center
	 * @param {Number} ty - y coordinate of clicked point relative to cell center
	 * @returns {Number}
	 */
	clickOrientPipe(pipe, old_rotations, tx, ty) {
		const new_angle = Math.atan2(-ty, tx);
		const [guideX, guideY] = this.getGuideDotPosition(pipe);
		const old_angle = Math.atan2(guideY, guideX);
		let times_rotate =
			(Math.round((old_angle - new_angle) / this.angleUnit) - old_rotations) % this.numDirections;
		const half = this.numDirections / 2;
		if (times_rotate > half) {
			times_rotate -= this.numDirections;
		} else if (times_rotate < -half) {
			times_rotate += this.numDirections;
		}
		return times_rotate;
	}

	/**
	 * Given coordinates relative to cell center return the closest direction
	 * @param {Number} x
	 * @param {Number} y
	 * @returns {Number} direction
	 */
	getClosestDirection(x, y) {
		let angle = Math.atan2(-y, x);
		angle += angle < 0 ? Math.PI * 2 : 0;
		const direction_index = Math.round((angle - this.angleOffset) / this.angleUnit);
		return this.directions[(direction_index + this.numDirections) % this.numDirections];
	}

	/**
	 * Returns coordinates of edge line in direction
	 * @param {Number} direction
	 * @returns {{x1: Number, x2: Number, y1: Number, y2: Number, length: Number}}
	 */
	getWallLine(direction) {
		const cached = this.cache.wallLine.get(direction);
		if (cached !== undefined) {
			return cached;
		}
		const direction_index = this.directionToIndex.get(direction) || 0;
		let angle1 = this.angleOffset + this.angleUnit * (direction_index - 0.5);
		let angle2 = angle1 + this.angleUnit;
		const x1 = Math.cos(angle1) * this.radiusOut;
		const y1 = Math.sin(angle1) * this.radiusOut;
		const x2 = Math.cos(angle2) * this.radiusOut;
		const y2 = Math.sin(angle2) * this.radiusOut;
		const length = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
		const result = { x1, x2, y1, y2, length };
		this.cache.wallLine.set(direction, result);
		return result;
	}

	/**
	 * Detects gesture for drawing wall marks
	 * Coordinates should be relative to cell center
	 * @param {Number} x1
	 * @param {Number} x2
	 * @param {Number} y1
	 * @param {Number} y2
	 * @returns {{mark:import('#lib/puzzle/game/game.svelte.js').EdgeMark, direction:number}}
	 */
	detectEdgemarkGesture(x1, x2, y1, y2) {
		// find closest direction
		[y1, y2] = [-y1, -y2];
		const xmid = (x1 + x2) / 2;
		const ymid = (y1 + y2) / 2;
		const direction = this.getClosestDirection(xmid, -ymid);
		/** @type {{mark:import('#lib/puzzle/game/game.svelte.js').EdgeMark, direction:number}} */
		const result = { mark: 'none', direction };
		// find wall line in this direction
		const wall = this.getWallLine(direction);
		// find out if gesture is parallel or perpendicular to the edge
		const gesture_length_squared = (x1 - x2) ** 2 + (y1 - y2) ** 2;
		const gesture_length = Math.sqrt(gesture_length_squared);
		const scalar_product = Math.abs(
			(wall.x1 - wall.x2) * (x1 - x2) + (wall.y1 - wall.y2) * (y1 - y2)
		);
		const cos_distance = scalar_product / (wall.length * gesture_length);
		if (cos_distance > 0.6) {
			result.mark = 'wall';
		} else if (cos_distance < 0.4) {
			result.mark = 'conn';
		}
		if (result.mark === 'none') {
			return result;
		}
		// also check if gesture passes near edge middle to have fewer false positives
		const wall_xmid = (wall.x1 + wall.x2) / 2;
		const wall_ymid = (wall.y1 + wall.y2) / 2;
		const l1_squared = (x1 - wall_xmid) ** 2 + (y1 - wall_ymid) ** 2;
		const l1 = Math.sqrt(l1_squared);
		const l2_squared = (x2 - wall_xmid) ** 2 + (y2 - wall_ymid) ** 2;
		const l2 = Math.sqrt(l2_squared);
		const cos_angle = (l1_squared + l2_squared - gesture_length_squared) / (2 * l1 * l2);
		if (cos_angle > -0.6) {
			result.mark = 'none';
		}
		return result;
	}

	/**
	 * Tells if a point is close to the middle of a polygon's edge
	 * Input coordinates are relative to cell center
	 * @param {Number} x
	 * @param {Number} y
	 */
	isCloseToEdge(x, y) {
		y = -y;
		const delta_radius = Math.abs(Math.sqrt(x ** 2 + y ** 2) - this.radiusIn);
		let angle = Math.atan2(y, x);
		angle += angle < 0 ? 2 * Math.PI : 0;
		const direction_index = Math.round((angle - this.angleOffset) / this.angleUnit);
		const direction_angle = this.angleOffset + this.angleUnit * direction_index;
		let delta_angle = Math.abs(angle - direction_angle);
		delta_angle = Math.min(delta_angle, 2 * Math.PI - delta_angle);
		const direction = this.directions[(direction_index + this.numDirections) % this.numDirections];
		return {
			direction,
			isClose: delta_radius <= 0.3 * this.radiusIn && delta_angle <= 0.3 * this.angleUnit
		};
	}

	/**
	 * Tells if a point is inside the polygon
	 * Input coordinates are relative to cell center
	 * @param {Number} x
	 * @param {Number} y
	 */
	isInside(x, y) {
		const radius_sq = x ** 2 + y ** 2;
		if (radius_sq <= this.radiusIn ** 2) {
			return true;
		} else if (radius_sq >= this.radiusOut ** 2) {
			return false;
		}
		for (let i = 0; i < this.numDirections; i++) {
			const A = this.vertices[i];
			const B = this.vertices[(i + 1) % this.numDirections];
			const P0 = -A.y * (B.x - A.x) + A.x * (B.y - A.y);
			const P1 = (y - A.y) * (B.x - A.x) - (B.y - A.y) * (x - A.x);
			if (P0 * P1 < 0) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Returns coordinates for drawing edgemark line relative to cell center
	 * @param {Number} direction
	 * @returns {{
	 * x1: Number,
	 * x2: Number,
	 * y1: Number,
	 * y2: Number,
	 * grid_x2: Number,
	 * grid_y2: Number,
	 * }}
	 */
	getEdgemarkLine(direction, extendOut = true) {
		const key = `${direction}-${extendOut}`;
		const cached = this.cache.edgemarkLine.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const index = this.directionToIndex.get(direction) || 0;
		const angle = this.angleOffset + index * this.angleUnit;
		const ax = Math.cos(angle);
		const ay = Math.sin(angle);
		const offset_x = ax * this.radiusIn;
		const offset_y = ay * this.radiusIn;
		const dx = 0.25 * this.sideLength * ax;
		const dy = 0.25 * this.sideLength * ay;
		const line = {
			x1: offset_x - dx,
			y1: -offset_y + dy,
			x2: offset_x + (extendOut ? dx : 0),
			y2: -offset_y - (extendOut ? dy : 0),
			grid_x2: 0,
			grid_y2: 0
		};
		line.grid_x2 = line.x2;
		line.grid_y2 = line.y2;
		this.cache.edgemarkLine.set(key, line);
		return line;
	}
}

/**
 * Polygon cell with skew/scale/rotate transformations applied
 * Used in the cube grid to pretend the tiles are squares
 * @extends RegularPolygonCell
 */
export class TransformedPolygonCell extends RegularPolygonCell {
	/**
	 *
	 * @param {Number} numDirections
	 * @param {Number} angleOffset
	 * @param {Number} radiusIn
	 * @param {Number[]} directions
	 * @param {Number} borderWidth
	 * @param {Number} scaleX
	 * @param {Number} scaleY
	 * @param {Number} skewX
	 * @param {Number} skewY
	 * @param {Number} rotateRad
	 * @param {String|null} style - additional css style to apply to polygon
	 */
	constructor(
		numDirections,
		angleOffset,
		radiusIn,
		directions,
		borderWidth,
		scaleX,
		scaleY,
		skewX,
		skewY,
		rotateRad,
		style
	) {
		super(numDirections, angleOffset, radiusIn, directions, borderWidth);
		scaleX = scaleX || 1;
		scaleY = scaleY || 1;
		skewX = skewX || 0;
		skewY = skewY || 0;
		rotateRad = rotateRad || 0;
		this.transformCSS = `rotate(${rotateRad}rad) skew(${skewX}rad, ${skewY}rad) scale(${scaleX}, ${scaleY})`;
		this.transformMatrix = compose(rotate(rotateRad), skew(skewX, skewY), scale(scaleX, scaleY));
		this.transformInverse = inverse(this.transformMatrix);
		this.style = style;
	}

	/**
	 * Compute number of rotations for orienting a tile with "click to orient" control mode
	 * @param {Number} pipe
	 * @param {Number} old_rotations
	 * @param {Number} tx - x coordinate of clicked point relative to cell center
	 * @param {Number} ty - y coordinate of clicked point relative to cell center
	 * @returns {Number}
	 */
	clickOrientPipe(pipe, old_rotations, tx, ty) {
		const { x, y } = applyToPoint(this.transformInverse, { x: tx, y: ty });
		return super.clickOrientPipe(pipe, old_rotations, x, y);
	}

	/**
	 * Detects gesture for drawing wall or connection marks
	 * Coordinates should be relative to cell center
	 * @param {Number} x1
	 * @param {Number} x2
	 * @param {Number} y1
	 * @param {Number} y2
	 * @returns {{mark:import('#lib/puzzle/game/game.svelte.js').EdgeMark, direction:number}}
	 */
	detectEdgemarkGesture(x1, x2, y1, y2) {
		// find closest direction
		const xmid = (x1 + x2) / 2;
		const ymid = (y1 + y2) / 2;
		const direction = this.getClosestDirection(xmid, ymid);
		/** @type {{mark:import('#lib/puzzle/game/game.svelte.js').EdgeMark, direction:number}}*/
		const result = { mark: 'none', direction };
		// find wall line in this direction
		const wall = this.getWallLine(direction);
		// find out if gesture is parallel or perpendicular to the edge
		const gesture_length_squared = (x1 - x2) ** 2 + (y1 - y2) ** 2;
		const gesture_length = Math.sqrt(gesture_length_squared);
		const scalar_product = Math.abs(
			(wall.x1 - wall.x2) * (x1 - x2) + (wall.y1 - wall.y2) * (y1 - y2)
		);
		const cos_distance = scalar_product / (wall.length * gesture_length);
		if (cos_distance > 0.6) {
			result.mark = 'wall';
		} else if (cos_distance < 0.4) {
			result.mark = 'conn';
		}
		// also check if gesture passes near edge middle maybe?
		return result;
	}

	/**
	 * Tells if a point is close to the middle of a polygon's edge
	 * Input coordinates are relative to cell center
	 * @param {Number} x
	 * @param {Number} y
	 */
	isCloseToEdge(x, y) {
		const polyPt = applyToPoint(this.transformInverse, { x, y });
		return super.isCloseToEdge(polyPt.x, polyPt.y);
	}

	/**
	 * Given coordinates relative to cell center return the closest direction
	 * @param {Number} x
	 * @param {Number} y
	 * @returns {Number} direction
	 */
	getClosestDirection(x, y) {
		const polyPt = applyToPoint(this.transformInverse, { x, y });
		return super.getClosestDirection(polyPt.x, polyPt.y);
	}

	/**
	 * Returns coordinates of edge line in direction
	 * @param {Number} direction
	 * @returns {{x1: Number, x2: Number, y1: Number, y2: Number, length: Number}}
	 */
	getWallLine(direction) {
		const cached = this.cache.wallLine.get(direction);
		if (cached !== undefined) {
			return cached;
		}
		const wall = super.getWallLine(direction);
		const { x: x1, y: y1 } = applyToPoint(this.transformMatrix, { x: wall.x1, y: wall.y1 });
		const { x: x2, y: y2 } = applyToPoint(this.transformMatrix, { x: wall.x2, y: wall.y2 });
		const length = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
		const result = { x1, x2, y1, y2, length };
		this.cache.wallLine.set(direction, result);
		return result;
	}

	/**
	 * Returns polygon coordinates for drawing edgemark line
	 * and grid coordinates of last point for drawing bent edgemarks.
	 * All coordinates are relative to cell center.
	 * @param {Number} direction
	 * @param {boolean} extendOut
	 * @returns {{
	 * x1: Number,
	 * x2: Number,
	 * y1: Number,
	 * y2: Number,
	 * grid_x2: Number,
	 * grid_y2: Number,
	 * }}
	 */
	getEdgemarkLine(direction, extendOut = true) {
		const { x1, x2, y1, y2 } = super.getEdgemarkLine(direction, extendOut);
		const { x, y } = applyToPoint(this.transformMatrix, { x: x2, y: y2 });
		return { x1, x2, y1, y2, grid_x2: x, grid_y2: y };
	}
}
