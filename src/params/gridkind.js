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

/** @type {import('@sveltejs/kit').ParamMatcher} */
export function match(param) {
	return pattern.test(param);
}
