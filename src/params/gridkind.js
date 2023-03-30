/** @type {import('@sveltejs/kit').ParamMatcher} */
export function match(param) {
	return /hexagonal|hexagonal-wrap|square|square-wrap|octagonal|octagonal-wrap/.test(param);
}
