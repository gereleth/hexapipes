import { error } from '@sveltejs/kit';

/** @type {import('./$types').PageLoad} */
export async function load({ fetch }) {
	const today = new Date();
	const year = today.getFullYear().toString().padStart(4, '0');
	const month = (today.getMonth() + 1).toString().padStart(2, '0');
	const day = today.getDate().toString().padStart(2, '0');
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
