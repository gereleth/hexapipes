import { puzzles } from '$lib/puzzles/hexagonal.js';

/** @type {import('./__types/[id]').RequestHandler} */
export async function get({ params }) {
	const size = `w${params.size}h${params.size}`;
	const list = puzzles[size];
	const index = Number(params.id) - 1;

	if (list[index]) {
		return {
			body: {
				width: Number(params.size),
				height: Number(params.size),
				tiles: list[index]
			}
		};
	}

	return {
		status: 404
	};
}
