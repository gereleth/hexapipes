import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').PageLoad} */
export function load({ params }) {
	// static instances were retired; old links lead to a fresh generated puzzle
	redirect(301, `/${params.grid}/${params.size}`);
}
