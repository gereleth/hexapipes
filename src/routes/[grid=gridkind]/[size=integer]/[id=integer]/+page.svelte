<script>
	import { page } from '$app/state';
	import PuzzleKindWrapper from '#lib/puzzleWrapper/PuzzleKindWrapper.svelte';
	import { asGridCategory } from '#lib/puzzle/grids/grids.js';

	/**
	 * @typedef {Object} Props
	 * @property {import('./$types').PageData} data
	 */

	/** @type {Props} */
	let { data } = $props();
</script>

<svelte:head>
	<title>
		{page.params.size}x{page.params.size} Hexagonal Pipes Puzzle #{page.params.id}
	</title>
</svelte:head>

<PuzzleKindWrapper
	width={data.width}
	height={data.height}
	tiles={data.tiles}
	category={asGridCategory(page.params.grid)}
	size={Number(page.params.size)}
	puzzleId={Number(page.params.id)}
/>
