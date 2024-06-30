import { error } from '@sveltejs/kit';

/** @type {import('./$types').PageLoad} */
export async function load({ params, fetch }) {
	const size = `${params.size}x${params.size}`;
	const id = Number(params.id);
	const folderNum = Math.floor((id - 1) / 100);
	const url = `/_instances/hexagonal/${size}/${folderNum}/${id}.json`;
	const response = await fetch(url);

	if (response.ok) {
		const data = await response.json();
		return {
			width: data.width,
			height: data.height,
			tiles: data.tiles
		};
	} else {
		error(response.status, '');
	}
}
