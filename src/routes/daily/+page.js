import { error } from '@sveltejs/kit';

/** @type {import('./$types').PageLoad} */
export async function load({ fetch }) {
	const today = new Date().toISOString();
	const year = today.slice(0, 4);
	const month = today.slice(5, 7);
	const day = today.slice(8, 10);
	const url = `/_instances/daily/${year}/${month}/${day}.json`;
	const response = await fetch(url);

	if (response.ok) {
		const data = await response.json();
		return {
			date: `${year}-${month}-${day}`,
			grid: data.grid,
			wrap: data.wrap,
			width: data.width,
			height: data.height,
			tiles: data.tiles,
			comment: data.comment
		};
	} else {
		throw error(response.status, '');
	}
}
