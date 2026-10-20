/**
 * Counts total directions in a bitmask
 * @param {Number} bitmask
 * @returns {Number}
 */
export function popcount(bitmask) {
	let count = 0;
	let bits = bitmask;
	while (bits > 0) {
		bits ^= bits & -bits;
		count += 1;
	}
	return count;
}

/**
 * Iterates directions present in a bitmask
 * @param {Number} bitmask
 * @yields {Number}
 */
export function* iterate_directions(bitmask) {
	let bits = bitmask;
	while (bits > 0) {
		const direction = bits & -bits;
		yield direction;
		bits ^= direction;
	}
}
