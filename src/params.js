import { defineParams } from '@sveltejs/kit/params';

const pattern = new RegExp(
	'^hexagonal$|^hexagonal-wrap$|' +
		'^square$|^square-wrap$|' +
		'^octagonal$|^octagonal-wrap$|' +
		'^etrat$|^etrat-wrap$|' +
		'^cube$|^cube-wrap$|' +
		'^octagonal$|^octagonal-wrap$|' +
		'^trihexagonal$|^trihexagonal-wrap$|' +
		'^snubsquare$|^snubsquare-wrap$|' +
		'^rhombitrihexagonal$|^rhombitrihexagonal-wrap$|' +
		'^triangular$|^triangular-wrap$|'
);

/**
 * @param {string} param
 */
function matchGridkind(param) {
	return pattern.test(param);
}

/**
 * @param {string} param
 */
function matchInteger(param) {
	return /^\d+$/.test(param);
}

export const params = defineParams({
	gridkind: (param) => (matchGridkind(param) ? param : undefined),
	integer: (param) => (matchInteger(param) ? param : undefined)
});
