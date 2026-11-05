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

/**
 * Unions a list of bitmasks into one - every direction any of them uses.
 * The pipe union of a tile is the common case
 * @param {Number[]} bitmasks
 * @returns {Number}
 */
export function union(bitmasks) {
	let result = 0;
	for (const bitmask of bitmasks) {
		result |= bitmask;
	}
	return result;
}
