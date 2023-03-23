/**
 *
 * @param {Number} tile_radius
 * @param {Number} angle_unit
 * @param {Number} angle_offset
 * @param {Number} tile_x
 * @param {Number} tile_y
 * @param {Number} x1
 * @param {Number} x2
 * @param {Number} y1
 * @param {Number} y2
 */
export function detectEdgemarkGesture(
	tile_radius,
	angle_unit,
	angle_offset,
	tile_x,
	tile_y,
	x1,
	x2,
	y1,
	y2
) {
	let start_angle = Math.atan2(tile_y - y1, x1 - tile_x);
	let end_angle = Math.atan2(tile_y - y2, x2 - tile_x);
	start_angle += start_angle < 0 ? 2 * Math.PI : 0;
	end_angle += end_angle < 0 ? 2 * Math.PI : 0;
	let delta_angle = Math.abs(start_angle - end_angle);
	let mean_angle = 0.5 * (start_angle + end_angle);
	if (delta_angle > Math.PI) {
		delta_angle = 2 * Math.PI - delta_angle;
		mean_angle -= Math.PI;
	}
	const direction_index = Math.round((mean_angle - angle_offset) / angle_unit);
	const start_radius = Math.sqrt((tile_y - y1) ** 2 + (x1 - tile_x) ** 2);
	const end_radius = Math.sqrt((tile_y - y2) ** 2 + (x2 - tile_x) ** 2);
	const mean_radius = 0.5 * (start_radius + end_radius);

	const radius_is_close = Math.abs(mean_radius - tile_radius) <= 0.4 * tile_radius;
	const angle_is_close =
		Math.abs(mean_angle - (angle_offset + direction_index * angle_unit)) <= 0.5 * angle_unit;

	/** @type {{mark:import('$lib/puzzle/game').EdgeMark, direction_index: Number}} */
	const result = {
		mark: 'none',
		direction_index
	};

	if (radius_is_close && angle_is_close) {
		// was close to tile border
		// in a well defined direction
		// toggle an edgemark here
		const distanceAlongBorder = tile_radius * delta_angle;
		const distanceAcrossBorder = Math.abs(start_radius - end_radius);
		if (distanceAlongBorder > distanceAcrossBorder) {
			result.mark = 'wall';
		} else {
			result.mark = 'conn';
		}
	}
	return result;
}

/**
 * Tells if a point is close to the middle of a polygon's edge
 * @param {Number} dx
 * @param {Number} dy
 * @param {Number} tile_radius
 * @param {Number} angle_unit
 * @param {Number} angle_offset
 * @returns
 */
export function isCloseToEdge(dx, dy, tile_radius, angle_unit, angle_offset) {
	const delta_radius = Math.abs(Math.sqrt(dx ** 2 + dy ** 2) - tile_radius);
	let angle = Math.atan2(dy, dx);
	angle += angle < 0 ? 2 * Math.PI : 0;
	const direction_index = Math.round((angle - angle_offset) / angle_unit);
	const direction_angle = angle_offset + angle_unit * direction_index;
	let delta_angle = Math.abs(angle - direction_angle);
	delta_angle = Math.min(delta_angle, 2 * Math.PI - delta_angle);
	return {
		direction_index,
		isClose: delta_radius <= 0.3 * tile_radius && delta_angle <= 0.3 * angle_unit
	};
}
